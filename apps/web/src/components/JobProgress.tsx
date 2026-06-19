import { useState } from 'react';
import type { JobDto } from '@lead/shared';

const steps = ['queued', 'discovering', 'verifying', 'completed'] as const;

const stepLabel: Record<(typeof steps)[number], string> = {
  queued: 'Queued',
  discovering: 'Finding',
  verifying: 'Verifying',
  completed: 'Done'
};

const statusLabel: Record<string, string> = {
  queued: 'Queued',
  discovering: 'Discovering',
  verifying: 'Verifying',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

interface JobProgressProps {
  job: JobDto | null;
  error: string | null;
  cancelling: boolean;
  onCancel: () => void;
}

export function JobProgress({ job, error, cancelling, onCancel }: JobProgressProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!job && !error) {
    return (
      <section className="panel progress-panel empty-progress">
        <div className="empty-icon" aria-hidden="true">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <h2>Pipeline activity will appear here</h2>
      </section>
    );
  }
  if (error && !job)
    return (
      <section className="panel">
        <div className="alert alert-error">{error}</div>
      </section>
    );
  if (!job) return null;

  const active = ['queued', 'discovering', 'verifying'].includes(job.status);
  const currentIndex =
    job.status === 'failed' || job.status === 'cancelled'
      ? -1
      : steps.indexOf(job.status as (typeof steps)[number]);

  function handleCancelClick(): void {
    setConfirmCancel(true);
  }
  function handleConfirmCancel(): void {
    setConfirmCancel(false);
    onCancel();
  }
  function handleAbortCancel(): void {
    setConfirmCancel(false);
  }

  return (
    <section className="panel progress-panel" aria-labelledby="progress-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Current job</p>
          <h2 id="progress-title">Pipeline progress</h2>
        </div>
        <div className="progress-actions">
          <span className={`status-pill status-${job.status}`}>
            {statusLabel[job.status] ?? job.status}
          </span>
          {active && !confirmCancel && (
            <button
              type="button"
              className="button button-danger-ghost"
              onClick={handleCancelClick}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel job'}
            </button>
          )}
          {active && confirmCancel && (
            <span className="cancel-confirm">
              <span className="cancel-confirm-text">Credits are not refunded.</span>
              <button
                type="button"
                className="button button-danger"
                onClick={handleConfirmCancel}
                disabled={cancelling}
              >
                Yes, cancel
              </button>
              <button type="button" className="button button-ghost" onClick={handleAbortCancel}>
                Keep running
              </button>
            </span>
          )}
        </div>
      </div>
      <div className="job-id-row">
        <span className="job-id-label">Job ID</span>
        <code className="job-id">{job.id}</code>
      </div>
      <div className="stepper" aria-label={`Current status: ${job.status}`}>
        {steps.map((step, index) => (
          <div
            className={`step${index <= currentIndex ? ' active' : ''}${index === currentIndex && active ? ' current' : ''}`}
            key={step}
          >
            <span aria-hidden="true">
              {index < currentIndex ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <strong>{stepLabel[step]}</strong>
          </div>
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {job.status === 'failed' && (
        <div className="alert alert-error">
          {job.errorMessage ?? 'The job failed after automatic retries.'}
        </div>
      )}
      {job.status === 'cancelled' && (
        <div className="alert alert-info">
          The job was cancelled. Its search credit was not refunded.
        </div>
      )}
      <div className="metric-grid" aria-live="polite" aria-label="Job progress metrics">
        <div className={job.discoveredCount > 0 ? 'metric-nonzero' : ''}>
          <span>Discovered</span>
          <strong>{job.discoveredCount}</strong>
        </div>
        <div className={job.verifiedCount > 0 ? 'metric-nonzero metric-verified' : ''}>
          <span>Verified</span>
          <strong>{job.verifiedCount}</strong>
        </div>
        <div className={job.rejectedCount > 0 ? 'metric-nonzero metric-rejected' : ''}>
          <span>Rejected</span>
          <strong>{job.rejectedCount}</strong>
        </div>
      </div>
      {job.status === 'completed' && job.discoveredCount > 0 && (
        <div className="metric-summary">
          {job.verifiedCount} of {job.discoveredCount} leads verified
          {job.rejectedCount > 0 && ` · ${job.rejectedCount} rejected`}
        </div>
      )}
      {job.status === 'completed' && job.discoveredCount === 0 && (
        <div className="alert alert-info">
          The search completed successfully, but no candidates matched.
        </div>
      )}
    </section>
  );
}
