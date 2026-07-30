# Data Loader — implementation handoff

**Executor:** GPT 5.6 Sol · **Orchestrator:** Claude · **Written:** 2026-07-26 against
`feature/MytrionOrganize` @ `49b1d8a`

> §1–§3 are your prompt. §4 onward is the spec. Read `CLAUDE.md` and `ONBOARDING.md` before you
> write a line of code.

---

## 1. Your task

Build a **Data Loader** for Mytrion Admin: bulk create / edit / delete of app-Postgres records from
uploaded Excel or CSV files, with column→field mapping — the Salesforce Data Loader workflow.

**Decisions already made. Do not relitigate them:**

| Decision | Value |
| --- | --- |
| Write target | **App Postgres only.** Zoho CRM is explicitly out of scope. |
| Access | **Admin Mytrion only** for v1. |
| Grid + import UI | **Self-hosted NocoDB**, not built in-house. |
| Placement | New **"Data Loader"** tab in Mytrion Admin. |

**The shape of the thing:** NocoDB provides the grid, the file upload, the column mapping, and the
bulk edit/delete. Postgres provides a locked-down role and triggers that record every change.
Mytrion Admin owns the guardrails — the launch panel, the change log, and one-click rollback.

**The central design idea, and the reason this is safe:** NocoDB writes to Postgres directly, so it
bypasses `src/repos/` — which means it bypasses rule 2 (tenant isolation), rule 7 (audit logging),
and rule 8. We cannot fix that at the application layer, so **we move the guarantee down to the
database layer**, where nothing can bypass it: a restricted role that can only touch allowlisted
tables, plus `AFTER` triggers that write a before-image of every row NocoDB changes. That gives us
audit parity and a rollback journal that hold no matter what tool did the writing.

If you find yourself weakening either the role grants or the triggers to make something work, stop
and flag it. Those two things are the entire safety argument.

---

## 2. Context you need

Read these first:

- `CLAUDE.md` — the hard rules. Rule 9 (never `drizzle-kit push`) and rule 2 (all DB access through
  `repos/`) are directly relevant.
- `ONBOARDING.md` — system brief. §4 data model, §9 the rules and the failure behind each.
- `apps/mytrion-crm/src/mytrions/admin/index.tsx` — the Admin shell you're adding a tab to.
- `src/db/schema/audit_log.ts` — the audit row shape you'll mirror.
- `src/routes/v1/admin.routes.ts` — the `adminOnly` guard and route conventions.
- `scripts/enable-pgvector.sql` — precedent for a one-shot ops SQL script.

Facts that will save you time:

- This implementation branch is ahead of the original handoff: the Data Loader journal is migration
  `0069_data_loader_journal`, after the pending HR migration `0068`.
- **House rule: no cross-domain foreign keys.** Integrity lives in `repos/`, not the DB. This is
  exactly why an external writer is dangerous and why the trigger journal matters.
- Only **4 real Postgres enums**, all in `retention_cases` — those will reject bad values for you.
  Nothing else has DB-level value protection.
- **Do not wire pg-boss.** Current NocoDB runs imports/exports on its own Redis-backed worker.
  `FF_JOBS_ENABLED` remains unrelated and this feature deliberately does not depend on it.
- `src/modules/files/parse/index.ts` already parses xlsx/csv, and `src/modules/files/generate/` already
  writes them. You will not need either for v1 — NocoDB handles the file side — but don't rebuild them
  if scope grows.

---

## 3. Rules for this task

Standard repo rules apply — branch off `build` as `feature/data-loader`, never push to `main` or
`build`, no `any`, files ≤ 600 lines, conventional commits, and
`pnpm lint && pnpm typecheck && pnpm test` before handing back. Baseline is **183/184 tests**
(`dashDebtorsData` already fails) and **16 typecheck errors** — do not regress either.

⚠️ **Before running `pnpm db:generate`:** `drizzle.config.ts` enumerates schema files and is missing
four — `agent_blackboards.ts`, `agent_skills.ts`, `mytrion_role_defaults.ts`,
`support_bot_messages.ts`. Generating today emits `DROP TABLE` for all four. Add them to the list in
your first commit, as a separate commit from your feature work.

