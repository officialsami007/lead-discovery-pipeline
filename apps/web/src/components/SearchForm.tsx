import { useMemo, useState } from 'react';
import type { AISearchRequest, JobSearchInput, SearchRequest } from '@lead/shared';

type SearchMode = 'guided' | 'ai';

function toList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

interface SearchFormProps {
  credits: number;
  submitting: boolean;
  canRetry: boolean;
  error: string | null;
  onSubmit: (input: JobSearchInput, retry: boolean) => Promise<void>;
}

export function SearchForm({ credits, submitting, canRetry, error, onSubmit }: SearchFormProps) {
  const [mode, setMode] = useState<SearchMode>('guided');

  // Guided mode state
  const [companies, setCompanies] = useState('Marriott');
  const [roles, setRoles] = useState('Director of Sales');
  const [region, setRegion] = useState('Malaysia');

  // AI Search mode state
  const [aiQuery, setAiQuery] = useState('');

  // Touched state for inline validation
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const guidedInput = useMemo<SearchRequest>(
    () => ({ companiesOrKeywords: toList(companies), roles: toList(roles), region: region.trim() }),
    [companies, roles, region]
  );

  function getFieldError(field: 'companies' | 'roles' | 'region' | 'aiQuery'): string | null {
    const shouldShow = submitAttempted || touched[field];
    if (!shouldShow) return null;
    if (field === 'companies' && guidedInput.companiesOrKeywords.length === 0)
      return 'Add at least one company or keyword.';
    if (field === 'roles' && guidedInput.roles.length === 0) return 'Add at least one target role.';
    if (field === 'region' && !guidedInput.region) return 'Add a target region.';
    if (field === 'aiQuery' && aiQuery.trim().length < 10)
      return 'Describe your search in at least 10 characters.';
    return null;
  }

  function validate(): boolean {
    setSubmitAttempted(true);
    if (mode === 'guided') {
      return (
        guidedInput.companiesOrKeywords.length > 0 &&
        guidedInput.roles.length > 0 &&
        !!guidedInput.region
      );
    }
    return aiQuery.trim().length >= 10;
  }

  function buildPayload(): JobSearchInput {
    if (mode === 'ai') {
      const payload: AISearchRequest = { naturalLanguageQuery: aiQuery.trim() };
      return payload;
    }
    return guidedInput;
  }

  function switchMode(next: SearchMode): void {
    setMode(next);
    setTouched({});
    setSubmitAttempted(false);
  }

  const blocked = submitting || credits === 0;

  return (
    <section className="panel search-panel" aria-labelledby="search-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New discovery</p>
          <h2 id="search-title">Define your ideal leads</h2>
        </div>
        <div className={`credits-chip ${credits === 0 ? 'empty' : credits <= 5 ? 'low' : ''}`}>
          <strong>{credits}</strong> {credits === 1 ? 'credit' : 'credits'} available
        </div>
      </div>

      <div className="mode-tabs" role="tablist" aria-label="Search mode">
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'guided'}
          className={`mode-tab ${mode === 'guided' ? 'active' : ''}`}
          onClick={() => switchMode('guided')}
          disabled={blocked}
        >
          Guided
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'ai'}
          className={`mode-tab ${mode === 'ai' ? 'active' : ''}`}
          onClick={() => switchMode('ai')}
          disabled={blocked}
        >
          AI Search
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validate()) void onSubmit(buildPayload(), false);
        }}
      >
        {mode === 'guided' ? (
          <div className="field-grid">
            <label>
              <span>Companies or keywords</span>
              <textarea
                value={companies}
                onChange={(event) => setCompanies(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, companies: true }))}
                placeholder="Marriott, Hilton"
                rows={3}
                disabled={blocked}
                aria-invalid={!!getFieldError('companies')}
              />
              {getFieldError('companies') && (
                <small className="field-error">{getFieldError('companies')}</small>
              )}
            </label>
            <label>
              <span>Target roles</span>
              <textarea
                value={roles}
                onChange={(event) => setRoles(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, roles: true }))}
                placeholder="Director of Sales, General Manager"
                rows={3}
                disabled={blocked}
                aria-invalid={!!getFieldError('roles')}
              />
              {getFieldError('roles') && (
                <small className="field-error">{getFieldError('roles')}</small>
              )}
            </label>
            <label>
              <span>Region</span>
              <input
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, region: true }))}
                placeholder="Malaysia"
                disabled={blocked}
                aria-invalid={!!getFieldError('region')}
              />
              {getFieldError('region') && (
                <small className="field-error">{getFieldError('region')}</small>
              )}
            </label>
          </div>
        ) : (
          <div className="field-grid">
            <label className="ai-query-label">
              <span>Describe the leads you want</span>
              <textarea
                value={aiQuery}
                onChange={(event) => setAiQuery(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, aiQuery: true }))}
                placeholder="e.g. Find me hospitality directors at 5-star hotels in Kuala Lumpur with a budget for new vendors"
                rows={5}
                disabled={blocked}
                className="ai-query-textarea"
                aria-invalid={!!getFieldError('aiQuery')}
              />
              {getFieldError('aiQuery') && (
                <small className="field-error">{getFieldError('aiQuery')}</small>
              )}
            </label>
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="form-actions">
          <div className="button-row">
            {canRetry && (
              <button
                className="button button-secondary"
                type="button"
                disabled={submitting}
                onClick={() => validate() && void onSubmit(buildPayload(), true)}
              >
                Retry same request
              </button>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={blocked}
              aria-busy={submitting}
            >
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting
                ? 'Starting…'
                : credits === 0
                  ? 'No credits remaining'
                  : mode === 'ai'
                    ? 'Run AI Search'
                    : 'Start discovery'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
