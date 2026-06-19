import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobDto, JobSearchInput, LeadDto } from '@lead/shared';
import { api, ApiError, openJobEventStream, type MeResponse } from './api';
import { Inbox } from './components/Inbox';
import { JobProgress } from './components/JobProgress';
import { Login } from './components/Login';
import { SearchForm } from './components/SearchForm';

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function serializeSearch(input: JobSearchInput): string {
  if ('naturalLanguageQuery' in input) {
    return `ai:${input.naturalLanguageQuery.trim().toLowerCase()}`;
  }
  const companies = [...input.companiesOrKeywords].map((s) => s.toLowerCase().trim()).sort().join(',');
  const roles = [...input.roles].map((s) => s.toLowerCase().trim()).sort().join(',');
  return `guided:${companies}|${roles}|${input.region.trim().toLowerCase()}`;
}

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginUserId, setLoginUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [job, setJob] = useState<JobDto | null>(null);
  const submitInFlight = useRef(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [knownCredits, setKnownCredits] = useState<Record<string, number>>(() => {
    try {
      const stored = sessionStorage.getItem('knownCredits');
      return stored ? (JSON.parse(stored) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  // counter = total successful searches; lastSubmit maps key → counter value at submission
  const searchHistoryRef = useRef<{ counter: number; lastSubmit: Map<string, number> }>({
    counter: 0,
    lastSubmit: new Map()
  });
  const prevUserIdRef = useRef<string | null>(null);
  const [leads, setLeads] = useState<LeadDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [leadFilter, setLeadFilter] = useState('all');
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) setAuthError(messageFrom(error));
      setMe(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const loadLeads = useCallback(
    async (filter = leadFilter) => {
      setLeadsLoading(true);
      setLeadsError(null);
      try {
        const [leadsResp, jobsResp] = await Promise.all([
          api.listLeads(filter),
          api.listJobs()
        ]);
        setLeads(leadsResp.items);
        setJobs(jobsResp.items);
      } catch (error) {
        setLeadsError(messageFrom(error));
      } finally {
        setLeadsLoading(false);
      }
    },
    [leadFilter]
  );

  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (me) {
      setKnownCredits((prev) => {
        const next = { ...prev, [me.user.id]: me.organization.credits };
        sessionStorage.setItem('knownCredits', JSON.stringify(next));
        return next;
      });
      if (me.user.id !== prevUserIdRef.current) {
        prevUserIdRef.current = me.user.id;
        try {
          const stored = sessionStorage.getItem(`searchHistory:${me.user.id}`);
          if (stored) {
            const parsed = JSON.parse(stored) as { counter: number; entries: [string, number][] };
            searchHistoryRef.current = { counter: parsed.counter, lastSubmit: new Map(parsed.entries) };
          } else {
            searchHistoryRef.current = { counter: 0, lastSubmit: new Map() };
          }
        } catch {
          searchHistoryRef.current = { counter: 0, lastSubmit: new Map() };
        }
      }
      void loadLeads();
    }
  }, [me, loadLeads]);

  // SSE stream for active job — replaces the polling interval
  useEffect(() => {
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return;

    const close = openJobEventStream(
      job.id,
      (updatedJob) => {
        setJob(updatedJob);
        setJobError(null);
        const s = updatedJob.status;
        if (s === 'verifying' || ['completed', 'failed', 'cancelled'].includes(s)) {
          void Promise.all([loadMe(), loadLeads()]);
        }
      },
      () => {
        // SSE closed (terminal or network issue); do a one-shot refresh
        void api
          .getJob(job.id)
          .then((r) => setJob(r.job))
          .catch(() => {});
      }
    );

    return close;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  async function login(userId: string): Promise<void> {
    setLoginUserId(userId);
    setAuthError(null);
    try {
      await api.login(userId);
      await loadMe();
    } catch (error) {
      setAuthError(messageFrom(error));
    } finally {
      setLoginUserId(null);
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      prevUserIdRef.current = null;
      searchHistoryRef.current = { counter: 0, lastSubmit: new Map() };
      setMe(null);
      setJob(null);
      setLeads([]);
      setJobs([]);
      idempotencyKeyRef.current = null;
    }
  }

  const jobActive = !!job && ['queued', 'discovering', 'verifying'].includes(job.status);

  async function submitSearch(input: JobSearchInput, retry: boolean): Promise<void> {
    if (submitInFlight.current || jobActive) return;

    const searchKey = serializeSearch(input);
    if (!retry) {
      const { counter, lastSubmit } = searchHistoryRef.current;
      const lastIndex = lastSubmit.get(searchKey);
      if (lastIndex !== undefined) {
        const searchesSince = counter - lastIndex;
        if (searchesSince < 3) {
          const needed = 3 - searchesSince;
          setSubmitError(
            `Repeating this search would waste a credit — you already have these results. Run ${needed} different search${needed === 1 ? '' : 'es'} first, then come back to this one.`
          );
          setCanRetry(false);
          return;
        }
      }
    }

    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setCanRetry(false);
    if (!retry || !idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    try {
      const response = await api.createJob(input, idempotencyKeyRef.current);
      const freshJob = await api.getJob(response.jobId);
      setJob(freshJob.job);
      idempotencyKeyRef.current = null;
      if (!retry && me) {
        const { counter, lastSubmit } = searchHistoryRef.current;
        const newCounter = counter + 1;
        const newLastSubmit = new Map(lastSubmit);
        newLastSubmit.set(searchKey, newCounter);
        searchHistoryRef.current = { counter: newCounter, lastSubmit: newLastSubmit };
        sessionStorage.setItem(`searchHistory:${me.user.id}`, JSON.stringify({
          counter: newCounter,
          entries: [...newLastSubmit.entries()]
        }));
      }
      await loadMe();
    } catch (error) {
      setSubmitError(messageFrom(error));
      setCanRetry(!(error instanceof ApiError) || error.status >= 500);
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_CREDITS') await loadMe();
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function cancelJob(): Promise<void> {
    if (!job) return;
    setCancelling(true);
    setJobError(null);
    try {
      const response = await api.cancelJob(job.id);
      setJob(response.job);
      await loadLeads();
    } catch (error) {
      setJobError(messageFrom(error));
    } finally {
      setCancelling(false);
    }
  }

  if (authLoading)
    return (
      <div className="boot-screen">
        <div className="boot-inner">
          <div className="brand-mark">LF</div>
          <div className="boot-spinner" aria-hidden="true" />
        </div>
      </div>
    );
  if (!me) return <Login onLogin={login} loadingUserId={loginUserId} error={authError} knownCredits={knownCredits} />;

  const credits = me.organization.credits;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">LF</div>
          <div>
            <strong>Leadflow</strong>
            <span>Discovery Console</span>
          </div>
        </div>
        <div className="identity">
          <div className="user-avatar-sm" aria-hidden="true">
            {me.user.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
          </div>
          <div>
            <strong>{me.user.name}</strong>
            <span>{me.organization.name}</span>
          </div>
          <button type="button" onClick={() => void logout()}>
            Switch user
          </button>
        </div>
      </header>
      <main className="dashboard">
        <section className="hero-row">
          <div>
            <p className="eyebrow">Workspace · {me.organization.name}</p>
            <h1>Find, verify, and review leads.</h1>
            <p>Search companies, verify contacts, and manage your qualified lead pipeline.</p>
          </div>
          <div className="hero-stat">
            <span>Available balance</span>
            <strong>{credits}</strong>
            <small>search credits</small>
          </div>
        </section>
        <div className="dashboard-grid">
          <SearchForm
            credits={credits}
            submitting={submitting}
            jobActive={jobActive}
            canRetry={canRetry}
            error={submitError}
            onSubmit={submitSearch}
          />
          <JobProgress
            job={job}
            error={jobError}
            cancelling={cancelling}
            onCancel={() => void cancelJob()}
          />
        </div>
        <Inbox
          leads={leads}
          jobs={jobs}
          filter={leadFilter}
          loading={leadsLoading}
          error={leadsError}
          onFilterChange={(filter) => {
            setLeadFilter(filter);
            void loadLeads(filter);
          }}
          onRefresh={() => void loadLeads()}
        />
      </main>
    </div>
  );
}