**Do not, under any circumstances:**

1. **Use NocoDB's schema editor** to add, alter, or drop a column or table. That is `drizzle-kit push`
   wearing a different hat — it mutates the DB with no migration file, and the next
   `pnpm db:migrate` on a fresh DB diverges. The loader role has no DDL grants specifically to make
   this impossible; do not grant them "temporarily."
2. **Point NocoDB at the DWH, CMP MySQL, or the Verification DB.** All three are read-only replicas.
   App Postgres only.
3. **Add a table to the allowlist** without a trigger on it. Allowlist and journal move together, in
   the same commit.
4. **Add the access-control tables** — `worker_mytrion_access`, `mytrion_profile_defaults`,
   `mytrion_role_defaults`. Bulk-editing who can access what, from outside the app's RBAC, is a
   privilege-escalation path. They already have purpose-built Admin UI (`UserAccessForm.tsx`,
   `ProfileDefaults.tsx`, `RoleDefaults.tsx`).
5. **Expose NocoDB publicly.** Internal network or IP-restricted only.
6. **Add a second styling system.** No Chakra, no new component library. Horizon tokens (`--hz-*`),
   CSS Modules, and the `useLoad` hook, like every other Admin tab.
7. **Trust the Claude skill list as an integration inventory.** DAT, Pinecone, Pipedream, Cohere, and
   Gong appear there and exist in zero lines of this codebase.

---

## 4. Why NocoDB and not Directus

Both were considered. NocoDB wins on two concrete grounds:

**Licensing.** Directus moved to the Monospace Sustainable Core License in May 2026 (v12) — free only
for organizations under **$5M annual revenue and under 50 employees**. OctaneFuel is over that
threshold, so Directus would require a paid commercial license. NocoDB Community now uses the
**Fair Code Sustainable Use License**, not the AGPLv3 license named in the original handoff. Its
official self-hosting page permits internal organizational use, but legal review remains mandatory
before deployment.

**It doesn't touch your schema.** NocoDB stores its own metadata in a separate database via `NC_DB`
and connects to your Postgres as an external data source. Directus creates roughly 20 `directus_*`
tables inside the schema it connects to. Given how much this repo cares about migration hygiene,
keeping the app DB free of a second tool's bookkeeping is worth a lot.

**What we give up:** Directus ships revisions and an activity log. NocoDB doesn't. §6 replaces both
with database triggers, which is strictly better anyway — a trigger cannot be bypassed by a
different client, and Directus's revisions can be.

---

## 5. Task 1 — the restricted Postgres role

New file `scripts/nocodb-role.sql`, following the `enable-pgvector.sql` precedent: idempotent,
run once per environment, committed, never applied automatically.

Create role `mytrion_loader` with:

- `LOGIN`, password from an env var — **not** the app's connection user, and not a superuser.
- `NOCREATEDB NOCREATEROLE NOSUPERUSER`.
- **No DDL anywhere.** Explicitly `REVOKE CREATE ON SCHEMA public FROM mytrion_loader`.
- `SELECT, INSERT, UPDATE, DELETE` on the allowlisted tables **only** — grant table by table, never
  `GRANT … ON ALL TABLES`. Tier 1 uses text primary keys and has no backing sequences, so it needs
  no sequence grants.
- `USAGE` on `public` only. **`REVOKE ALL ON SCHEMA pgboss, drizzle, langgraph`** — the job queue,
  the migration ledger, and the LangGraph checkpointer must be unreachable.
- No default privileges for future tables: a new table must be granted deliberately.

Add a comment block at the top of the file stating that adding a grant here without adding the
matching trigger from §6 breaks the audit guarantee.

Verification step: connect as `mytrion_loader` and confirm that `CREATE TABLE`, `ALTER TABLE`,
`SELECT` on `audit_log`, and `SELECT` on `pgboss.job` all fail. Write that as a checklist in the
file's header comment so the next person can re-verify after any grant change.

### Table allowlist

**Hard-excluded — never grant, in any tier:**

