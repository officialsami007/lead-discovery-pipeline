import { useState } from 'react';
import type { JobDto } from '@lead/shared';

const steps = ['queued', 'discovering', 'verifying', 'completed'] as const;

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
        <div className="empty-icon">↗</div>
        <h2>Pipeline activity will appear here</h2>
        <p>Start a search to watch durable backend stages and result counts update in real time.</p>
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
          <span className={`status-pill status-${job.status}`}>{job.status}</span>
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
              <span className="cancel-confirm-text">Cancel? Credits are not refunded.</span>
              <button
                type="button"
                className="button button-danger"
                onClick={handleConfirmCancel}
                disabled={cancelling}
              >
                Yes, cancel
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={handleAbortCancel}
              >
                Keep running
              </button>
            </span>
          )}
        </div>
      </div>
      <code className="job-id">{job.id}</code>
      <div className="stepper" aria-label={`Current status: ${job.status}`}>
        {steps.map((step, index) => (
          <div className={`step ${index <= currentIndex ? 'active' : ''}`} key={step}>
            <span>{index < currentIndex ? '✓' : index + 1}</span>
            <strong>{step}</strong>
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
      <div className="metric-grid">
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
