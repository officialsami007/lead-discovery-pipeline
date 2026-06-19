import { randomUUID } from 'node:crypto';
import { buildApp } from '@lead/api';
import {
  createDatabaseClient,
  creditTransactions,
  DEMO_IDS,
  leads,
  organizationMemberships,
  organizations,
  searchJobs,
  seedDemoData,
  type DatabaseClient
} from '@lead/db';
import type { QueueJobPayload, SearchRequest } from '@lead/shared';
import {
  MockDiscoverProvider,
  MockVerifyProvider,
  processDiscovery,
  processVerification,
  reconcileStuckJobs,
  SimulatedDiscoverCrashError
} from '@lead/worker';
import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');

const searchInput: SearchRequest = {
  companiesOrKeywords: ['Marriott'],
  roles: ['Director of Sales'],
  region: 'Malaysia'
};

let client: DatabaseClient;
let app: FastifyInstance;
let published: QueueJobPayload[];
const logger = pino({ level: 'silent' });
const discoverProvider = new MockDiscoverProvider();
const verifyProvider = new MockVerifyProvider();

async function resetDatabase(): Promise<void> {
  await client.db.execute(sql`
    TRUNCATE TABLE credit_transactions, leads, search_jobs, sessions,
      organization_memberships, users, organizations RESTART IDENTITY CASCADE
  `);
  await seedDemoData(client.db);
}

async function login(userId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/demo-login',
    payload: { userId }
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.headers['set-cookie'];
  expect(cookie).toBeTypeOf('string');
  return (cookie as string).split(';')[0]!;
}

async function createJob(cookie: string, input = searchInput, key = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: '/api/jobs',
    headers: { cookie, 'idempotency-key': key },
    payload: input
  });
}

async function getJobRow(id: string) {
  const [job] = await client.db.select().from(searchJobs).where(eq(searchJobs.id, id)).limit(1);
  if (!job) throw new Error(`Missing job ${id}`);
  return job;
}

