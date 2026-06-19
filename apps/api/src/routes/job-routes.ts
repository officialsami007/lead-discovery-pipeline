import { leads, searchJobs } from '@lead/db';
import type { Database } from '@lead/db';
import { idempotencyKeySchema, jobSearchInputSchema, paginationSchema } from '@lead/shared';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createAuthenticate, requireAuth } from '../auth.js';
import { AppError } from '../errors.js';
import { toJobDto, toLeadDto } from '../mappers.js';
import type { JobService } from '../services/job-service.js';

export async function registerJobRoutes(
  app: FastifyInstance,
  db: Database,
  jobService: JobService
): Promise<void> {
  const authenticate = createAuthenticate(db);

  app.post('/api/jobs', { preHandler: authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const rawKey = request.headers['idempotency-key'];
    if (typeof rawKey !== 'string') {
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A UUID Idempotency-Key header is required.'
      );
    }
    const idempotencyKey = idempotencyKeySchema.parse(rawKey);
    const searchInput = jobSearchInputSchema.parse(request.body);
    const job = await jobService.create({ auth, idempotencyKey, searchInput });
    reply.code(202);
    return { jobId: job.id, status: job.status };
  });

  app.get('/api/jobs', { preHandler: authenticate }, async (request) => {
    const auth = requireAuth(request);
    const page = paginationSchema.parse(request.query);
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(searchJobs)
        .where(eq(searchJobs.organizationId, auth.organizationId))
        .orderBy(desc(searchJobs.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      db
        .select({ value: count() })
        .from(searchJobs)
        .where(eq(searchJobs.organizationId, auth.organizationId))
    ]);
    return {
      items: items.map(toJobDto),
      total: totalRows[0]?.value ?? 0,
      limit: page.limit,
      offset: page.offset
    };
  });

  app.get<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId',
    { preHandler: authenticate },
    async (request) => {
      const auth = requireAuth(request);
      const job = await jobService.get(auth.organizationId, request.params.jobId);
      return { job: toJobDto(job) };
    }
  );

  // SSE endpoint — streams job status updates until terminal state or client disconnect
  app.get<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId/events',
    { preHandler: authenticate },
    async (request, reply) => {
      const auth = requireAuth(request);
      const jobId = request.params.jobId;

      const initial = await jobService.get(auth.organizationId, jobId);

      reply.hijack();
      const res = reply.raw;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const sendData = (data: object): void => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // stream already closed
        }
      };

      sendData(toJobDto(initial));

      const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

      if (TERMINAL.has(initial.status)) {
        res.end();
        return;
      }

      let lastUpdatedMs = initial.updatedAt.getTime();
      let closed = false;

      const pollInterval = setInterval(async () => {
        if (closed) return;
        try {
          const [current] = await db
            .select()
            .from(searchJobs)
            .where(
              and(eq(searchJobs.id, jobId), eq(searchJobs.organizationId, auth.organizationId))
            )
            .limit(1);

          if (!current || closed) {
            clearInterval(pollInterval);
            clearInterval(heartbeatInterval);
            if (!res.writableEnded) res.end();
            return;
          }

          if (current.updatedAt.getTime() !== lastUpdatedMs) {
            sendData(toJobDto(current));
            lastUpdatedMs = current.updatedAt.getTime();
          }

          if (TERMINAL.has(current.status)) {
            clearInterval(pollInterval);
            clearInterval(heartbeatInterval);
            setTimeout(() => {
              if (!res.writableEnded) res.end();
            }, 50);
          }
        } catch {
          clearInterval(pollInterval);
          clearInterval(heartbeatInterval);
          if (!res.writableEnded) res.end();
        }
      }, 500);

      const heartbeatInterval = setInterval(() => {
        try {
          if (!res.writableEnded) res.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      await new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          closed = true;
          clearInterval(pollInterval);
          clearInterval(heartbeatInterval);
          resolve();
        });
      });
    }
  );

  app.post<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId/cancel',
    { preHandler: authenticate },
    async (request) => {
      const auth = requireAuth(request);
      const job = await jobService.cancel(auth.organizationId, request.params.jobId);
      return { job: toJobDto(job) };
    }
  );

  app.get<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId/leads',
    { preHandler: authenticate },
    async (request) => {
      const auth = requireAuth(request);
      await jobService.get(auth.organizationId, request.params.jobId);
      const rows = await db
        .select()
        .from(leads)
        .where(
          and(eq(leads.jobId, request.params.jobId), eq(leads.organizationId, auth.organizationId))
        )
        .orderBy(asc(leads.createdAt))
        .limit(100);
      return { items: rows.map(toLeadDto) };
    }
  );
}
