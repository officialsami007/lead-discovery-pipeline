import { leads, searchJobs } from '@lead/db';
import type { QueueJobPayload } from '@lead/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { ProcessorDependencies } from './types.js';

export class SimulatedDiscoverCrashError extends Error {
  constructor() {
    super('Simulated crash after discovery commit.');
    this.name = 'SimulatedDiscoverCrashError';
  }
}

export async function processDiscovery(
  payload: QueueJobPayload,
  dependencies: ProcessorDependencies
): Promise<{ discoveredCount: number }> {
  const { db, discoverProvider, logger } = dependencies;
  const [job] = await db
    .select()
    .from(searchJobs)
    .where(
      and(eq(searchJobs.id, payload.jobId), eq(searchJobs.organizationId, payload.organizationId))
    )
    .limit(1);

  if (!job) {
    logger.warn({ ...payload, stage: 'discover' }, 'Scoped search job was not found');
    return { discoveredCount: 0 };
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return { discoveredCount: job.discoveredCount };
  }
  if (job.status === 'verifying') {
    await dependencies.enqueueVerify(payload);
    return { discoveredCount: job.discoveredCount };
  }

  const [transitioned] = await db
    .update(searchJobs)
    .set({
      status: 'discovering',
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(searchJobs.id, payload.jobId),
        eq(searchJobs.organizationId, payload.organizationId),
        inArray(searchJobs.status, ['queued', 'discovering'])
      )
    )
    .returning({ id: searchJobs.id });

  if (!transitioned) {
    return { discoveredCount: job.discoveredCount };
  }

  const candidates = await discoverProvider.discover(job.searchInput, {
    jobId: job.id,
    organizationId: job.organizationId
  });

  const [currentJob] = await db
    .select({ status: searchJobs.status, discoveredCount: searchJobs.discoveredCount })
    .from(searchJobs)
    .where(
      and(eq(searchJobs.id, payload.jobId), eq(searchJobs.organizationId, payload.organizationId))
    )
    .limit(1);
  if (!currentJob || currentJob.status === 'cancelled') {
    return { discoveredCount: currentJob?.discoveredCount ?? 0 };
  }

  const discoveredCount = await db.transaction(async (tx) => {
    if (candidates.length > 0) {
      await tx
        .insert(leads)
        .values(
          candidates.map((candidate) => ({
            organizationId: job.organizationId,
            jobId: job.id,
            providerCandidateKey: candidate.providerCandidateKey,
            name: candidate.name,
            company: candidate.company,
            title: candidate.title,
            email: candidate.email,
            sourceUrl: candidate.sourceUrl,
            status: 'unverified_raw' as const
          }))
        )
        .onConflictDoNothing({ target: [leads.jobId, leads.providerCandidateKey] });
    }

    const [result] = await tx
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.jobId, job.id), eq(leads.organizationId, job.organizationId)));
    const value = result?.value ?? 0;

    await tx
      .update(searchJobs)
      .set({ discoveredCount: value, updatedAt: new Date() })
      .where(
        and(eq(searchJobs.id, payload.jobId), eq(searchJobs.organizationId, payload.organizationId))
      );
    return value;
  });

  logger.info(
    { ...payload, stage: 'discover', discoveredCount },
    'Discovery stage committed candidates'
  );

  if (dependencies.crashAfterDiscoverCommit) {
    throw new SimulatedDiscoverCrashError();
  }

  const [continuation] = await db
    .select({ status: searchJobs.status })
    .from(searchJobs)
    .where(
      and(eq(searchJobs.id, payload.jobId), eq(searchJobs.organizationId, payload.organizationId))
    )
    .limit(1);
  if (continuation?.status !== 'cancelled') {
    await dependencies.enqueueVerify(payload);
  }
  return { discoveredCount };
}
