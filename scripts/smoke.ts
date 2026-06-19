/**
 * End-to-end smoke test against a live running service.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
 *
 * Requires the full Docker stack (or dev server) to be running with seeded data.
 * Exits 0 on success, 1 on failure.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const DEMO_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // Dana Park — 100 credits

let cookieJar = '';

async function req<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean }
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init?.headers as Record<string, string>)
  };
  if (cookieJar && !init?.skipAuth) headers['cookie'] = cookieJar;

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar = setCookie.split(';')[0] ?? cookieJar;

  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function poll<T>(
  fn: () => Promise<T>,
  until: (value: T) => boolean,
  timeoutMs = 30_000,
  intervalMs = 800
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (until(value)) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('poll() timed out');
}

console.log(`Smoke test → ${BASE_URL}\n`);

// ── 1. Health check ──────────────────────────────────────────────────────────
console.log('1. Health check');
const health = await req<{ status: string }>('/api/health');
assert(health.status === 200, 'GET /api/health returns 200');
assert(health.body.status === 'ok', 'Health body is { status: "ok" }');

// ── 2. Unauthenticated rejection ─────────────────────────────────────────────
console.log('\n2. Unauthenticated access');
const unauth = await req<{ error: { code: string } }>('/api/me', { skipAuth: true });
assert(unauth.status === 401, 'GET /api/me without session returns 401');

// ── 3. Demo login ────────────────────────────────────────────────────────────
console.log('\n3. Demo login');
const login = await req<{ ok: boolean }>('/api/auth/demo-login', {
  method: 'POST',
  body: JSON.stringify({ userId: DEMO_USER_ID }),
  skipAuth: true
});
assert(login.status === 200, 'POST /api/auth/demo-login returns 200');
assert(login.body.ok === true, 'Login body is { ok: true }');
assert(!!cookieJar, 'Session cookie was set');

// ── 4. /api/me ───────────────────────────────────────────────────────────────
console.log('\n4. /api/me after login');
const me = await req<{ user: { name: string }; organization: { credits: number } }>('/api/me');
assert(me.status === 200, 'GET /api/me returns 200');
assert(me.body.user.name === 'Dana Park', 'Correct user returned');
assert(me.body.organization.credits >= 0, 'Credits is non-negative');

const creditsBefore = me.body.organization.credits;

// ── 5. Create a job ──────────────────────────────────────────────────────────
console.log('\n5. Job creation');
const idempotencyKey = crypto.randomUUID();
const createJob = await req<{ jobId: string; status: string }>('/api/jobs', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify({
    companiesOrKeywords: ['Marriott'],
    roles: ['Director of Sales'],
    region: 'Malaysia'
  })
});
assert(createJob.status === 202, 'POST /api/jobs returns 202');
assert(typeof createJob.body.jobId === 'string', 'Response includes jobId');
assert(createJob.body.status === 'queued', 'Initial status is queued');

const jobId = createJob.body.jobId;
console.log(`  job id: ${jobId}`);

// ── 6. Credit deduction ──────────────────────────────────────────────────────
console.log('\n6. Credit deduction');
const meAfter = await req<{ organization: { credits: number } }>('/api/me');
assert(meAfter.body.organization.credits === creditsBefore - 1, 'One credit was deducted');

// ── 7. Idempotency — replay same key ─────────────────────────────────────────
console.log('\n7. Idempotency');
const replay = await req<{ jobId: string }>('/api/jobs', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify({
    companiesOrKeywords: ['Marriott'],
    roles: ['Director of Sales'],
    region: 'Malaysia'
  })
});
assert(replay.body.jobId === jobId, 'Replay returns same job ID');
const meAfterReplay = await req<{ organization: { credits: number } }>('/api/me');
assert(
  meAfterReplay.body.organization.credits === creditsBefore - 1,
  'Replay does not deduct another credit'
);

// ── 8. Wait for completion ───────────────────────────────────────────────────
console.log('\n8. Waiting for pipeline to complete (up to 30s)…');
const finalJob = await poll(
  () =>
    req<{ job: { status: string; discoveredCount: number; verifiedCount: number } }>(
      `/api/jobs/${jobId}`
    ),
  (r) => ['completed', 'failed', 'cancelled'].includes(r.body.job.status)
);
assert(finalJob.body.job.status === 'completed', 'Job reached completed status');
assert(finalJob.body.job.discoveredCount > 0, 'At least one lead was discovered');
console.log(
  `  discovered=${finalJob.body.job.discoveredCount} verified=${finalJob.body.job.verifiedCount}`
);

// ── 9. Inbox leads ───────────────────────────────────────────────────────────
console.log('\n9. Inbox');
const inbox = await req<{ items: unknown[]; total: number }>('/api/leads?status=all');
assert(inbox.status === 200, 'GET /api/leads returns 200');
assert(inbox.body.items.length > 0, 'Inbox contains at least one lead');

// ── 10. Logout ───────────────────────────────────────────────────────────────
console.log('\n10. Logout');
const logout = await req<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' });
assert(logout.status === 200, 'POST /api/auth/logout returns 200');
const afterLogout = await req<{ error: { code: string } }>('/api/me');
assert(afterLogout.status === 401, 'GET /api/me after logout returns 401');

console.log('\n✓ All 10 smoke tests passed.\n');