| Table(s) | Why |
| --- | --- |
| `knowledge_chunks`, `agent_memories`, `agent_skills` | `vector(1536)` columns NocoDB can't model, plus a generated `content_tsv` it will try to write to |
| `audit_log` | append-only by design; the schema comment says rows must survive tenant deletion |
| `tool_calls`, `agent_runs`, `messages`, `conversations`, `agent_tasks` | system-written ledgers; hand-editing corrupts cost accounting and audit chains |
| `retention_phases`, `retention_statuses` | FK targets for the retention subsystem; editing codes breaks live cases |
| `worker_mytrion_access`, `mytrion_profile_defaults`, `mytrion_role_defaults` | privilege escalation — see §3.4 |
| anything in `pgboss`, `drizzle`, `langgraph` | not application data |

**Tier 1 starter allowlist** — low blast radius, good for proving the pattern:

`client_news`, `client_news_reads`, `scope_risk_items`, `mytrion_calls`

**Approved implementation decision (2026-07-29):** `payment_carrier_memory` was removed because it
is a global table with no `tenant_id`. The loader role is pinned to a literal tenant through native
Postgres RLS; `client_news_reads` inherits the tenant boundary through its parent `client_news` row.
Table grants alone were rejected because they would have allowed cross-tenant reads and writes.

**Tier 2** — only after the trigger journal and rollback are demonstrated working end to end:

`carrier_users`, `carrier_invitations`, `registered_mini_app_companies`, `retention_cases`,
`payment_transactions`, `payment_returns`, `money_code_requests`

⚠️ **Confirm the tier-1 list with the orchestrator before implementing.** I proposed it from schema
shape, not from knowing which migrations you actually need. If the real driver is, say, importing
historical `payment_transactions`, the tiering changes and the financial tables need extra care —
`payment_transactions` has a unique `(source, source_record_id)` that will reject dupes, which helps,
but reversal logic keyed on `cmp_ref` does not tolerate hand-edited rows.

---

## 6. Task 2 — the change journal and triggers

**New table `bulk_change_log`**, added properly: new file `src/db/schema/bulk_change_log.ts`, added to
`drizzle.config.ts`, and committed with migration `0069_data_loader_journal.sql` plus
`meta/_journal.json`. The migration is hand-written because the repository's known 0022/0023
snapshot-parent collision still prevents `drizzle-kit generate`; `drizzle-kit push` remains banned.

Columns:

- `id` — `bcl_`-prefixed application CUID by default; trigger-written rows use a
  `bcl_`-prefixed database UUID because the trigger cannot call the TypeScript CUID generator
- `tenant_id`, `audience` — mirror `audit_log`; populate from the row where the column exists
- `batch_id` — groups every row from one import so rollback is one unit
- `table_name`, `row_pk` (text — PKs here are variously text, bigserial, and token strings)
- `op` — `'insert' | 'update' | 'delete'`
- `before` / `after` — `jsonb`, nullable (insert has no before, delete has no after)
- `db_user` — `session_user`, so an app-layer write and a loader write are distinguishable
- `reverted_at`, `reverted_by` — nullable
- `created_at` — `defaultNow()`
- Indexes on `(batch_id)`, `(table_name, row_pk)`, `(created_at)`

**Triggers**, hand-written in the same migration SQL, idempotent (`CREATE OR REPLACE FUNCTION`,
`DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`):

One shared `PL/pgSQL` function `log_bulk_change()`, attached `AFTER INSERT OR UPDATE OR DELETE FOR
EACH ROW` to each allowlisted table. It writes `to_jsonb(OLD)` and `to_jsonb(NEW)` into
`bulk_change_log`.

Two details that matter:

- **`batch_id`** comes from a session GUC — read `current_setting('mytrion.batch_id', true)` and fall
  back to a generated value. NocoDB won't set it, so imports will land under a synthetic batch;
  group those by `(db_user, table_name, created_at)` bucket in the UI. Don't over-engineer this — a
  time-bucketed grouping is honest and sufficient.
- **Skip app-layer writes if volume becomes a problem.** Start by logging everything regardless of
  `session_user`; it's simpler and gives you a fuller journal. If `bulk_change_log` growth becomes an
  issue, gate on `session_user = 'mytrion_loader'` and note the change. Do not gate on it from day
  one — you'll lose the ability to prove the trigger works from a normal app write in tests.

