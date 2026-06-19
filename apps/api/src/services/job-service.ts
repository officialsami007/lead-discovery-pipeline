import { creditTransactions, organizations, searchJobs } from '@lead/db';
import type { Database } from '@lead/db';
import type { AuthContext, JobSearchInput } from '@lead/shared';
import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { AppError, isPostgresUniqueViolation } from '../errors.js';
import type { QueuePublisher } from '../types.js';

interface CreateJobInput {
  auth: AuthContext;
  idempotencyKey: string;
  searchInput: JobSearchInput;
}

export class JobService {
  constructor(
    private readonly db: Database,
    private readonly queuePublisher: QueuePublisher,
    private readonly logger: FastifyBaseLogger
  ) {}

  async create(input: CreateJobInput) {
    let job: typeof searchJobs.$inferSelect;
    try {
      job = await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(searchJobs)
          .where(
            and(
              eq(searchJobs.organizationId, input.auth.organizationId),
              eq(searchJobs.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (existing) return existing;

        const [chargedOrganization] = await tx
          .update(organizations)
          .set({ credits: sql`${organizations.credits} - 1`, updatedAt: new Date() })
          .where(and(eq(organizations.id, input.auth.organizationId), gt(organizations.credits, 0)))
          .returning({ id: organizations.id });

        if (!chargedOrganization) {
          throw new AppError(
            409,
            'INSUFFICIENT_CREDITS',
            'This organization has no search credits remaining.'
          );
        }

        const [created] = await tx
          .insert(searchJobs)
          .values({
            organizationId: input.auth.organizationId,
            userId: input.auth.userId,
            idempotencyKey: input.idempotencyKey,
            searchInput: input.searchInput,
            status: 'queued'
          })
          .returning();
        if (!created) throw new Error('Job insert returned no row.');

        await tx.insert(creditTransactions).values({
          organizationId: input.auth.organizationId,
          jobId: created.id,
          amount: -1,
          transactionType: 'search_charge'
        });

        return created;
      });
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) throw error;
      const [existing] = await this.db
        .select()
        .from(searchJobs)
        .where(
          and(
            eq(searchJobs.organizationId, input.auth.organizationId),
            eq(searchJobs.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (!existing) throw error;
      job = existing;
    }

    try {
      await this.queuePublisher.publishDiscovery({
        jobId: job.id,
        organizationId: job.organizationId
      });
    } catch (error) {
      this.logger.error(
        { error, jobId: job.id, organizationId: job.organizationId, stage: 'publish-discover' },
        'Discovery publication failed; worker reconciliation will retry queued jobs'
      );
    }
    return job;
  }

  async list(organizationId: string, limit: number, offset: number) {
    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(searchJobs)
        .where(eq(searchJobs.organizationId, organizationId))
        .orderBy(desc(searchJobs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(searchJobs)
        .where(eq(searchJobs.organizationId, organizationId))
    ]);
    return { items, total: totalRows[0]?.value ?? 0 };
  }

  async cancel(organizationId: string, jobId: string) {
    const job = await this.get(organizationId, jobId);
    if (!['queued', 'discovering', 'verifying'].includes(job.status)) {
      throw new AppError(409, 'JOB_NOT_CANCELLABLE', 'Only an active job can be cancelled.');
    }

    const [cancelled] = await this.db
      .update(searchJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(searchJobs.id, jobId),
          eq(searchJobs.organizationId, organizationId),
          inArray(searchJobs.status, ['queued', 'discovering', 'verifying'])
        )
      )
      .returning();

    if (cancelled) return cancelled;
    const current = await this.get(organizationId, jobId);
    throw new AppError(409, 'JOB_NOT_CANCELLABLE', `Job is already ${current.status}.`);
  }

  async get(organizationId: string, jobId: string) {
    const [job] = await this.db
      .select()
      .from(searchJobs)
      .where(and(eq(searchJobs.id, jobId), eq(searchJobs.organizationId, organizationId)))
      .limit(1);
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');
    return job;
  }
}
