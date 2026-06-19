import { leads, searchJobs } from '@lead/db';
import type { CandidateLead, QueueJobPayload } from '@lead/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { ProcessorDependencies } from './types.js';

export async function processVerification(
  payload: QueueJobPayload,
  dependencies: ProcessorDependencies
): Promise<{ discoveredCount: number; verifiedCount: number; rejectedCount: number }> {
  const { db, verifyProvider, logger } = dependencies;
  const [job] = await db
    .select()
    .from(searchJobs)
    .where(
      and(eq(searchJobs.id, payload.jobId), eq(searchJobs.organizationId, payload.organizationId))
    )
    .limit(1);

  if (!job) {
    logger.warn({ ...payload, stage: 'verify' }, 'Scoped search job was not found');
    return { discoveredCount: 0, verifiedCount: 0, rejectedCount: 0 };
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return {
      discoveredCount: job.discoveredCount,
      verifiedCount: job.verifiedCount,
      rejectedCount: job.rejectedCount
    };
  }

  const [transitioned] = await db
    .update(searchJobs)
    .set({ status: 'verifying', updatedAt: new Date() })
    .where(
      and(
        eq(searchJobs.id, payload.jobId),
        eq(searchJobs.organizationId, payload.organizationId),
        inArray(searchJobs.status, ['queued', 'discovering', 'verifying'])
      )
    )
    .returning({ id: searchJobs.id });

  if (!transitioned) {
    return {
      discoveredCount: job.discoveredCount,
      verifiedCount: job.verifiedCount,
      rejectedCount: job.rejectedCount
    };
  }

  const pendingLeads = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.jobId, payload.jobId),
        eq(leads.organizationId, payload.organizationId),
        eq(leads.status, 'unverified_raw')
      )
    );

  for (const lead of pendingLeads) {
    const candidate: CandidateLead = {
      providerCandidateKey: lead.providerCandidateKey,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      email: lead.email,
      sourceUrl: lead.sourceUrl
    };
    const result = await verifyProvider.verify(candidate);
    await db
      .update(leads)
      .set({
        status: result.ok ? 'verified' : 'rejected',
        verificationScore: result.score,
        rejectionReason: result.ok ? null : (result.reason ?? 'Verification rejected this lead.'),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(leads.id, lead.id),
          eq(leads.jobId, payload.jobId),
          eq(leads.organizationId, payload.organizationId),
          eq(leads.status, 'unverified_raw')
        )
      );
  }

  const [discoveredRow] = await db
    .select({ value: count() })
    .from(leads)
    .where(and(eq(leads.jobId, payload.jobId), eq(leads.organizationId, payload.organizationId)));
  const [verifiedRow] = await db
    .select({ value: count() })
    .from(leads)
    .where(
      and(
        eq(leads.jobId, payload.jobId),
        eq(leads.organizationId, payload.organizationId),
        eq(leads.status, 'verified')
      )
    );
  const [rejectedRow] = await db
    .select({ value: count() })
    .from(leads)
    .where(
      and(
        eq(leads.jobId, payload.jobId),
        eq(leads.organizationId, payload.organizationId),
        eq(leads.status, 'rejected')
      )
    );

  const counts = {
    discoveredCount: discoveredRow?.value ?? 0,
    verifiedCount: verifiedRow?.value ?? 0,
    rejectedCount: rejectedRow?.value ?? 0
  };

  const [completed] = await db
    .update(searchJobs)
    .set({
      status: 'completed',
      ...counts,
      completedAt: new Date(),
      updatedAt: new Date(),
      errorMessage: null
    })
    .where(
      and(
        eq(searchJobs.id, payload.jobId),
        eq(searchJobs.organizationId, payload.organizationId),
        inArray(searchJobs.status, ['queued', 'discovering', 'verifying'])
      )
    )
    .returning({ id: searchJobs.id });

  if (completed) {
    logger.info({ ...payload, stage: 'verify', ...counts }, 'Verification stage completed');
  } else {
    logger.info({ ...payload, stage: 'verify', ...counts }, 'Verification stopped by cancellation');
  }
  return counts;
}