Grant `mytrion_loader` `INSERT` on `bulk_change_log` and nothing else — it must not be able to
`UPDATE` or `DELETE` its own audit trail. The trigger function should be `SECURITY DEFINER` owned by
the app role so the journal write can't be refused.

Retention: none for v1. Revisit when the table gets large.

---

## 7. Task 3 — deploy NocoDB

Add the current NocoDB stack to the root `docker-compose.yml`: web service, background worker,
Redis, and a metadata-only Postgres:

- Official image, pinned to `2026.07.0` — not `latest`.
- `NC_DB` → its own Postgres container. **Not** the app database.
- `NC_SITE_URL`, `NC_AUTH_JWT_SECRET` from env. Disable telemetry with `NC_DISABLE_TELE` and open
  registration with `NC_INVITE_ONLY_SIGNUP` — accounts are provisioned by hand for the few admins
  who need one.
- Bind to localhost or an internal network. Not `0.0.0.0`.
- Data source connection string uses **`mytrion_loader`**, never the app user.

Add the new env var names to `.env.example` with comments, following the file's existing style. Do not
add them to `src/config/env.ts` unless the backend actually reads them — the backend only needs the
NocoDB **base URL** for the launch link.

Note in `.env.example` that production deployment is a separate decision: `render.yaml` has no service
for this, and an internal admin tool may be better run outside Render entirely. Flag it, don't decide
it.

**There is no SSO.** NocoDB has its own login. Accept that for v1 — provision accounts manually for
the handful of admins. Do not build an auth bridge.

---

## 8. Task 4 — the Admin tab

**Do not iframe NocoDB.** It sends `frame-ancestors` CSP headers and the embed is fragile. The tab
launches it in a new tab.

Add `'data-loader'` to the `Tab` union in `apps/mytrion-crm/src/mytrions/admin/index.tsx`, and a
`NavItem` in the **`ops`** ("CRM & Ops") nav section — that section's hues are amber/orange/pink/rose,
so pick an unused one and use the `--tone-*` token, never raw hex. New component
`apps/mytrion-crm/src/mytrions/admin/DataLoader.tsx`.

The tab has two jobs:

