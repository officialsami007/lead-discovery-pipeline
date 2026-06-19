import 'dotenv/config';
import path from 'node:path';
import { createDatabaseClient, databaseUrlFromEnv } from '@lead/db';
import { z } from 'zod';
import { buildApp } from './build-app.js';
import { createQueuePublisher } from './queue.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    COOKIE_SECRET: z.string().min(32),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z.string().default('info')
  })
  .parse(process.env);

const databaseUrl = databaseUrlFromEnv();
const client = createDatabaseClient(databaseUrl);
const queuePublisher = await createQueuePublisher(databaseUrl);
const app = await buildApp({
  db: client.db,
  queuePublisher,
  logLevel: env.LOG_LEVEL,
  config: {
    cookieSecret: env.COOKIE_SECRET,
    isProduction: env.NODE_ENV === 'production',
    secureCookies: new URL(env.APP_ORIGIN).protocol === 'https:',
    appOrigin: env.APP_ORIGIN,
    staticRoot: path.resolve(process.cwd(), 'apps/web/dist')
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
