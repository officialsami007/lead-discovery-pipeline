# Lead Pipeline — Multi-Tenant B2B Lead Discovery & Verification

A production-minded technical take-home implementation for a B2B SaaS CRM. A signed-in demo user submits lead criteria, the API atomically creates and charges a job, and PostgreSQL-backed `pg-boss` workers run separate **discover** and **verify** stages before organization-scoped results appear in the inbox.

## Assessment feature checklist

- [x] TypeScript npm-workspaces monorepo with React/Vite, Fastify, PostgreSQL, Drizzle, pg-boss and Vitest
- [x] Two organizations, two users, memberships and different seeded credit balances
- [x] Signed HTTP-only cookie sessions with server-side session records
- [x] Organization context derived only from the authenticated session
- [x] Organization-scoped job and lead queries that return `404` for cross-tenant IDs
- [x] Database-level non-negative credits, lead/job tenant consistency, charge uniqueness and lead idempotency constraints
- [x] Atomic job creation, one-credit deduction and auditable credit ledger
- [x] Request idempotency with concurrent duplicate protection
- [x] Durable, separate `discover-job` and `verify-job` queue stages
- [x] Deterministic mock discovery and verification providers
- [x] Worker retry safety, zero-result completion, controlled crash-recovery hook and stale-stage reconciliation
- [x] Dashboard with demo login, current credits, validated search form, backend-driven progress, cancellation and filterable inbox
- [x] Organization-scoped pagination metadata for job and lead lists
- [x] Docker Compose, migrations, idempotent seed, health checks and production container
- [x] Automated cross-organization, credit, idempotency and recovery tests
- [x] GitHub Actions and Render/Neon deployment configuration

## Technology choices

| Area    | Choice                      | Reason                                                                                |
| ------- | --------------------------- | ------------------------------------------------------------------------------------- |
| UI      | React 19 + Vite             | Small, fast SPA with a simple development proxy and static production build           |
| API     | Fastify 5 + Zod             | Typed, testable route layer with low overhead and clear validation                    |
| Storage | PostgreSQL 16 + Drizzle ORM | Real transactions and constraints for tenancy, credits and idempotency                |
| Queue   | pg-boss                     | Durable PostgreSQL-backed jobs without requiring Redis or another service             |
| Tests   | Vitest + Fastify inject     | Fast API integration tests while still exercising a real isolated PostgreSQL database |
| Logging | Pino                        | Structured job, tenant, stage, attempt and count logging                              |

## Quick start with Docker

Requirements: Docker Desktop or Docker Engine with Compose.

```bash
docker compose up --build
```

Open **http://localhost:3000**. Compose starts PostgreSQL, waits for health, runs migrations, seeds demo data, then launches separate API and worker services. The API serves the production React build.

Useful commands:

```bash
docker compose logs -f api worker
docker compose down
docker compose down -v   # also removes local database data
```

## Demo users

No password is required for the assessment demo. Use the login cards:

| User         | Email                    | Organization       | Initial credits |
| ------------ | ------------------------ | ------------------ | --------------: |
| Alex Morgan  | `alex@northstar.demo`    | Northstar Hotels   |              10 |
| Bailey Chen  | `bailey@harborview.demo` | Harborview Group   |               2 |
| Casey Reyes  | `casey@meridian.demo`    | Meridian Consulting|              50 |
| Dana Park    | `dana@atlas.demo`        | Atlas Group        |             100 |
| Jordan Silva | `jordan@solaris.demo`    | Solaris Ventures   |              75 |

The fixed identities are only accepted by the demo-login endpoint. After login, the server creates a random server-side session and sends only its signed identifier in an HTTP-only, SameSite cookie.

## Non-Docker development

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Development URLs:

- Vite frontend: `http://localhost:5173`
- Fastify API: `http://localhost:3000`
- Health check: `http://localhost:3000/api/health`

`npm run dev` builds the shared/database workspaces first, then starts the API, worker and Vite server. Vite proxies `/api` to Fastify.

### Commands

```bash
npm run dev:api
npm run dev:worker
npm run db:migrate
npm run db:seed
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` creates a uniquely named test database, runs SQL migrations, executes the suite serially against that real database, and drops it afterward. It uses `TEST_DATABASE_ADMIN_URL` when provided, otherwise `postgres://postgres:postgres@localhost:5432/postgres`. When PostgreSQL is unreachable and Docker is available, the script starts only the Compose `db` service automatically.

## API surface

```text
POST   /api/auth/demo-login
POST   /api/auth/logout
GET    /api/me
POST   /api/jobs
GET    /api/jobs
GET    /api/jobs/:jobId
GET    /api/jobs/:jobId/leads
POST   /api/jobs/:jobId/cancel
GET    /api/leads
GET    /api/organizations/current
GET    /api/health
```

Job and lead list responses include `limit`, `offset`, and organization-scoped `total` metadata. Cancellation is optional assessment functionality and is allowed only while a job is queued, discovering, or verifying.

## Architecture

