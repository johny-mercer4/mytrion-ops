# Agent Gateway: Redis Coordination, Backend Idempotency, and Staging Load Test

Status: Proposed
Date: 2026-07-28
Scope: `apps/agent-gateway` and `/v1/support-bot` backend
Goal: Safely run multiple gateway workers without overlapping per-user turns, duplicate writes, or
cross-tenant leakage.

## Executive summary

The next platform slice should introduce three connected controls:

1. Redis coordinates Telegram ingestion, per-user work queues, leases, shared rate limits, button
   ownership, and worker recovery.
2. Postgres is the authoritative idempotency ledger for state-changing backend operations.
3. A staging load harness validates ordering, failure recovery, security, write safety, and response
   latency before production rollout.

```text
Telegram
   │
   ▼
Ingress leader ── atomic enqueue/dedupe ──► Redis Streams
                                               │
                     ┌─────────────────────────┼─────────────────────────┐
                     ▼                         ▼                         ▼
                  Worker A                  Worker B                  Worker C
                     │                         │                         │
                     └──── fenced per-user session ownership ──────────┘
                                               │
                                               ▼
                                  Backend write endpoint
                                               │
                                  Postgres idempotency ledger
                                               │
                                               ▼
                                      ServerCRM / EFS / Desk
```

Redis is coordination infrastructure, not the write-safety source of truth. Postgres idempotency
remains enforced even when there is only one gateway worker.

## Current architecture constraints

- Telegram ingestion uses `getUpdates` long-polling. Multiple replicas cannot independently poll
  the same bot token.
- Per-user queues, confirmation-button ownership, recent senders, auth-token cooldown, Telegram
  throttling, and registration nudges are currently process-local.
- Session IDs are written to `data/sessions.json`, while Claude SDK transcripts live on the local
  gateway filesystem. A different worker cannot safely resume another worker's transcript.
- Backend write routes do not accept idempotency keys.
- Backend read/write rate buckets are process-local and therefore multiply when API replicas scale.
- `apps/agent-gateway/src/sessions.ts` is already near the 580-line target.
- `src/routes/v1/supportBot.routes.ts` exceeds the 600-line cap and includes direct database access
  that should move to repos before feature work.

## Non-goals

- Do not claim exactly-once execution against EFS or another external provider that does not accept
  an idempotency key or expose reconciliation.
- Do not store money-code values, full card numbers, provider credentials, or private DM bodies in
  Redis or the idempotency ledger.
- Do not use production Telegram, client, EFS, ServerCRM, or Desk data in load tests.
- Do not make Redis the authoritative record of whether an external mutation completed.
- Do not attempt cross-worker Claude SDK transcript sharing in this slice.

## Phase 0: prerequisites and baseline

Estimated effort: 1–2 engineering days.

### Refactoring

Split gateway session responsibilities:

- `apps/agent-gateway/src/turnRunner.ts`
- `apps/agent-gateway/src/turnQueue.ts`
- `apps/agent-gateway/src/sessionStore.ts`
- `apps/agent-gateway/src/sessionLifecycle.ts`

Split support-bot routes:

- `src/routes/v1/supportBotRead.routes.ts`
- `src/routes/v1/supportBotWrite.routes.ts`
- `src/routes/v1/supportBotDelivery.routes.ts`
- `src/routes/v1/supportBotSchemas.ts`

Move caller/registration database access into:

- `src/repos/registeredMiniAppCompanyRepo.ts`

Routes must contain no direct database queries. New write execution must continue through the
platform authorization and audit boundary rather than introducing an unguarded handler path.

### Baseline measurements

Capture the single-replica baseline:

- Ingress processing latency
- Queue wait p50/p95/p99
- Time to first token
- Total turn duration
- Tool duration and API resolution rate
- Telegram 429 frequency
- Claude auth-token failover count
- Active subprocess count
- Event-loop lag and RSS

### Acceptance criteria

- Mandatory cross-tenant RBAC tests pass before feature changes.
- No touched file exceeds 600 lines; target is 580 lines.
- Routes contain no new raw database queries.
- Existing agent-gateway tests remain green.
- Baseline report is committed under `eval-reports/`.

## Phase 1: backend idempotency

Estimated effort: 2–3 engineering days.

### Request contract

Every state-changing request receives:

```http
Idempotency-Key: <opaque stable operation ID>
```

