import 'dotenv/config';
import { createDatabaseClient, databaseUrlFromEnv } from '@lead/db';
import { QUEUE_NAMES, type QueueJobPayload } from '@lead/shared';
import pino from 'pino';
import { z } from 'zod';
import {
  createBoss,
  enqueueVerify,
  GroqTavilyDiscoverProvider,
  markJobFailed,
  MockDiscoverProvider,
  MockVerifyProvider,
  processDiscovery,
  processVerification,
  RETRY_LIMIT,
  RouterDiscoverProvider,
  startStuckJobReconciler,
  TavilyDiscoverProvider
} from './index.js';

const env = z
  .object({
    LOG_LEVEL: z.string().default('info'),
    CRASH_AFTER_DISCOVER_COMMIT: z.enum(['true', 'false']).default('false'),
    TAVILY_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    VERIFY_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(700)
  })
  .parse(process.env);

const logger = pino({ level: env.LOG_LEVEL });
const databaseUrl = databaseUrlFromEnv();
const client = createDatabaseClient(databaseUrl);
const boss = await createBoss(databaseUrl);

const guidedProvider = env.TAVILY_API_KEY
  ? new TavilyDiscoverProvider(env.TAVILY_API_KEY, logger)
  : new MockDiscoverProvider();

const aiProvider =
  env.GROQ_API_KEY && env.TAVILY_API_KEY
    ? new GroqTavilyDiscoverProvider(env.GROQ_API_KEY, env.TAVILY_API_KEY, logger)
    : new MockDiscoverProvider();

const discoverProvider = new RouterDiscoverProvider(guidedProvider, aiProvider);

if (!env.TAVILY_API_KEY) {
  logger.warn('TAVILY_API_KEY not set — guided searches will use mock data');
}
if (!env.GROQ_API_KEY) {
  logger.warn('GROQ_API_KEY not set — AI searches will use mock data');
}

const verifyProvider = new MockVerifyProvider(env.VERIFY_DELAY_MS);
const reconciler = startStuckJobReconciler(client.db, boss, logger);

await boss.work<QueueJobPayload>(QUEUE_NAMES.discover, { includeMetadata: true }, async ([job]) => {
  if (!job) return;
  const payload = job.data;
  try {
    await processDiscovery(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: (nextPayload) => enqueueVerify(boss, nextPayload),
      logger,
      crashAfterDiscoverCommit: env.CRASH_AFTER_DISCOVER_COMMIT === 'true'
    });
  } catch (error) {
    logger.error(
      {
        error,
        ...payload,
        stage: 'discover',
        retryAttempt: job.retryCount
      },
      'Discovery job failed'
    );
    if (job.retryCount >= RETRY_LIMIT) {
      await markJobFailed(client.db, payload, 'Discovery failed after automatic retries.');
    }
    throw error;
  }
});

await boss.work<QueueJobPayload>(QUEUE_NAMES.verify, { includeMetadata: true }, async ([job]) => {
  if (!job) return;
  const payload = job.data;
  try {
    await processVerification(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: (nextPayload) => enqueueVerify(boss, nextPayload),
      logger
    });
  } catch (error) {
    logger.error(
      { error, ...payload, stage: 'verify', retryAttempt: job.retryCount },
      'Verification job failed'
    );
    if (job.retryCount >= RETRY_LIMIT) {
      await markJobFailed(client.db, payload, 'Verification failed after automatic retries.');
    }
    throw error;
  }
});

logger.info('Worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutting down');
  clearInterval(reconciler);
  await boss.stop({ graceful: true, timeout: 10_000 });
  await client.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