```mermaid
flowchart LR
  B[Browser / React SPA] -->|signed cookie + HTTP| A[Fastify API]
  A -->|scoped reads / atomic writes| P[(PostgreSQL)]
  A -->|publish discover-job after commit| Q[pg-boss queue tables]
  Q --> D[Discover worker]
  D -->|idempotent candidate inserts| L[(Leads)]
  D -->|publish verify-job| Q
  Q --> V[Verify worker]
  V -->|verified / rejected + final counts| L
  L -->|organization-scoped inbox| A
```

Runtime responsibilities remain separate:

1. `apps/web` is the React SPA.
2. `apps/api` handles HTTP, sessions, authorization and atomic job creation. It never discovers or verifies leads.
3. `apps/worker` owns queue consumers, provider calls and pipeline transitions.

Docker Compose runs API and worker as separate services. The production Docker entry point starts them as separate Node child processes inside one web-service container so the demo can be deployed as one web service. Queue state remains durable in PostgreSQL and worker code remains a separate entry point.

## Request and pipeline sequence

```mermaid
sequenceDiagram
  participant UI as Browser
  participant API as Fastify API
  participant DB as PostgreSQL
  participant Q as pg-boss
  participant W as Worker

  UI->>API: POST /api/jobs + Idempotency-Key
  API->>DB: BEGIN
  API->>DB: find scoped duplicate key
  API->>DB: decrement credit WHERE credits > 0
  API->>DB: insert queued job + one ledger row
  API->>DB: COMMIT
  API->>Q: publish discover-job
  API-->>UI: 202 { jobId, status: queued }
  W->>DB: status = discovering
  W->>W: deterministic discover provider
  W->>DB: INSERT ... ON CONFLICT DO NOTHING
  W->>Q: publish verify-job with stable singleton key
  W->>DB: status = verifying
  W->>W: deterministic verifier per raw lead
  W->>DB: verified/rejected updates + recalculated counts
  W->>DB: status = completed
  UI->>API: poll scoped job and inbox
```

## Database model overview

- `organizations`: tenant and credit balance; `CHECK (credits >= 0)`.
- `users`: demo identities.
- `organization_memberships`: composite primary key for unique membership.
- `sessions`: random server-side session ID, user, active organization and expiry.
- `search_jobs`: normalized JSON input, lifecycle timestamps/counts and unique `(organization_id, idempotency_key)`.
- `leads`: unique `(job_id, provider_candidate_key)` and composite foreign key `(job_id, organization_id) -> search_jobs(id, organization_id)`.
- `credit_transactions`: immutable `-1` search charges with a partial unique index allowing at most one charge per job.
- `pgboss.*`: durable queue schema managed by pg-boss.

SQL migrations live in `packages/db/migrations`. The seed uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so restarting Compose does not reset balances or duplicate identities.

## Multi-tenancy enforcement

The client never supplies an organization ID for business operations. Authentication resolves a signed cookie to a server-side session, then verifies a current membership and attaches:

```ts
{
  userId: string;
  organizationId: string;
}
```

Every protected job/lead query includes the session organization directly in its SQL predicate, for example `id = requested_id AND organization_id = session_org`. The API does not fetch globally and compare afterward. Cross-tenant job IDs therefore produce the same `404` as unknown IDs.

Storage adds another boundary: a lead's `(job_id, organization_id)` must match the parent job's composite unique key. A lead cannot be inserted with a valid job ID and a different tenant ID.

## Atomic credits and request idempotency

Job creation runs in one PostgreSQL transaction:

1. Read an existing job by session organization and idempotency key.
2. Decrement the organization only with `WHERE credits > 0`.
3. Insert the queued job.
4. Insert the one-per-job `search_charge` ledger row.
5. Commit.
6. Publish discovery only after commit.

Two concurrent requests may both begin, but the unique `(organization_id, idempotency_key)` constraint is authoritative. The losing insert aborts and rolls back its credit update, after which the service returns the existing scoped job. The ledger's unique search-charge index independently prevents duplicate charges.

The frontend creates one UUID per intentional form submission. A network/server retry button reuses that UUID; a new intentional submission gets a new one.

## Queue publication recovery

There is a small post-commit window where the database transaction can succeed but queue publishing can fail. The worker periodically scans stale `queued`, `discovering`, and `verifying` jobs. Queued/discovering jobs republish discovery; verifying jobs republish verification. A staleness threshold avoids racing normal in-flight work, and every publication includes the scoped organization ID plus a stable singleton key. Repeated reconciliation is safe because processors are idempotent and database constraints remain authoritative.

For a larger system, the preferred improvement is the transactional outbox described in `DECISIONS.md`.

## Worker idempotency and crash recovery

Discovery uses a deterministic provider based on job ID and normalized input. Every candidate has a stable provider key and inserts use `ON CONFLICT DO NOTHING` against `(job_id, provider_candidate_key)`. The discovered count is recalculated from stored rows rather than incremented in memory.

The controlled `crashAfterDiscoverCommit` dependency/test hook throws after candidate insertion and count commit but before successful continuation. It is disabled by default. On retry, discovery regenerates the same candidates, conflict handling creates zero duplicates, and verification is published again with `singletonKey = verify:<jobId>`.

