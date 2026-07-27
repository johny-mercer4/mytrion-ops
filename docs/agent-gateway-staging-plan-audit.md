# Audit: Redis Idempotency Staging Plan + Load-Test Matrix

Status: Audit report
Date: 2026-07-28
Audited documents:

- [Redis Coordination, Backend Idempotency, and Staging Load Test](./agent-gateway-redis-idempotency-staging-plan.md)
- [Agent Gateway Staging Load-Test Matrix](./agent-gateway-staging-load-test-matrix.md)

## Verdict

**The plan is sound and its factual premises are accurate — every claim about the current
architecture was verified against the codebase with zero false premises.** The core design
decisions are correct: Redis as coordination infrastructure with Postgres as the idempotency
source of truth, fencing tokens for session ownership, an honest at-most-once model with an
explicit `unknown` recovery state (no fake exactly-once promise), fail-closed behavior on Redis
outage, and a phase order that lands idempotency before multi-worker scaling.

Six gaps should be patched before implementation begins. In priority order: backend-side fencing
enforcement (#1), idempotency-key collision on repeated identical calls (#2), and the missing
ingress-leader crash scenario (#3) are correctness holes; the rest are cheap matrix additions.

## Claim-by-claim verification

| Plan claim | Code evidence | Verdict |
|---|---|---|
| Telegram ingestion uses `getUpdates` long-polling; single poller only | `apps/agent-gateway/src/telegram.ts:95` | ✓ |
| Per-user queues are process-local | `apps/agent-gateway/src/sessions.ts:160` — `chains = new Map<SessionKey, Promise<void>>()` | ✓ |
| Button ownership is process-local | `apps/agent-gateway/src/buttonOwnership.ts:18` — in-memory `Map` | ✓ |
| Auth-token cooldown is process-local | `apps/agent-gateway/src/authPool.ts` — module-level state | ✓ |
| Telegram throttling / 429 backoff is process-local | `apps/agent-gateway/src/telegram.ts:21-22` — `lastSendAt` / `blockedUntil` module vars | ✓ |
| Registration/DM nudges and recent-sender state are process-local | `apps/agent-gateway/src/index.ts:29-30`, `apps/agent-gateway/src/filter.ts:14` — in-memory `Map`s | ✓ |
| Session IDs in `data/sessions.json`; SDK transcripts on local filesystem | `apps/agent-gateway/src/sessions.ts:27`, `apps/agent-gateway/data/claude-home/` | ✓ |
| Backend write routes accept no idempotency keys | grep across backend: zero hits | ✓ |
| Backend rate buckets are process-local | `src/app.ts:184` — `@fastify/rate-limit` with no external store (in-memory default); per-tool `rateLimit: { perMinute }` manifests enforced in-process | ✓ |
| `sessions.ts` near the 580-line target | 567 lines | ✓ |
| `supportBot.routes.ts` exceeds the 600-line cap with direct DB access | 1172 lines (~2× cap); direct `db.insert` / `db.select` at lines 181, 229, 238, 266, 274, 294, 325 — violates CLAUDE.md rule 2 | ✓ |
| Next migration number is `0058` | latest existing migration is `0057_mytrion_access_modes.sql` | ✓ |
| Offline stress harness exists | `apps/agent-gateway/scripts/stressGateway.mts` | ✓ |
| Target repo for caller/registration DB access exists | `src/repos/registeredMiniAppCompanyRepo.ts` (306 lines) — routes still bypass it | ✓ |

## Additional findings beyond the plan

### The `Date.now()` dedupe key is a live bug, not future-proofing

`src/routes/v1/supportBot.routes.ts:1160`:

```ts
dedupeKey: `override:${body.carrierId}:${registration.cardId ?? cardNumber.slice(-6)}:${Date.now()}`
```

The timestamp makes every attempt a unique key, so this dedupe **never fires today**. The plan's
fix (use the operation ID as the dedupe input) is correct — but it should be treated as fixing an
existing defect, not hardening a working mechanism.

### The transcript non-goal is backed by code, not caution

`apps/agent-gateway/src/sessions.ts:8` documents that Claude SDK session resume is not
concurrent-safe. The plan's session-resume policy (fresh session when ownership moves; never
resume another worker's transcript) matches the actual constraint.

### Token pool state confirms the failover-gate problem

Multi-token parsing exists (`CLAUDE_CODE_OAUTH_TOKENS`, `CLAUDE_CODE_OAUTH_TOKEN_1…_10` in
`authPool.ts`), but `.env` currently holds a single token. The matrix's "token failover count"
metric is untestable until a second separate-account token is provisioned (see gap #6).

## Gaps to patch before implementation

### 1. Fencing is enforced only gateway-side — TOCTOU race

The plan verifies the fencing token in the worker before backend tool execution. A stale worker
can pass the check, lose its lease, and still land the write: check passes → lease lost → write
lands anyway. Fencing must be enforced at the resource, not the caller.

**Fix:** add a `fencing_token` column to `support_bot_operations`; the gateway sends its token
with each write, and the backend rejects any token lower than the maximum already seen for that
session. Cheap to implement, closes the race, and makes the "same-user overlap: 0" release gate
actually provable.

### 2. Idempotency key collides on legitimately repeated calls

Key = SHA-256(… + telegram update ID + tool name + canonical args). If one turn legitimately
invokes the same tool twice with identical arguments (e.g. "draw two money codes"), both calls
produce the same key — the second call receives the replayed first result. Silent
under-delivery.

**Fix:** include a per-call occurrence index in the hash input (a gateway-side counter per
update + tool + args — never model-supplied).

**Related ambiguity:** the drain model batches N updates per turn; the plan must define which
update ID anchors the key for a multi-update turn.

### 3. Ingress-leader failover missing from the failure matrix

The matrix kills workers seven ways but never kills the ingress leader. Critical case: leader
dies after `getUpdates` returns but before durable enqueue → offset not advanced → standby
re-fetches the same updates → dedupe must absorb them.

**Fix:** add a leader-kill + standby-takeover scenario with a zero lost/duplicate updates gate.

### 4. No button/callback workload profile

The plan moves button ownership to Redis and the acceptance criteria say it "survives replica
changes," but the load matrix never exercises it.

**Fix:** add — double-tap storm across two workers; worker crash between button claim and
execution; button expiry under load.

### 5. Real model vs stub undefined in the load harness

Agentic metrics (tool selection, hallucination rate) require the real Claude API; a 10k-request
duplicate storm through the real API means cost and rate-limit burn on subscription tokens.

**Fix:** split explicitly — coordination/correctness tests run against a stubbed model runner;
a small-N agentic evaluation runs against the real API.

### 6. Token-failover gate untestable today

The pool currently holds one token; failover requires ≥2 tokens from separate accounts (per the
earlier decision to stay on subscription auth).

**Fix:** provision a second staging token, or mark the gate as deferred in the matrix.

### Minor: expired `claimed` operations unstated

The plan defines expiry handling only after `external_started` (→ `unknown`). A crash before
`external_started` (status `claimed`, lease expired) should become `failed_safe` and allow a
controlled retry — worth one explicit line in the plan.

## Recommendation

Proceed with the plan after folding in the six gaps. The plan's own implementation order is
correct — the `card-action` vertical slice first, then broadening idempotency coverage, then
Redis coordination, then the staging matrix. The 8–12 day estimate is plausible; the Lua
scripting and crash-matrix work will likely consume the high end.