beforeAll(() => {
  client = createDatabaseClient(databaseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  published = [];
  app = await buildApp({
    db: client.db,
    queuePublisher: {
      publishDiscovery: async (payload) => {
        published.push(payload);
      },
      close: async () => undefined
    },
    config: {
      cookieSecret: 'test-cookie-secret-that-is-at-least-thirty-two-chars',
      isProduction: false,
      secureCookies: false,
      appOrigin: 'http://localhost:3000'
    }
  });
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await client.close();
});

describe('assessment requirements', () => {
  it('rejects an empty companies/keywords array', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const response = await createJob(cookie, {
      companiesOrKeywords: [],
      roles: ['Director of Sales'],
      region: 'Malaysia'
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('prevents an organization with zero credits from creating a job', async () => {
    await client.db
      .update(organizations)
      .set({ credits: 0 })
      .where(eq(organizations.id, DEMO_IDS.organizationA));
    const cookie = await login(DEMO_IDS.userA);
    const response = await createJob(cookie);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_CREDITS');
    const [jobs] = await client.db.select({ value: count() }).from(searchJobs);
    expect(jobs?.value).toBe(0);
  });

  it('deducts exactly one credit and records one ledger entry', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const response = await createJob(cookie);
    expect(response.statusCode).toBe(202);
    const [org] = await client.db
      .select({ credits: organizations.credits })
      .from(organizations)
      .where(eq(organizations.id, DEMO_IDS.organizationA));
    const [ledger] = await client.db.select({ value: count() }).from(creditTransactions);
    expect(org?.credits).toBe(9);
    expect(ledger?.value).toBe(1);
    expect(published).toHaveLength(1);
  });

  it('returns one job and charges once for a repeated idempotency key', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const key = randomUUID();
    const first = await createJob(cookie, searchInput, key);
    const second = await createJob(cookie, searchInput, key);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(first.json().jobId).toBe(second.json().jobId);
    const [org] = await client.db
      .select({ credits: organizations.credits })
      .from(organizations)
      .where(eq(organizations.id, DEMO_IDS.organizationA));
    const [jobCount] = await client.db.select({ value: count() }).from(searchJobs);
    const [ledgerCount] = await client.db.select({ value: count() }).from(creditTransactions);
    expect(org?.credits).toBe(9);
    expect(jobCount?.value).toBe(1);
    expect(ledgerCount?.value).toBe(1);
  });

  it('cannot double-charge concurrent duplicate submissions', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const key = randomUUID();
    const [first, second] = await Promise.all([
      createJob(cookie, searchInput, key),
      createJob(cookie, searchInput, key)
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
    expect(first.json().jobId).toBe(second.json().jobId);
    const [org] = await client.db
      .select({ credits: organizations.credits })
      .from(organizations)
      .where(eq(organizations.id, DEMO_IDS.organizationA));
    const [ledgerCount] = await client.db.select({ value: count() }).from(creditTransactions);
    expect(org?.credits).toBe(9);
    expect(ledgerCount?.value).toBe(1);
  });

  it('returns 404 when Organization A requests Organization B job ID', async () => {
    const cookieA = await login(DEMO_IDS.userA);
    const cookieB = await login(DEMO_IDS.userB);
    const createdB = await createJob(cookieB);
    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${createdB.json().jobId}`,
      headers: { cookie: cookieA }
    });
    expect(response.statusCode).toBe(404);
  });

  it('does not expose Organization B leads through job leads or inbox', async () => {
    const cookieA = await login(DEMO_IDS.userA);
    const cookieB = await login(DEMO_IDS.userB);
    const createdB = await createJob(cookieB);
    const jobB = await getJobRow(createdB.json().jobId);
    await processDiscovery(
      { jobId: jobB.id, organizationId: jobB.organizationId },
      {
        db: client.db,
        discoverProvider,
        verifyProvider,
        enqueueVerify: async () => undefined,
        logger
      }
    );
    const scopedJobLeads = await app.inject({
      method: 'GET',
      url: `/api/jobs/${jobB.id}/leads`,
      headers: { cookie: cookieA }
    });
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/leads',
      headers: { cookie: cookieA }
    });
    expect(scopedJobLeads.statusCode).toBe(404);
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().items).toHaveLength(0);
  });

  it('running discovery twice does not duplicate candidates', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const created = await createJob(cookie);
    const job = await getJobRow(created.json().jobId);
    const payload = { jobId: job.id, organizationId: job.organizationId };
    const dependencies = {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    };
    const first = await processDiscovery(payload, dependencies);
    const second = await processDiscovery(payload, dependencies);
    const [leadCount] = await client.db
      .select({ value: count() })
      .from(leads)
      .where(eq(leads.jobId, job.id));
    expect(first.discoveredCount).toBeGreaterThanOrEqual(3);
    expect(second.discoveredCount).toBe(first.discoveredCount);
    expect(leadCount?.value).toBe(first.discoveredCount);
  });

  it('recovers after a crash following discovery commit without duplicate leads', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const created = await createJob(cookie);
    const job = await getJobRow(created.json().jobId);
    const payload = { jobId: job.id, organizationId: job.organizationId };
    await expect(
      processDiscovery(payload, {
        db: client.db,
        discoverProvider,
        verifyProvider,
        enqueueVerify: async () => undefined,
        logger,
        crashAfterDiscoverCommit: true
      })
    ).rejects.toBeInstanceOf(SimulatedDiscoverCrashError);
    const [afterCrash] = await client.db
      .select({ value: count() })
      .from(leads)
      .where(eq(leads.jobId, job.id));
    await processDiscovery(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    });
    await processVerification(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    });
    const [afterRecovery] = await client.db
      .select({ value: count() })
      .from(leads)
      .where(eq(leads.jobId, job.id));
    const recoveredJob = await getJobRow(job.id);
    expect(afterCrash?.value).toBeGreaterThan(0);
    expect(afterRecovery?.value).toBe(afterCrash?.value);
    expect(recoveredJob.status).toBe('completed');
  });

  it('verification rejects info@ and noreply@ addresses', async () => {
    const base = {
      providerCandidateKey: 'candidate',
      name: 'Test Lead',
      company: 'Example',
      title: 'Director',
      sourceUrl: 'https://example.com'
    };
    const info = await verifyProvider.verify({ ...base, email: 'info@example.com' });
    const noReply = await verifyProvider.verify({ ...base, email: 'noreply@example.com' });
    expect(info.ok).toBe(false);
    expect(info.reason).toContain('Generic info');
    expect(noReply.ok).toBe(false);
    expect(noReply.reason).toContain('No-reply');
  });

  it('completes a zero-candidate discovery successfully', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const created = await createJob(cookie, {
      companiesOrKeywords: ['zero-results'],
      roles: ['Director'],
      region: 'Malaysia'
    });
    const job = await getJobRow(created.json().jobId);
    const payload = { jobId: job.id, organizationId: job.organizationId };
    await processDiscovery(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    });
    const counts = await processVerification(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    });
    const completed = await getJobRow(job.id);
    expect(counts).toEqual({ discoveredCount: 0, verifiedCount: 0, rejectedCount: 0 });
    expect(completed.status).toBe('completed');
  });

  it('produces correct final status and verified/rejected counts', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const created = await createJob(cookie);
    const job = await getJobRow(created.json().jobId);
    const payload = { jobId: job.id, organizationId: job.organizationId };
    await processDiscovery(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    });
    const counts = await processVerification(payload, {
      db: client.db,
      discoverProvider,
      verifyProvider,
      enqueueVerify: async () => undefined,
      logger
    });
    const completed = await getJobRow(job.id);
    const [remainingRaw] = await client.db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.jobId, job.id), eq(leads.status, 'unverified_raw')));
    expect(completed.status).toBe('completed');
    expect(counts.discoveredCount).toBe(counts.verifiedCount + counts.rejectedCount);
    expect(counts.verifiedCount).toBeGreaterThanOrEqual(3);
    expect(counts.rejectedCount).toBeGreaterThanOrEqual(2);
    expect(remainingRaw?.value).toBe(0);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('allows an organization to read its own job as a positive tenancy control', async () => {
    const cookieB = await login(DEMO_IDS.userB);
    const created = await createJob(cookieB);
    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${created.json().jobId}`,
      headers: { cookie: cookieB }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().job.id).toBe(created.json().jobId);
  });

  it('returns organization-scoped pagination totals', async () => {
    const cookieA = await login(DEMO_IDS.userA);
    const cookieB = await login(DEMO_IDS.userB);
    await createJob(cookieA);
    await createJob(cookieA);
    await createJob(cookieB);

    const response = await app.inject({
      method: 'GET',
      url: '/api/jobs?limit=1&offset=0',
      headers: { cookie: cookieA }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().total).toBe(2);
  });

  it('cancels only an active job in the authenticated organization', async () => {
    const cookieA = await login(DEMO_IDS.userA);
    const cookieB = await login(DEMO_IDS.userB);
    const created = await createJob(cookieA);
    const jobId = created.json().jobId as string;

    const crossTenant = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: { cookie: cookieB },
      payload: {}
    });
    expect(crossTenant.statusCode).toBe(404);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: { cookie: cookieA },
      payload: {}
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe('cancelled');

    const job = await getJobRow(jobId);
    await processDiscovery(
      { jobId: job.id, organizationId: job.organizationId },
      {
        db: client.db,
        discoverProvider,
        verifyProvider,
        enqueueVerify: async () => undefined,
        logger
      }
    );
    const afterWorkerRetry = await getJobRow(jobId);
    const [leadCount] = await client.db
      .select({ value: count() })
      .from(leads)
      .where(eq(leads.jobId, jobId));
    expect(afterWorkerRetry.status).toBe('cancelled');
    expect(leadCount?.value).toBe(0);

    const secondCancel = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: { cookie: cookieA },
      payload: {}
    });
    expect(secondCancel.statusCode).toBe(409);
    expect(secondCancel.json().error.code).toBe('JOB_NOT_CANCELLABLE');
  });

  it('two concurrent requests with different keys cannot both consume the last credit', async () => {
    await client.db
      .update(organizations)
      .set({ credits: 1 })
      .where(eq(organizations.id, DEMO_IDS.organizationA));
    const cookie = await login(DEMO_IDS.userA);
    const [first, second] = await Promise.all([
      createJob(cookie, searchInput, randomUUID()),
      createJob(cookie, searchInput, randomUUID())
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    // Exactly one succeeds (202) and one fails (409 insufficient credits)
    expect(codes).toEqual([202, 409]);
    const codes409 = [first, second].filter((r) => r.statusCode === 409);
    expect(codes409[0]?.json().error.code).toBe('INSUFFICIENT_CREDITS');
    const [org] = await client.db
      .select({ credits: organizations.credits })
      .from(organizations)
      .where(eq(organizations.id, DEMO_IDS.organizationA));
    const [jobCount] = await client.db.select({ value: count() }).from(searchJobs);
    const [ledgerCount] = await client.db.select({ value: count() }).from(creditTransactions);
    expect(org?.credits).toBe(0);
    expect(jobCount?.value).toBe(1);
    expect(ledgerCount?.value).toBe(1);
  });

  it('invalidates session when organization membership is revoked', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const before = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(before.statusCode).toBe(200);
    await client.db.delete(organizationMemberships).where(
      and(
        eq(organizationMemberships.userId, DEMO_IDS.userA),
        eq(organizationMemberships.organizationId, DEMO_IDS.organizationA)
      )
    );
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('job and lead data persists across new database connections', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const created = await createJob(cookie);
    const jobId = created.json().jobId as string;
    const job = await getJobRow(jobId);
    await processDiscovery(
      { jobId: job.id, organizationId: job.organizationId },
      { db: client.db, discoverProvider, verifyProvider, enqueueVerify: async () => undefined, logger }
    );
    const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
    const freshClient = createDatabaseClient(testUrl);
    try {
      const [persisted] = await freshClient.db
        .select()
        .from(searchJobs)
        .where(eq(searchJobs.id, jobId))
        .limit(1);
      const [leadCount] = await freshClient.db
        .select({ value: count() })
        .from(leads)
        .where(eq(leads.jobId, jobId));
      expect(persisted?.status).toBe('discovering');
      expect(leadCount?.value).toBeGreaterThan(0);
    } finally {
      await freshClient.close();
    }
  });

  it('reconciles stale queued, discovering and verifying jobs by stage', async () => {
    const cookie = await login(DEMO_IDS.userA);
    const queuedId = (await createJob(cookie)).json().jobId as string;
    const discoveringId = (await createJob(cookie)).json().jobId as string;
    const verifyingId = (await createJob(cookie)).json().jobId as string;
    const staleAt = new Date(Date.now() - 60_000);

    await client.db
      .update(searchJobs)
      .set({ status: 'queued', updatedAt: staleAt })
      .where(eq(searchJobs.id, queuedId));
    await client.db
      .update(searchJobs)
      .set({ status: 'discovering', updatedAt: staleAt })
      .where(eq(searchJobs.id, discoveringId));
    await client.db
      .update(searchJobs)
      .set({ status: 'verifying', updatedAt: staleAt })
      .where(eq(searchJobs.id, verifyingId));

    const discoveryPublications: string[] = [];
    const verificationPublications: string[] = [];
    const reconciled = await reconcileStuckJobs(
      client.db,
      {
        publishDiscovery: async (payload) => {
          discoveryPublications.push(payload.jobId);
        },
        publishVerification: async (payload) => {
          verificationPublications.push(payload.jobId);
        }
      },
      logger,
      30_000
    );

    expect(reconciled).toBe(3);
    expect(discoveryPublications.sort()).toEqual([queuedId, discoveringId].sort());
    expect(verificationPublications).toEqual([verifyingId]);
  });
});