The gateway generates the key. The model never supplies or edits it.

Suggested input:

```text
SHA-256(
  environment +
  bot identity +
  turn ID +
  persisted write occurrence +
  tenant/carrier ID +
  verified Telegram user ID +
  tool name +
  canonical validated arguments
)
```

Properties:

- Retrying the same Telegram update generates the same key.
- Recovering the same write on another worker generates the same key.
- One Telegram update is one model turn. A worker drains several updates sequentially but never
  combines them into one prompt.
- The write occurrence is gateway-generated, persisted with the turn, and never model-supplied.
- A new user request generates a new key.
- Reusing a key with a different request payload is rejected.
- The key contains no raw PII or secret value.

### Initial operation coverage

- Money-code draw
- Card activation/deactivation
- Card limit changes
- Card information updates
- Fraud override
- Desk service requests
- Sensitive DM delivery deduplication for manual-code responses

### Database model

Add:

- `src/db/schema/support_bot_operations.ts`
- `src/db/migrations/0058_support_bot_operations.sql`
- `src/repos/supportBotOperationRepo.ts`
- Export from `src/db/schema/index.ts`
- Add the schema file to `drizzle.config.ts`

Suggested columns:

```text
id
tenant_id
idempotency_key
operation_type
request_hash
turn_id
write_occurrence
session_key_hash
fencing_token
actor_telegram_user_id
carrier_id
status
phase
sanitized_response
error_code
lease_expires_at
attempts
created_at
updated_at
completed_at
```

Unique constraint:

```text
(tenant_id, idempotency_key)
```

Add a unique operation slot on `(tenant_id, turn_id, write_occurrence)` so changed model arguments
cannot silently reuse an occurrence, and a turn can be checked before the model is run again.

Statuses:

- `processing`
- `succeeded`
- `failed_safe`
- `unknown`

Phases:

- `claimed`
- `external_started`
- `external_completed`
- `delivery_queued`
- `completed`

### Execution service

Add:

- `src/modules/carrier/supportBotOperationService.ts`
- `src/modules/carrier/canonicalOperationHash.ts`

Execution order:

1. Validate the request.
2. Resolve the live registration and server-side RBAC.
3. Canonicalize the validated arguments.
4. Claim the idempotency key through `supportBotOperationRepo`.
5. Handle an existing operation:
   - `succeeded`: return the stored sanitized response.
   - `processing` with a valid lease: return `409 OPERATION_IN_PROGRESS`.
   - Same key with a different hash: return `409 IDEMPOTENCY_CONFLICT`.
   - `failed_safe`: allow a controlled retry.
   - `unknown`: fail closed and require reconciliation.
6. Persist `external_started`.
7. Call ServerCRM, EFS, or Desk.
8. Persist the sanitized result.
9. Queue notification/delivery with the operation ID as its dedupe key.
10. Mark the operation completed.

Rate-limit tokens should not be consumed again when returning a previously completed idempotent
result.

Fence verification and the operation claim are one Postgres transaction:

```text
lock/read current tenant-scoped session fence
→ verify provided fence equals the current fence
→ claim the idempotency operation
→ commit
```

Use a global Postgres `BIGSERIAL`/sequence to issue fencing values; global monotonicity also implies
per-session monotonicity. A higher fence registered after commit cannot revoke a provider request
that was already authorized and started.

Before re-running the model for a redelivered turn, query the ledger by `turn_id`. A succeeded turn
replays its sanitized outcome; any operation at `external_started` or `unknown` blocks model
re-execution and routes to reconciliation. Sensitive writes should ultimately use a persisted
server-side confirmation intent, so recovery does not depend on reproducing the same model
trajectory.

### External side-effect boundary

If the provider succeeds and the process crashes before Postgres records success, the operation
becomes `unknown`. It must not be automatically repeated unless:

- The downstream provider accepts the same idempotency key; or
- A provider lookup can reconcile the result safely.

This gives safe at-most-once behavior with an explicit recovery state. It does not make an
unsupported exactly-once promise.

### Sensitive data handling

- Store only sanitized operation results.
- Never store a money-code value or full card number.
- Do not persist Telegram bot tokens, Claude tokens, ServerCRM keys, or raw authorization headers.
- Audit idempotent replay, conflict, unknown, and reconciliation events.
- Use the operation ID as notification dedupe input instead of `Date.now()`.
- Until operation IDs land, fix the live override dedupe defect with a temporary stable gateway
  request/update ID: `override:{carrierId}:{cardId}:{updateId}`. Do not use only carrier/card,
  because a later legitimate override must remain possible.

