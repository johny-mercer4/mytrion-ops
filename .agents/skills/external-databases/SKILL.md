---
name: external-databases
description: How Mytrion Ops connects to external SQL databases as tool/metadata targets — the read-only DWH Postgres (integrations/dwh.ts, `pg`) and AWS RDS/Aurora MySQL (integrations/awsMysql.ts, `mysql2`). Covers pooling, auth (URI password vs AWS IAM tokens), TLS/SSL, read-only enforcement, the `$1` vs `?` placeholder gotcha, and the network prerequisites for RDS. Use when adding a new external DB, wiring a DB-backed tool, or debugging a connection.
---

# External databases — skill

**TL;DR for this repo (Mytrion Ops):**
- Two external SQL targets, one integration wrapper each, both **pooled + read-only by default**:
  - **DWH** — read-only analytics **Postgres**, `pg` driver → [`src/integrations/dwh.ts`](../../src/integrations/dwh.ts) (`dwhQuery`). Env `DWH_DATABASE_URL`, `ssl: false` (direct, non-TLS).
  - **AWS MySQL** — RDS/Aurora **MySQL**, `mysql2` driver → [`src/integrations/awsMysql.ts`](../../src/integrations/awsMysql.ts) (`awsMysqlQuery`). Env `AWS_MYSQL_DATABASE_URL` (+ `AWS_MYSQL_SSL`, `AWS_MYSQL_READONLY`).
- Both are exported from the integrations barrel: `import { dwh, awsMysql } from '../integrations/index.js'`.
- **Placeholder gotcha:** Postgres uses `$1, $2`; MySQL/`mysql2` uses positional `?`. Queries are **not** portable between `dwhQuery` and `awsMysqlQuery`.
- **Read-only is the default** (AGENTS.md rule 7). DWH pins `default_transaction_read_only=on`; AWS MySQL pins `SET SESSION TRANSACTION READ ONLY` per connection when `AWS_MYSQL_READONLY=1`. The **real** guarantee is a read-only DB user — the session pin is defence in depth.
- These are third-party/external DBs accessed directly via `integrations/`. Anything that reads **our own tenant data** still goes through `repos/` with `tenant_id` isolation (AGENTS.md rule 2). A DB-backed *tool* is still a `ToolManifest` dispatched through `toolDispatcher` (RBAC).

---

## The pattern (both wrappers share it)

A module-level lazy singleton pool, created from an env URL, exposed as one `Promise<rows>` query
helper + a `close…Pool()` for shutdown/tests. Mirror this for any new external DB:

```ts
let pool: Pool | null = null;
export function getXPool(): Pool {
  if (pool) return pool;
  if (!env.X_DATABASE_URL) throw new Error('[x] X_DATABASE_URL is not configured');
  pool = /* driver.createPool({ connectionString | uri, ssl, max/connectionLimit, timeouts }) */;
  pool.on('error', (err) => logger.error({ err: err.message }, 'X pool error'));
  return pool;
}
export async function xQuery<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> { … }
export async function closeXPool(): Promise<void> { if (pool) { await pool.end(); pool = null; } }
```

Register it in [`src/integrations/index.ts`](../../src/integrations/index.ts) as `export * as x from './x.js'`.

## AWS MySQL specifics

### Auth
- **Discrete fields (preferred, wired):** `AWS_MYSQL_HOST` / `_PORT` / `_USER` / `_PASSWORD` /
  `_DATABASE`. The password is passed **raw** — no URL-encoding, so special chars (`%`, `{`, `[`, …)
  just work. Through an SSH tunnel, `HOST=127.0.0.1` and `PORT` = the local forward (e.g. `3307`).
  `awsMysql.ts` uses these whenever `AWS_MYSQL_HOST` is set.
