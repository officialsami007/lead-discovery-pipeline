import { leads } from '@lead/db';
import type { Database } from '@lead/db';
import { leadFilterSchema, paginationSchema } from '@lead/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createAuthenticate, requireAuth } from '../auth.js';
import { toLeadDto } from '../mappers.js';

export async function registerLeadRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const authenticate = createAuthenticate(db);
  app.get('/api/leads', { preHandler: authenticate }, async (request) => {
    const auth = requireAuth(request);
    const query = request.query as Record<string, unknown>;
    const page = paginationSchema.parse(query);
    const filter = leadFilterSchema.parse(query.status ?? 'all');
    const status = filter === 'unverified' ? 'unverified_raw' : filter === 'all' ? null : filter;
    const where = status
      ? and(eq(leads.organizationId, auth.organizationId), eq(leads.status, status))
      : eq(leads.organizationId, auth.organizationId);
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(leads)
        .where(where)
        .orderBy(desc(leads.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ value: count() }).from(leads).where(where)
    ]);
    return {
      items: rows.map(toLeadDto),
      total: totalRows[0]?.value ?? 0,
      limit: page.limit,
      offset: page.offset
    };
  });
}
