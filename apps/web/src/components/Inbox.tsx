import { Fragment } from 'react';
import type { JobDto, JobSearchInput, LeadDto } from '@lead/shared';
import { isAISearchRequest } from '@lead/shared';

const filters = ['all', 'unverified', 'verified', 'rejected'] as const;

function searchLabel(input: JobSearchInput): string {
  if (isAISearchRequest(input)) {
    const q = input.naturalLanguageQuery;
    return `AI Search — ${q.length > 70 ? q.slice(0, 67) + '…' : q}`;
  }
  const companies = input.companiesOrKeywords.join(', ');
  const roles = input.roles.join(', ');
  return `${companies} · ${roles} · ${input.region}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

interface InboxProps {
  leads: LeadDto[];
  jobs: JobDto[];
  filter: string;
  loading: boolean;
  error: string | null;
  onFilterChange: (filter: string) => void;
  onRefresh: () => void;
}

export function Inbox({ leads, jobs, filter, loading, error, onFilterChange, onRefresh }: InboxProps) {
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  // Group leads by jobId, preserving insertion order (newest job first)
  const grouped = new Map<string, LeadDto[]>();
  for (const lead of leads) {
    const group = grouped.get(lead.jobId);
    if (group) group.push(lead);
    else grouped.set(lead.jobId, [lead]);
  }

  return (
    <section className="panel inbox-panel" aria-labelledby="inbox-title">
      <div className="panel-heading inbox-heading">
        <div>
          <p className="eyebrow">Organization inbox</p>
          <h2 id="inbox-title">Lead review</h2>
        </div>
        <button
          type="button"
          className="button button-ghost"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="filter-row" role="group" aria-label="Filter leads by status">
        {filters.map((item) => (
          <button
            type="button"
            className={filter === item ? 'active' : ''}
            key={item}
            onClick={() => onFilterChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {!error && loading && leads.length === 0 && <div className="table-state">Loading leads…</div>}
      {!error && !loading && leads.length === 0 && (
        <div className="table-state">
          <strong>No leads in this view</strong>
          <span>Completed search results will appear here for this organization only.</span>
        </div>
      )}
      {leads.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Company &amp; role</th>
                <th>Email</th>
                <th>Status</th>
                <th>Score</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.entries()].map(([jobId, groupLeads]) => {
                const job = jobMap.get(jobId);
                const label = job ? searchLabel(job.searchInput) : `Job ${jobId.slice(0, 8)}`;
                const meta = job
                  ? `${shortDate(job.createdAt)} · ${groupLeads.length} lead${groupLeads.length !== 1 ? 's' : ''}`
                  : `${groupLeads.length} lead${groupLeads.length !== 1 ? 's' : ''}`;
                return (
                  <Fragment key={`group-${jobId}`}>
                    <tr className="group-header-row">
                      <td colSpan={6}>
                        <span className="group-label">{label}</span>
                        <span className="group-meta">{meta}</span>
                      </td>
                    </tr>
                    {groupLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <strong>{lead.name}</strong>
                        </td>
                        <td>
                          <strong>{lead.company}</strong>
                          <small>{lead.title}</small>
                        </td>
                        <td>
                          <a href={`mailto:${lead.email}`}>{lead.email}</a>
                          {lead.rejectionReason && (
                            <small className="rejection">{lead.rejectionReason}</small>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill status-${lead.status}`}>
                            {lead.status.replace('_raw', '')}
                          </span>
                        </td>
                        <td>{lead.verificationScore ?? '—'}</td>
                        <td>
                          <a href={lead.sourceUrl} target="_blank" rel="noreferrer">
                            Open ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
