# Agent Gateway Staging Load-Test Matrix

Status: Proposed appendix
Date: 2026-07-28
Parent plan: [Redis Coordination, Backend Idempotency, and Staging Load Test](./agent-gateway-redis-idempotency-staging-plan.md)

## Environment

- Dedicated Telegram test bot
- Staging Postgres
- Staging Redis
- Fake tenants, carriers, owners, managers, and drivers
- Stub ServerCRM/EFS/Desk
- No production credentials
- No real client traffic
- No real EFS mutations

## Harness

Extend the existing offline stress harness and add a process-level staging runner:

- `apps/agent-gateway/scripts/stressGateway.mts`
- `apps/agent-gateway/scripts/stressCluster.mts`
- `apps/agent-gateway/scripts/fakeTelegramIngress.mts`
- `apps/agent-gateway/scripts/fakeSupportBackend.mts`

The staging harness must emit machine-readable JSON and a live terminal view.

## Workload profiles

### Normal load

- 100 users
- 5 messages each
- 20 chats
- 2 workers

### Hot user

- One user sends 50 ordered messages
- Exact sequence and zero overlap required

### Hot group

- 200 users in one Telegram group
- Cross-user parallelism required

### Multi-tenant isolation

- 20 tenants
- Intentionally overlapping Telegram/message IDs
- Zero cross-tenant reads, replies, buttons, or writes

### Duplicate storm

- Replay each update and write request 10–100 times
- Exactly one stub-provider mutation

## Failure matrix

### Worker crashes

- Kill before model execution
- Kill during model execution
- Kill before external write
- Kill after `external_started`
- Kill after provider success but before completion persistence
- Kill before Telegram reply
- Kill after Telegram reply but before stream acknowledgement

### Ingress leader failover

- Kill after `getUpdates` returns but before durable enqueue
- Kill after atomic enqueue but before the next Telegram offset acknowledgement
- Partition the old leader while the standby takes over
- Require zero lost updates, duplicate queued turns, and duplicate provider mutations

### Buttons and callbacks

- Double-tap storm across two workers
- Foreign-user and owner taps racing
- Worker crash between atomic button consumption and confirmed-operation enqueue
- Button expiry while queued and under load
- Replica transition between button creation and callback

### Redis interruptions

- Temporary disconnect
- Lease renewal failure
- Consumer recovery
- Pending-entry reclaim
- Redis restart with persistence enabled

### Backend/provider failures

- Timeout
- 429
- 409
- 5xx before external work
- Connection reset after external work
- Malformed provider response

## Agentic evaluation metrics

Measure the execution trajectory, not only final text:

- Exact tool selection
- AST/JSON argument accuracy
- API resolution rate
- Tool hallucination rate
- Queue wait p50/p95/p99
- Time to first token p50/p95
- Total duration p50/p95/p99
- Same-user overlap count
- Out-of-order count
- Duplicate provider mutation count
- Idempotency replay/conflict/unknown counts
- Redis pending count and oldest age
- Lease loss and reclaim count
- Telegram 429 rate
- Token failover count
- Event-loop lag and RSS

Run high-volume coordination/correctness scenarios with a stubbed model runner. Run a separate
30–100 trajectory evaluation against the real model for tool choice, arguments, hallucination rate,
confirmation behavior, and TTFT.

Real cross-account token failover is deferred until at least two independent staging subscription
tokens exist. Fake-token pool mechanics remain mandatory in offline tests.

## Release gates

### Security and correctness

- Cross-tenant leakage: 0
- Duplicate external mutations: 0
- Same-user overlap: 0
- Out-of-order turns: 0
- Lost acknowledged updates: 0
- Unauthorized writes: 0
- Automatic replay of `unknown` operations: 0

### Performance

- Ingress enqueue p95 below 100 ms
- Redis coordination p95 below 20 ms
- Queue wait p95 below 500 ms at target load
- Immediate Telegram acknowledgement p95 below 1 second
- Simple-response TTFT p95 target below 5 seconds
- Full-turn latency no more than 10% worse than the recorded single-replica baseline

## Required reports

Each run should produce:

- Configuration and git commit
- Worker/ingress replica counts
- Test-data seed identifier
- Passed and failed scenarios
- Latency percentiles
- Correctness counters
- Idempotency state counts
- Redis recovery statistics
- Tool execution trajectory metrics
- Sanitized error samples

Store reports under `eval-reports/`; never include client text, PANs, money codes, or credentials.
