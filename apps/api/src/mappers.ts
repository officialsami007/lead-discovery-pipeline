import type { LeadDto, JobDto } from '@lead/shared';
import type { leads, searchJobs } from '@lead/db';

export function toJobDto(job: typeof searchJobs.$inferSelect): JobDto {
  return {
    id: job.id,
    status: job.status,
    searchInput: job.searchInput,
    discoveredCount: job.discoveredCount,
    verifiedCount: job.verifiedCount,
    rejectedCount: job.rejectedCount,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString()
  };
}

export function toLeadDto(lead: typeof leads.$inferSelect): LeadDto {
  return {
    id: lead.id,
    jobId: lead.jobId,
    name: lead.name,
    company: lead.company,
    title: lead.title,
    email: lead.email,
    sourceUrl: lead.sourceUrl,
    status: lead.status,
    verificationScore: lead.verificationScore,
    rejectionReason: lead.rejectionReason,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString()
  };
}
