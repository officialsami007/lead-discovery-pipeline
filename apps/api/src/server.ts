import path from 'node:path';
import { createDatabaseClient, databaseUrlFromEnv, loadRootEnv } from '@lead/db';

loadRootEnv();

import { z } from 'zod';
import { buildApp } from './build-app.js';
import { createQueuePublisher } from './queue.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    COOKIE_SECRET: z.string().min(32).optional(),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z.string().default('info'),
    TAVILY_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5)
  })
  .parse(process.env);

const isProduction = env.NODE_ENV === 'production';

// Allow zero-config local runs (`npm run dev` with no .env) while still requiring
// a real secret in production. The fallback is never used when NODE_ENV=production.
const DEV_COOKIE_SECRET = 'local-development-cookie-secret-not-for-production-use';
if (isProduction && !env.COOKIE_SECRET) {
  throw new Error('COOKIE_SECRET is required in production (set it in the environment).');
}
const cookieSecret = env.COOKIE_SECRET ?? DEV_COOKIE_SECRET;

const databaseUrl = databaseUrlFromEnv();
const client = createDatabaseClient(databaseUrl);
const queuePublisher = await createQueuePublisher(databaseUrl);
const app = await buildApp({
  db: client.db,
  queuePublisher,
  logLevel: env.LOG_LEVEL,
  config: {
    cookieSecret,
    isProduction,
    secureCookies: new URL(env.APP_ORIGIN).protocol === 'https:',
    appOrigin: env.APP_ORIGIN,
    staticRoot: path.resolve(process.cwd(), 'apps/web/dist'),
    providers: { tavily: Boolean(env.TAVILY_API_KEY), groq: Boolean(env.GROQ_API_KEY) },
    rateLimit: { limit: env.RATE_LIMIT_PER_MIN, windowMs: 60_000 }
  }
});

await app.listen({ host: '0.0.0.0', port: env.PORT });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'API shutting down');
  await app.close();
  await queuePublisher.close();
  await client.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
