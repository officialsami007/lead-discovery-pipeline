import type { Database } from '@lead/db';
import { searchJobs } from '@lead/db';
import { QUEUE_NAMES, type QueueJobPayload } from '@lead/shared';
import { and, inArray, lt } from 'drizzle-orm';
import PgBoss from 'pg-boss';
import type { Logger } from 'pino';

const RETRY_LIMIT = 2;
// Must exceed the longest legitimate job run. AI search (Groq + several Tavily calls) can take
// well over 30s, so align this with the queue's expireInSeconds (120) to avoid re-running
// jobs that are simply still in progress.
const DEFAULT_STALE_AFTER_MS = 120_000;

export interface ReconciliationPublisher {
  publishDiscovery(payload: QueueJobPayload): Promise<void>;
  publishVerification(payload: QueueJobPayload): Promise<void>;
}

export async function createBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  await boss.createQueue(QUEUE_NAMES.discover);
  await boss.createQueue(QUEUE_NAMES.verify);
  return boss;
}

export async function enqueueDiscover(boss: PgBoss, payload: QueueJobPayload): Promise<void> {
  await boss.send(QUEUE_NAMES.discover, payload, {
    retryLimit: RETRY_LIMIT,
    retryDelay: 2,
    retryBackoff: true,
    singletonKey: `discover:${payload.jobId}`,
    expireInSeconds: 120
  });
}

export async function enqueueVerify(boss: PgBoss, payload: QueueJobPayload): Promise<void> {
  await boss.send(QUEUE_NAMES.verify, payload, {
    retryLimit: RETRY_LIMIT,
    retryDelay: 2,
    retryBackoff: true,
    singletonKey: `verify:${payload.jobId}`,
    expireInSeconds: 120
  });
}

export async function reconcileStuckJobs(
  db: Database,
  publisher: ReconciliationPublisher,
  logger: Logger,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
): Promise<number> {
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const stuckJobs = await db
    .select({
      id: searchJobs.id,
      organizationId: searchJobs.organizationId,
      status: searchJobs.status
    })
    .from(searchJobs)
    .where(
      and(
        inArray(searchJobs.status, ['queued', 'discovering', 'verifying']),
        lt(searchJobs.updatedAt, staleBefore)
      )
    )
    .limit(100);

  for (const job of stuckJobs) {
    const payload = { jobId: job.id, organizationId: job.organizationId };
    if (job.status === 'verifying') {
      await publisher.publishVerification(payload);
    } else {
      await publisher.publishDiscovery(payload);
    }
    logger.warn(
      { ...payload, status: job.status, stage: 'reconcile' },
      'Re-published stale pipeline job'
    );
  }

  return stuckJobs.length;
}

export function startStuckJobReconciler(
  db: Database,
  boss: PgBoss,
  logger: Logger,
  intervalMs = 10_000,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
): NodeJS.Timeout {
  const reconcile = async (): Promise<void> => {
    try {
      const count = await reconcileStuckJobs(
        db,
        {
          publishDiscovery: (payload) => enqueueDiscover(boss, payload),
          publishVerification: (payload) => enqueueVerify(boss, payload)
        },
        logger,
        staleAfterMs
      );
      if (count > 0) {
        logger.info({ stage: 'reconcile', jobs: count }, 'Stale-job reconciliation completed');
      }
    } catch (error) {
      logger.error({ error, stage: 'reconcile' }, 'Stale-job reconciliation failed');
    }
  };

  void reconcile();
  return setInterval(() => void reconcile(), intervalMs);
}

export { DEFAULT_STALE_AFTER_MS, RETRY_LIMIT };
