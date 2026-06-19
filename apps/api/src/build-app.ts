import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { Database } from '@lead/db';
import type { ApiErrorBody } from '@lead/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerJobRoutes } from './routes/job-routes.js';
import { registerLeadRoutes } from './routes/lead-routes.js';
import { registerOrganizationRoutes } from './routes/organization-routes.js';
import { JobService } from './services/job-service.js';
import type { ApiConfig, QueuePublisher } from './types.js';

interface BuildAppOptions {
  db: Database;
  queuePublisher: QueuePublisher;
  config: ApiConfig;
  logLevel?: string | false;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logLevel ? { level: options.logLevel } : false });
  app.decorateRequest('auth', null);
  await app.register(cookie, { secret: options.config.cookieSecret, hook: 'onRequest' });
  await app.register(cors, {
    origin: options.config.isProduction ? options.config.appOrigin : true,
    credentials: true
  });

  app.get('/api/health', async () => {
    await options.db.execute('select 1');
    return { status: 'ok' };
  });

  // Public: lets the UI warn when discovery is running on mock data (no API keys configured).
  app.get('/api/config', async () => {
    const { tavily, groq } = options.config.providers;
    return {
      providers: { tavily, groq },
      // Guided search uses Tavily; AI search additionally needs Groq.
      guidedMode: tavily ? 'live' : 'mock',
      aiMode: tavily && groq ? 'live' : 'mock'
    };
  });

  const jobService = new JobService(options.db, options.queuePublisher, app.log);
  await registerAuthRoutes(app, options.db, options.config);
  await registerJobRoutes(app, options.db, jobService);
  await registerLeadRoutes(app, options.db);
  await registerOrganizationRoutes(app, options.db);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'Request failed');
    let statusCode = 500;
    let body: ApiErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }
    };
    if (error instanceof AppError) {
      statusCode = error.statusCode;
      body = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      };
    } else if (error instanceof ZodError) {
      statusCode = 400;
      body = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request was invalid.',
          details: error.flatten()
        }
      };
    }
    void reply.code(statusCode).send(body);
  });

  const staticRoot = options.config.staticRoot;
  if (staticRoot && fs.existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: path.resolve(staticRoot), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
