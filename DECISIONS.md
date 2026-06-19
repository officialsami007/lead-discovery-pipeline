# Decisions

## Key architecture decisions (async job system)

- **Two-stage async pipeline.** `POST /api/jobs` charges and creates the job, returns `job_id` immediately, and never blocks on discovery or verification. Work runs as two separate pg-boss queues — `discover-job` then `verify-job` — with the job row as the source of truth: `queued → discovering → verifying → completed | failed` (plus `cancelled`). Verification is its own stage, not a synchronous loop inside the HTTP handler.
- **pg-boss on the same PostgreSQL.** Durable queue with no Redis or extra service; queue state is transactional with application data and queryable with the same tools. BullMQ (needs Redis) or SQS/Cloud Tasks (cross-service hop, second billing line) were not worth the added surface at this scale.
- **Atomic credit charge.** Job insert + credit decrement (`WHERE credits > 0`) + ledger row commit in one transaction. An `Idempotency-Key` plus a unique `(organization_id, idempotency_key)` constraint dedupes double-clicks and retries — so a job cannot double-spend or be created twice.
- **Tenant isolation enforced in the database.** `leads` and `credit_transactions` reference `search_jobs` via a composite foreign key `(job_id, organization_id)`, backed by `UNIQUE(id, organization_id)`. The engine rejects any cross-org `job_id`/`lead_id` even if an API-layer check is ever bypassed by a future code path.
- **Idempotent discovery inserts.** Leads insert with `ON CONFLICT DO NOTHING` on `(job_id, provider_candidate_key)`. A worker retry, the crash-recovery hook, or stuck-job reconciliation can re-run discovery without duplicating leads — candidate keys are deterministic per job.
- **SSE for progress, not polling.** One connection per active job; the API watches the job row and pushes an update only when `updated_at` changes. Lower load than interval polling, reuses the plain-HTTP Fastify stack, and needs no client-side timers or de-duplication.

## What I'd do differently with 2 more days

- **Keyset (cursor) pagination instead of `OFFSET`.** Lists currently page with `LIMIT/OFFSET`, which rescans skipped rows and can duplicate or drop a lead when new rows arrive between page requests. I'd switch to a `(created_at, id)` keyset with a covering index for stable, index-only reads.
- **Worker throughput and provider resilience.** Verification runs sequentially (`for` loop over pending leads); I'd process with bounded concurrency and wrap the real Tavily/Groq adapters in per-provider rate limiting, timeouts, retry classification (transient vs permanent), and a circuit breaker.
- **Operational visibility and limits.** Add metrics and tracing (stage latency, queue depth, retry/failure rates) with alerting, and a per-org rate limit on `POST /api/jobs`. Today there are good structured logs but no metrics, dashboards, or throttle.

## Risks accepted for the time box

- **Demo-grade authentication.** Login identifies a seeded user without a password. Sessions are signed, HTTP-only, server-side, and membership-checked — appropriate for the assessment, but not production identity assurance (no passwords/OAuth, MFA, or rotation).
- **No throttling or scale modelling for real providers.** Verification is sequential and there is no per-org rate limit on starting searches, so a 50-candidate job is slow and a burst of submits is unbounded. Acceptable for the demo's small, deterministic batches; real load would need the concurrency, rate-limiting, and quota handling noted above.