### Acceptance criteria

- 10,000 concurrent identical requests produce one stub-provider mutation.
- Same key and different payload always return 409.
- Cross-tenant key reuse cannot read or affect another tenant.
- Cached success never bypasses current RBAC.
- An expired `external_started` operation becomes `unknown`, not automatically replayed.
- An expired `claimed` operation with no external start becomes `failed_safe` and may be reclaimed.
- All write attempts, replays, denials, and failures are audit-logged.

## Phase 2: Redis coordination

Estimated effort: 3–4 engineering days.

Use Redis Streams and atomic Lua scripts for the specialized per-session drain model. Redis consumer
groups provide pending-entry tracking, recovery, and explicit acknowledgement.

Reference:

- <https://redis.io/docs/latest/develop/data-types/streams/>
- <https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/>

### Runtime configuration

```text
REDIS_URL=
GATEWAY_ROLE=all|ingress|worker
GATEWAY_INSTANCE_ID=
GATEWAY_COORDINATION=memory|redis
```

Production shape:

- One active ingress leader
- One standby ingress replica
- Two or more worker replicas

Production must refuse unsafe multi-replica memory mode.

### Redis modules

Proposed files:

- `apps/agent-gateway/src/redis/client.ts`
- `apps/agent-gateway/src/redis/keys.ts`
- `apps/agent-gateway/src/redis/scripts.ts`
- `apps/agent-gateway/src/coordination/ingressLeader.ts`
- `apps/agent-gateway/src/coordination/updateQueue.ts`
- `apps/agent-gateway/src/coordination/sessionLease.ts`
- `apps/agent-gateway/src/coordination/redisSessionStore.ts`
- `apps/agent-gateway/src/coordination/redisButtonStore.ts`
- `apps/agent-gateway/src/coordination/redisRateLimiter.ts`
- `apps/agent-gateway/src/coordination/redisAuthPoolState.ts`

### Ingress leadership

Only the active leader calls Telegram `getUpdates`.

Use a renewable Redis lease containing:

- A cryptographically random owner token
- Instance ID
- Expiry

Acquire using `SET ... NX PX`. Renew and release only if the stored token matches, using an atomic
script. Losing the lease immediately stops polling.

### Atomic Telegram update enqueue

One Lua script must:

1. Check Telegram `update_id` dedupe.
2. Append the update to the correct per-session inbox.
3. Mark the session scheduled.
4. Add the session key to the ready stream if it was idle.
5. Set the update-dedupe TTL.

Suggested keys:

```text
ag:{environment}:update:{bot}:{updateId}
ag:{environment}:session:{chatId}:{userId}:inbox
ag:{environment}:session:{chatId}:{userId}:scheduled
ag:{environment}:ready
```

The dedupe and enqueue operations must be atomic so a crash cannot create a deduped-but-lost update.

### Per-session worker model

Workers consume session keys, not individual messages.

Processing:

1. Claim the session lease.
2. Receive a monotonically increasing fencing token.
3. Drain that user's inbox sequentially.
4. Renew the lease during long model/tool execution.
5. Verify the fencing token before:
   - Backend tool execution
   - Telegram reply delivery
   - Session metadata changes
6. Atomically mark the session idle or reschedule it if new messages arrived.
7. Acknowledge the Redis stream entry.

A stale worker that loses its lease may finish local model computation, but it cannot perform a
write or publish a reply after failing the fence check.

### Session resume policy

Store the SDK session ID with its owner instance:

```text
sdkSessionId
ownerInstanceId
startedAt
lastAt
turns
lastCacheRead
```

- Resume only when the same runtime instance still owns the transcript.
- When ownership moves, start a fresh Claude session.
- Do not attempt to resume another worker's local SDK transcript.
- Preserve essential verified carrier/user context outside the SDK transcript.

This trades some conversational continuity during worker failure for predictable correctness.

### Shared state migration

Move these process-local controls to Redis:

- Button ownership, expiry, and single-use consumption
- Telegram update dedupe
- Auth-token cooldown and round-robin cursor
- Telegram global send spacing and shared 429 backoff
- Per-tenant/carrier read/write rate limits
- Registration and DM nudge TTLs
- Photo references needed by a later message

