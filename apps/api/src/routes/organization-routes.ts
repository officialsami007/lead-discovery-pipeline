import { organizations } from '@lead/db';
import type { Database } from '@lead/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createAuthenticate, requireAuth } from '../auth.js';
import { AppError } from '../errors.js';

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  db: Database
): Promise<void> {
  const authenticate = createAuthenticate(db);

  app.get('/api/organizations/current', { preHandler: authenticate }, async (request) => {
    const auth = requireAuth(request);
    const [organization] = await db
      .select({ id: organizations.id, name: organizations.name, credits: organizations.credits })
      .from(organizations)
      .where(eq(organizations.id, auth.organizationId))
      .limit(1);
    if (!organization) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
    return { organization };
  });
}
