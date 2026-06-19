import { z } from 'zod';

export const JOB_STATUSES = [
  'queued',
  'discovering',
  'verifying',
  'completed',
  'failed',
  'cancelled'
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LEAD_STATUSES = ['unverified_raw', 'verified', 'rejected'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const QUEUE_NAMES = {
  discover: 'discover-job',
  verify: 'verify-job'
} as const;

const trimmedString = z.string().trim().min(1).max(120);

export const searchRequestSchema = z
  .object({
    companiesOrKeywords: z.array(trimmedString).min(1).max(20),
    roles: z.array(trimmedString).min(1).max(20),
    region: z.string().trim().min(1).max(120)
  })
  .transform((value) => ({
    companiesOrKeywords: normalizeList(value.companiesOrKeywords),
    roles: normalizeList(value.roles),
    region: value.region.replace(/\s+/g, ' ').trim()
  }));

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const aiSearchRequestSchema = z.object({
  naturalLanguageQuery: z.string().trim().min(10).max(1000)
});

export type AISearchRequest = z.infer<typeof aiSearchRequestSchema>;

export const jobSearchInputSchema = z.union([searchRequestSchema, aiSearchRequestSchema]);

export type JobSearchInput = SearchRequest | AISearchRequest;

export function isAISearchRequest(input: JobSearchInput): input is AISearchRequest {
  return 'naturalLanguageQuery' in input;
}

export function isGuidedSearchRequest(input: JobSearchInput): input is SearchRequest {
  return 'companiesOrKeywords' in input;
}

export const idempotencyKeySchema = z.string().uuid();

export const demoLoginSchema = z.object({
  userId: z.string().uuid()
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const leadFilterSchema = z
  .enum(['all', 'unverified', 'verified', 'rejected'])
  .default('all');

export interface CandidateLead {
  providerCandidateKey: string;
  name: string;
  company: string;
  title: string;
  email: string;
  sourceUrl: string;
}

export interface VerificationResult {
  ok: boolean;
  score: number;
  reason?: string;
}

export interface DiscoverContext {
  jobId: string;
  organizationId: string;
}

export interface DiscoverProvider {
  discover(input: JobSearchInput, context: DiscoverContext): Promise<CandidateLead[]>;
}

export interface VerifyProvider {
  verify(candidate: CandidateLead): Promise<VerificationResult>;
}

export interface AuthContext {
  userId: string;
  organizationId: string;
}

export interface QueueJobPayload {
  jobId: string;
  organizationId: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface JobDto {
  id: string;
  status: JobStatus;
  searchInput: JobSearchInput;
  discoveredCount: number;
  verifiedCount: number;
  rejectedCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface LeadDto {
  id: string;
  jobId: string;
  name: string;
  company: string;
  title: string;
  email: string;
  sourceUrl: string;
  status: LeadStatus;
  verificationScore: number | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function normalizeList(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const raw of values) {
    const normalizedWhitespace = raw.replace(/\s+/g, ' ').trim();
    if (!normalizedWhitespace) continue;
    const key = normalizedWhitespace.toLocaleLowerCase('en');
    if (!unique.has(key)) unique.set(key, normalizedWhitespace);
  }
  return [...unique.values()];
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
