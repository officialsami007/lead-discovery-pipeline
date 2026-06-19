import { organizationMemberships, sessions } from '@lead/db';
import type { Database } from '@lead/db';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export const SESSION_COOKIE_NAME = 'lead_session';

export function createAuthenticate(db: Database) {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const rawCookie = request.cookies[SESSION_COOKIE_NAME];
    if (!rawCookie) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');

    const unsigned = request.unsignCookie(rawCookie);
    if (!unsigned.valid || !unsigned.value) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or expired.');
    }

    const [session] = await db
      .select({ userId: sessions.userId, organizationId: sessions.activeOrganizationId })
      .from(sessions)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.userId, sessions.userId),
          eq(organizationMemberships.organizationId, sessions.activeOrganizationId)
        )
      )
      .where(and(eq(sessions.id, unsigned.value), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or expired.');
    request.auth = session;
  };
}

export function requireAuth(request: FastifyRequest) {
  if (!request.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  return request.auth;
}
