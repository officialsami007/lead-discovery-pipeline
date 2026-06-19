## Architecture decisions

### Why pg-boss over BullMQ or a hosted queue (SQS, Cloud Tasks)

pg-boss stores jobs in the same PostgreSQL database used for application state. This eliminates a second infrastructure dependency and makes queue state queryable with the same tools as the rest of the data. BullMQ requires Redis and is otherwise comparable for our throughput. SQS or Cloud Tasks would remove operational burden in exchange for adding a cross-service hop, a second billing line, and a harder-to-reason-about failure boundary at job creation time.

### Why composite foreign keys instead of API-layer-only tenant checks

The `leads` table references `search_jobs` via `(job_id, organization_id)` rather than `job_id` alone. This means the database engine rejects any insert that provides a valid job ID from a different organization. An API-layer check would prevent this in normal operation but leaves a residual risk from a miscoded query or a future code path that bypasses the check. The composite key costs one extra column in the foreign key definition and nothing at runtime.

### Why `ON CONFLICT DO NOTHING` instead of upsert on lead inserts

Discovery may run more than once for the same job because of the crash-recovery hook or post-commit reconciliation. A simple conflict-ignore insert on `(job_id, provider_candidate_key)` makes every retry safe without needing to decide which version of a candidate is "newer". Upsert would be correct too, but conflict-ignore is simpler and the candidate data is deterministic per job so neither approach loses information.

### Why cursor pagination instead of offset

`OFFSET n` requires the database to scan and discard `n` rows per page. More importantly, if a new lead is inserted between two page requests, offset pagination either duplicates or skips a row. Cursor pagination encodes `(created_at, id)` as an opaque token and queries `WHERE (created_at, id) < (cursor_t, cursor_id)`. Reads are index-only, pages are consistent even with concurrent writes, and the query plan uses the existing `leads_org_status_created_idx` without a full-table scan.

### Why Server-Sent Events instead of polling for job progress

The frontend previously polled `GET /api/jobs/:jobId` every 1.5 seconds. This generates constant requests even when nothing has changed. SSE opens a single HTTP connection per active job; the API polls the database every 500 ms and pushes updates only when `updated_at` changes. The client receives near-realtime updates with lower server load, no client-side timer management, and no duplicate-detection logic. Unlike WebSockets, SSE travels over plain HTTP and reuses the existing Fastify stack with no additional library.

### Risks accepted for the time box

* Demo login identifies a seeded user without a password; sessions are signed, HTTP-only, server-side, membership-checked, and appropriate for the assessment, but not production identity assurance.
* Mock providers process candidates sequentially and do not model external API throttling, batching, quotas, or provider-specific retry semantics.
* The credit top-up endpoint does not insert an audit ledger row; the `credit_transactions` table currently enforces `amount = -1` for search charges only. A real system would add a `credit_topup` transaction type and loosen the check constraint.