Verification only processes `unverified_raw` rows and applies updates using job ID and organization ID. A retry after partial progress skips already resolved rows, recalculates all counts, and completes the job. Zero-candidate jobs still run/finalize verification and complete with all counts at zero. Cancellation is organization-scoped and terminal; worker transitions and final writes use guarded status predicates so a late retry cannot turn a cancelled job into a completed or failed job. Search credits are not refunded on cancellation.

Queue sends use two retries with exponential backoff. The worker logs job ID, organization ID, stage, retry count, result counts and errors. On the final failed attempt it stores a safe failure message and marks the job `failed`; stack traces remain in server logs, not browser responses.

## Mock providers and replacing them

`MockDiscoverProvider`:

- is deterministic for a job and normalized input;
- returns 0–50 candidates;
- guarantees a useful Marriott / Director of Sales / Malaysia demo;
- includes `info@`, `noreply@` and invalid-email cases;
- returns zero for the keyword `zero-results`.

`MockVerifyProvider` rejects invalid syntax, `noreply@` and `info@`, otherwise returns a deterministic score from 50–100.

Both implement shared interfaces and are injected into processors. A real implementation would live beside the mocks, implement the same interface, accept secrets/config in its constructor, and be selected in `apps/worker/src/main.ts`. Provider-specific rate limits, timeouts and retry classification belong inside the adapter; durable stage retries stay in pg-boss.

## Testing strategy

The suite contains **20 tests** against a real isolated PostgreSQL database and covers:

- invalid search payloads;
- zero-credit rejection;
- exact credit and ledger deduction;
- sequential and concurrent request idempotency (same key);
- concurrent requests with different keys when only one credit remains — exactly one succeeds;
- unauthenticated route rejection plus positive and negative tenant controls;
- cross-organization job and lead/inbox isolation;
- organization-scoped pagination totals and cancellation;
- stale queued/discovering/verifying reconciliation;
- discovery insert idempotency;
- committed-discovery crash recovery;
- verifier rejection rules;
- zero-result completion;
- final transitions and count consistency;
- membership revocation invalidates an active session;
- data persistence verified across a new database connection.

Fastify routes are tested with `inject`; worker processors are imported and invoked directly with real database state. Provider/network calls remain deterministic and local.

## Deployment: Render + Neon

The repository includes a production multi-stage `Dockerfile` and `render.yaml`.

1. Push the repository to GitHub.
2. Create a free Neon PostgreSQL project and copy its pooled connection string. Include `sslmode=require` if Neon provides it.
3. In Render, create a **Blueprint** from the repository or a new **Web Service** using the Docker runtime.
4. Set `DATABASE_URL` to the Neon connection string.
5. Set `APP_ORIGIN` to the final Render HTTPS URL, without a trailing slash.
6. Let Render generate `COOKIE_SECRET`, or provide at least 32 random characters.
7. Keep `NODE_ENV=production`, `PORT=3000`, and health path `/api/health`.
8. Deploy. The container applies migrations, runs the idempotent seed, then starts API and worker child processes.

Cookies are HTTP-only and SameSite=Lax; they become `Secure` automatically when `APP_ORIGIN` uses HTTPS, while local HTTP remains usable. In production mode, CORS accepts only `APP_ORIGIN`. No deployment URL is hard-coded.

A live service is not included in this ZIP because this execution environment has no GitHub, Render or Neon account credentials. The repository is deployment-ready; do not claim a live URL until the service is actually created and smoke-tested.

## Known gaps

- Demo authentication proves session and tenant handling but intentionally has no password/OIDC flow.
- The free-host single container starts API and worker as supervised child processes instead of independently scaled services.
- Provider calls are deterministic mocks and do not model real quotas, throttling or bulk APIs.
- Queue publication recovery uses reconciliation rather than a first-class transactional outbox.
- Pagination is limit/offset and capped at 100; high-volume production usage would use cursor pagination.
- Cancellation is cooperative: an external provider call already in progress may finish, but guarded worker writes preserve the cancelled terminal state.

## Production hardening

Add PostgreSQL row-level security as defense in depth, with the active tenant set transaction-locally by the API/worker. Replace post-commit publication with a transactional outbox and a publisher that records delivery attempts. Run API, discover workers and verify workers as separately autoscaled services, with queue-specific concurrency and provider rate limits. Add OIDC/passwordless authentication, CSRF protection for state-changing browser requests, session rotation/revocation, secret management and audit events. Introduce OpenTelemetry traces, metrics for queue age/retries/provider latency, centralized logs and alerts for stuck jobs or credit anomalies. Add provider timeouts, circuit breakers, retryable/non-retryable error classification and dead-letter tooling. Use cursor pagination, retention/archival policies and data deletion workflows. Add load, chaos, migration rollback and browser end-to-end tests, plus dependency/container scanning and scheduled backups with restore drills.

## Repository notes

This implementation was created from scratch for the assessment and does not include copied proprietary code or an unrelated UI template.
