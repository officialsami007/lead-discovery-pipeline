import type { ApiErrorBody, JobDto, JobSearchInput, LeadDto } from '@lead/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body?.error.message ?? 'The request failed.',
      body?.error.code ?? 'REQUEST_FAILED',
      response.status,
      body?.error.details
    );
  }
  return (await response.json()) as T;
}

export interface MeResponse {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; credits: number };
}

export const api = {
  me: () => request<MeResponse>('/api/me'),
  login: (userId: string) =>
    request<{ ok: true }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ userId })
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  createJob: (input: JobSearchInput, idempotencyKey: string) =>
    request<{ jobId: string; status: string }>('/api/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input)
    }),
  getJob: (jobId: string) => request<{ job: JobDto }>(`/api/jobs/${jobId}`),
  cancelJob: (jobId: string) =>
    request<{ job: JobDto }>(`/api/jobs/${jobId}/cancel`, { method: 'POST', body: '{}' }),
  listJobs: () => request<{ items: JobDto[]; total: number }>('/api/jobs?limit=20'),
  listLeads: (status: string) =>
    request<{ items: LeadDto[]; total: number }>(
      `/api/leads?status=${encodeURIComponent(status)}&limit=100`
    )
};

/**
 * Opens an EventSource to the job SSE endpoint. Calls onEvent with each parsed
 * JobDto. Calls onClose when the stream ends. Returns a cleanup function.
 */
export function openJobEventStream(
  jobId: string,
  onEvent: (job: JobDto) => void,
  onClose: () => void
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/events`);

  es.onmessage = (event) => {
    try {
      const job = JSON.parse(event.data as string) as JobDto;
      onEvent(job);
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    es.close();
    onClose();
  };

  return () => es.close();
}