**Launch panel.** Eyebrow → `h2` → sub header pattern, like every other Admin tab (see §"Header
typography" in the `2026-07-26` Admin standardization note in `WORKING_NOTES.md`). A primary button
opening NocoDB in a new tab. Below it, the guardrails stated plainly for the human: which tables are
writable, that every change is journaled and revertible, and that schema edits are forbidden. This
text is a real part of the feature — it's what stops someone using the schema editor.

**Change log.** A table of recent batches from `bulk_change_log`: when, who (`db_user`), which table,
op counts, and a Revert action. Expanding a batch shows the affected rows with a before/after diff.
Use `useLoad` for fetching. You must implement all four states properly — skeleton, error (the
`.errorState` pattern: icon, title, cause, actionable hint, retry), empty (`.emptyState`), and
loaded. Every other Admin tab does; a missing one is a review failure.

Reuse `Pager.tsx` for pagination and `ConfirmDialog.tsx` for the revert confirmation. Revert is
destructive — the dialog must state the row count and the table, and require an explicit confirm.

---

## 9. Task 5 — backend routes

New file `src/routes/v1/dataLoader.routes.ts`, registered in `src/app.ts`, all routes behind the
`adminOnly` guard from `admin.routes.ts`:

| Route | Purpose |
| --- | --- |
| `GET /v1/admin/data-loader/config` | NocoDB base URL + the allowlisted table list, for the launch panel |
| `GET /v1/admin/data-loader/batches` | paginated batch summaries |
| `GET /v1/admin/data-loader/batches/:batchId` | the rows in one batch, with before/after |
| `POST /v1/admin/data-loader/batches/:batchId/revert` | revert a batch |

New file `src/repos/bulkChangeLogRepo.ts` following the established pattern exactly — exported const
object of async methods, `ctx: TenantContext` first argument, every `.where()` opening with
`eq(bulkChangeLog.tenantId, ctx.tenantId)`, helpers from `src/repos/util.ts`. **No raw SQL in the
route file.**

**Revert semantics.** In one transaction, walk the batch newest-first and invert each row: `insert` →
delete by PK, `delete` → re-insert `before`, `update` → restore `before`. Then stamp `reverted_at` /
`reverted_by`. Rules:

- Refuse to revert an already-reverted batch. Return a clear error, not a silent no-op.
- Refuse if any target row has been modified since the batch — compare current row state against the
  batch's `after`. A blind restore would clobber a legitimate later edit. This check is the difference
  between a useful revert and a second incident.
- Write an `audit_log` row with action `data_loader.revert`, `resourceType: 'bulk_change_log'`,
  `resourceId: batchId`, and the row count in `detail`.
- The revert itself runs through `repos/` as the app user, so it *is* rule-2 compliant and will
  itself be journaled by the triggers. That's correct and desirable — a revert is auditable.

---

## 10. Task 6 — tests and docs

Tests (Vitest, `tests/unit/`):

- `bulkChangeLogRepo` enforces the tenant filter — extend the RBAC leakage suite pattern in
  `tests/unit/rbac.test.ts`. This is rule 9; it gates the whole feature.
- Revert inverts all three ops correctly.
- Revert refuses an already-reverted batch, and refuses when a row drifted from `after`.
- The trigger fires and captures a correct before-image on update and delete. An integration test
  against the local DB is fine here; a unit test can't prove a trigger.
- Non-admin gets 403 on all four routes.

Docs:

- Append a dated entry to `WORKING_NOTES.md` — what you built and **why**, in the style of the recent
  entries. Include anything you discovered that contradicts this spec.
- Add a short §11 to `ONBOARDING.md` describing the Data Loader, its safety model, and the allowlist
  location, so the next reader finds it.
- Update `docs/DATA_LOADER_HANDOFF.md` (this file) if a decision changed during implementation.

---

## 11. Acceptance criteria

- [x] `drizzle.config.ts` lists all schema files.
- [ ] `mytrion_loader` cannot run DDL, cannot read `audit_log`, cannot reach `pgboss`, and can only
      touch tier-1 tables. Verified by connecting as that role.
- [x] Every allowlisted table has a trigger. Allowlist and triggers match exactly — write a test that
      asserts this, so they can't drift.
- [ ] An xlsx import through NocoDB produces `bulk_change_log` rows with correct before-images.
- [ ] That batch reverts cleanly from the Admin tab, and a second revert attempt is refused.
- [x] A revert after an unrelated edit to one of the rows is refused with a clear message in tests.
- [ ] All four UI states are implemented with Horizon tokens only; both themes still need a live
      browser check.
- [ ] `pnpm lint` and both typechecks pass, but the current full suite has unrelated failures recorded
      in `WORKING_NOTES.md`; all 14 Data Loader tests pass and the DB integration test skips offline.
- [x] `WORKING_NOTES.md` entry appended.

---

## 12. Escalate to the orchestrator, don't guess

- The tier-1 allowlist, before you implement it (§5).
- If the real requirement turns out to include Zoho CRM records — that's a different build (Zoho Bulk
  Write API, documented in `.claude/skills/zoho-crm-api/SKILL.md` §7.2) and it was explicitly scoped
  out.
- If NocoDB can't connect with a role that has no DDL grants. If it genuinely requires DDL, the whole
  safety argument collapses and we reconsider the tool — do not widen the grants.
- The current Fair Code licensing question (§4) and production deployment (§7).
- Anything that would put a second styling system in the CRM bundle.

Sources for the licensing findings:
[Directus v12 license change](https://directus.com/resources/directus-v12-license-change) ·
[Directus self-hosted pricing](https://directus.io/pricing/self-hosted) ·
[NocoDB self-hosting and current license](https://nocodb.com/docs/self-hosting) ·
[NocoDB import + field mapping](https://docs.nocodb.com/tables/import-data-into-existing-table/) ·
[NocoDB current worker-based quickstart](https://nocodb.com/docs/self-hosting/installation/quickstart)