Chat-map and DM-access caches may remain per replica because the backend remains authoritative and
their TTLs are short.

### Redis security and failure policy

- TLS and private networking
- Redis ACL credentials stored only in secret configuration
- Environment/bot-specific key prefixes
- Encryption at rest
- `noeviction` policy for queue infrastructure
- Persistence appropriate for an acknowledged request queue
- Short TTL for user-message payloads
- No PAN, money codes, provider credentials, or model credentials

If Redis is unavailable:

- The gateway must not fall back to independent production in-memory workers.
- Do not advance/confirm ingestion for a request that was not durably queued.
- Writes remain protected by Postgres idempotency.
- Return or deliver a static capacity response only when it can be done without losing the update.

### Acceptance criteria

- Two workers never process the same session concurrently.
- Same-user ordering is exact.
- Different users continue in parallel.
- Killing a worker recovers within the configured lease/reclaim window.
- A stale worker cannot write or reply after losing its lease.
- Button ownership survives replica changes and gateway restart.
- Telegram throttling remains global across replicas.
- Auth-token cooldown is shared across replicas.
- Redis outage fails closed.

## Phase 3: staging load and failure testing

Estimated effort: 2–3 engineering days.

Use a dedicated test bot, staging Postgres/Redis, fake identities, and stubbed
ServerCRM/EFS/Desk. Production credentials, real client traffic, and real EFS mutations are
prohibited.

The detailed workload profiles, crash matrix, metrics, and numeric release gates live in:

- [Agent Gateway Staging Load-Test Matrix](./agent-gateway-staging-load-test-matrix.md)

Phase 3 is complete only when every hard security/correctness gate in that matrix passes.

## Phase 4: rollout and rollback

Estimated effort: 1–2 engineering days including observation.

### Feature flags

```text
FF_SUPPORT_BOT_IDEMPOTENCY=0|1
GATEWAY_COORDINATION=memory|redis
GATEWAY_ROLE=all|ingress|worker
SUPPORT_BOT_WRITES_ENABLED=0|1
```

### Rollout order

1. Deploy the database migration.
2. Deploy backend support for optional idempotency headers.
3. Enable idempotency enforcement in staging.
4. Deploy Redis coordination with one ingress and one worker.
5. Run duplicate, ordering, and crash tests.
6. Scale staging to two or more workers.
7. Canary an internal/test carrier.
8. Canary one low-risk client.
9. Expand gradually after 24–48 hours of clean metrics.

### Rollback

1. Keep backend idempotency enabled.
2. Stop new ingress consumption.
3. Drain Redis pending work.
4. Scale down to one worker.
5. Revert gateway coordination only after the queue is empty.
6. Never run multiple production replicas with independent in-memory queues.

### Production alerts

Alert on:

- Oldest queued session age
- Redis pending-entry growth
- Session lease loss/reclaim spike
- Any idempotency conflict
- Any operation entering `unknown`
- Telegram 429 surge
- Provider 5xx/timeout surge
- Queue wait or TTFT SLO breach
- Cross-tenant/RBAC denial anomaly
- Auth-token pool exhaustion

## Recommended implementation order

1. Route/repo refactor and baseline.
2. Postgres idempotency for `card-action` as the first vertical slice.
3. Extend idempotency to all support-bot write endpoints.
4. Redis Telegram update dedupe and poller leadership.
5. Redis per-session drain workers and fencing.
6. Shared button, auth-pool, and rate-limit state.
7. Staging duplicate/crash/load matrix.
8. Controlled production rollout.

## Estimate

Expected implementation effort: 8–12 engineering days, assuming managed Redis is available and
ServerCRM/EFS changes are not required.

If ServerCRM/EFS must add downstream idempotency or reconciliation endpoints, estimate and rollout
those changes separately before enabling automatic recovery of `unknown` operations.

## Definition of done

- All database access added by the slice goes through tenant-scoped repos.
- Every state-changing tool remains RBAC-checked and audit-logged.
- Postgres idempotency protects every support-bot write.
- Multiple workers preserve per-user ordering and cross-user parallelism.
- Worker, Redis, backend, and provider failure cases have deterministic outcomes.
- No sensitive values are stored in coordination or idempotency records.
- Cross-tenant tests and the complete project verification workflow pass.
- Staging release gates pass before any client rollout.
- Rollback has been rehearsed successfully in staging.