- **URI / password (fallback):** `AWS_MYSQL_DATABASE_URL=mysql://user:pass@host:3306/db`. ⚠️ Any
  special char in the password **must be percent-encoded** or mysql2 throws `URI malformed` at pool
  creation (a lone `%` is the usual culprit). Prefer the discrete fields to avoid this entirely.
- **IAM database authentication (not wired — add when needed):** no static password. Mint a
  short-lived (~15 min) token and pass it as the password, refreshing before expiry. The AWS SDK v3
  is already a dependency (`@aws-sdk/client-s3`); add **`@aws-sdk/rds-signer`**:
  ```ts
  import { Signer } from '@aws-sdk/rds-signer';
  const token = await new Signer({ region, hostname, port, username }).getAuthToken();
  // use `token` as the pool password; re-mint on a timer (tokens expire ~15 min) and recreate/refresh the pool
  ```
  Requires the RDS instance to have IAM auth enabled + an IAM policy granting `rds-db:connect`.

### TLS / SSL
- RDS/Aurora terminate TLS with **publicly-trusted** certs (chain to Amazon Root CA, which is in
  Node's trust store), so `ssl: { rejectUnauthorized: true }` verifies **without** bundling a CA.
  This is the default (`AWS_MYSQL_SSL=1`).
- `AWS_MYSQL_SSL=0` → plaintext (no TLS) for a non-RDS target or an SSH/tunnelled connection
  (matches the DWH's `ssl: false`).
- If you ever hit a cert-chain error, bundle the current **rds-ca** PEM and pass it as
  `ssl: { ca: <pem>, rejectUnauthorized: true }` — don't set `rejectUnauthorized: false` (that
  disables verification and invites MITM).

### Read-only
- `AWS_MYSQL_READONLY=1` (default) attaches a `pool.pool.on('connection')` handler that runs
  `SET SESSION TRANSACTION READ ONLY` on each physical connection. Note events live on the **base
  (callback) pool** `pool.pool` — the `mysql2/promise` `Pool` re-types `.on(...)` narrowly.
- Prefer also giving the app a **read-only MySQL user** (`GRANT SELECT`) — that's server-enforced
  and can't be bypassed. Set `AWS_MYSQL_READONLY=0` only when a write path is intentional (and gate
  it as a `write` tool per AGENTS.md rule 7).

## Network prerequisite (the real gating factor)

RDS/Aurora lives in a VPC. Code connecting is not enough — the runtime (Render, per
[render-builds-from-dockerfile] memory) must be able to **reach** the instance:
- **Public accessibility ON** + the DB **security group** allowlisting the caller's egress IP(s), **or**
- **VPC peering / PrivateLink** between Render and the AWS VPC.
Verify reachability (`nc -zv host 3306` from the runtime) before blaming the code.

## Verifying a connection
`scripts/mysqlInspect.ts` (`pnpm mysql:inspect`) exercises the pool end-to-end: no-arg lists
databases + table counts, `--db <name>` lists tables, `--db <name> --table <t> [--sample N]` shows
columns/row-count/samples, `--query "…"` runs ad-hoc read-only SQL. Start the SSH tunnel first — the
app dials `127.0.0.1:3307`, it does not open the tunnel itself. (Verified live 2026-07-14 against
`tss_db`, 92 tables.)

## Gotchas checklist
- **`URI malformed`** at pool creation = an unencoded special char in the URI password. Fix: use the
  discrete `AWS_MYSQL_*` fields (raw password), or percent-encode it.
- `$1`/`$2` (pg) vs `?` (mysql2) — not interchangeable.
- `mysql2/promise` `Pool.on(...)` is narrowly typed; attach events on `pool.pool` (base pool).
- `mysql2` returns `[rows, fields]` from `.query()` — destructure `const [rows] = await pool.query(...)`.
- IAM tokens expire (~15 min) — a long-lived pool needs a refresh strategy, not a one-shot token.
- Don't write to the DWH (it's third-party, never migrated by us); keep AWS MySQL read-only unless a write is explicitly required.
