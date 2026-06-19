import { randomBytes } from 'node:crypto';
import { organizationMemberships, organizations, sessions, users } from '@lead/db';
import type { Database } from '@lead/db';
import { demoLoginSchema } from '@lead/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createAuthenticate, requireAuth, SESSION_COOKIE_NAME } from '../auth.js';
import { AppError } from '../errors.js';
import type { ApiConfig } from '../types.js';

export async function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig
): Promise<void> {
  const authenticate = createAuthenticate(db);

  app.post('/api/auth/demo-login', async (request, reply) => {
    const body = demoLoginSchema.parse(request.body);
    const [identity] = await db
      .select({
        userId: users.id,
        userName: users.name,
        email: users.email,
        organizationId: organizations.id,
        organizationName: organizations.name
      })
      .from(users)
      .innerJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(users.id, body.userId))
      .limit(1);
    if (!identity) throw new AppError(404, 'DEMO_USER_NOT_FOUND', 'Demo user not found.');

    const sessionId = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(sessions).values({
      id: sessionId,
      userId: identity.userId,
      activeOrganizationId: identity.organizationId,
      expiresAt
    });

    reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      signed: true,
      expires: expiresAt
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    const rawCookie = request.cookies[SESSION_COOKIE_NAME];
    if (rawCookie) {
      const unsigned = request.unsignCookie(rawCookie);
      if (unsigned.valid && unsigned.value) {
        await db.delete(sessions).where(eq(sessions.id, unsigned.value));
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: authenticate }, async (request) => {
    const auth = requireAuth(request);
    const [identity] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        organizationId: organizations.id,
        organizationName: organizations.name,
        credits: organizations.credits
      })
      .from(users)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.userId, users.id),
          eq(organizationMemberships.organizationId, auth.organizationId)
        )
      )
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!identity) throw new AppError(401, 'UNAUTHENTICATED', 'Membership is no longer valid.');
    return {
      user: { id: identity.id, name: identity.name, email: identity.email },
      organization: {
        id: identity.organizationId,
        name: identity.organizationName,
        credits: identity.credits
      }
    };
  });
}
