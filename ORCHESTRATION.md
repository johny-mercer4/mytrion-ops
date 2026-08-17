# ORCHESTRATION.md — routing work across the agent fleet

> How work gets split between **Claude (orchestrator)**, **Antigravity / Gemini 3.1 Pro**,
> **Claude Code**, and **Cursor / Grok 4.5** on this repo. Read `ONBOARDING.md` first.

---

## 1. Roles

**Claude (me) — orchestrator.** Holds the system model, decomposes work, writes the brief each
executor gets, and reviews diffs against `CLAUDE.md`. I do not
try to be the fastest typist in the room; I make sure three agents don't write three different
answers to the same question.

| Agent | Strength here | Give it |
| --- | --- | --- |
| **Gemini 3.1 Pro (Antigravity)** | 2M context, multimodal, whole-repo reads | Cross-cutting reads: "trace this value from Zoho to the UI", screenshot-driven UI diffs, auditing all 77 touchpoints at once, reading `WORKING_NOTES.md` end-to-end |
| **Claude Code** | Instruction adherence, refactors under constraints, tests | Anything touching `repos/`, RBAC, `toolDispatcher`, migrations, jobs — the places where rule 2/3/4/9 violations are expensive. Also the migration-generation dance. |
| **Cursor / Grok 4.5** | Fast in-editor iteration with live feedback | Horizon CSS propagation, component-level UI work, mechanical typecheck-error burndown, one-file-at-a-time changes with the dev server open |

---

## 2. Routing rules

**Send to Claude Code** when the change touches: `src/repos/**`, `src/modules/access/**`,
`src/modules/tools/**`, `src/db/schema/**` + migrations, `src/modules/jobs/**`, anything with
`riskClass`, or anything that could widen `department_access`. These are the invariants that break
quietly and get caught in prod, not in review.

**Send to Gemini** when the answer requires reading more than ~15 files, or when the input is an
image (screenshot review, design comparison), or when you need the *history* of a decision from the
383 KB working notes.

**Send to Cursor/Grok** when the loop is `edit → look at :5174 → edit again` and the blast radius is
one module's CSS or one component.

**Keep with the orchestrator:** anything ambiguous enough that the first job is deciding *what* the
task is.

---

## 3. Non-negotiable brief boilerplate

Every executor brief must carry these, because none of them are inferable from the code alone:

```
Repo: octane-assistant (Mytrion Horizon). Read CLAUDE.md before writing anything.

- Branch off `build`. Never push to main or build. Name it feature/* fix/* hotfix/*.
- No `any`, no unexplained `as unknown as X`. Files ≤ 600 lines.
- All DB access through src/repos/, ctx: TenantContext first arg, tenant filter first in .where().
- Schema change → edit src/db/schema/*.ts → `pnpm db:generate` → commit .ts + .sql + _journal.json.
  NEVER `drizzle-kit push`. Schema files that exist must be listed in drizzle.config.ts
  (see that file — do not re-warn about names already there).
- Every tool implements ToolManifest and dispatches through toolDispatcher. Read-only default.
- Before handing back: pnpm lint && pnpm typecheck && pnpm test.
  CI green is the floor. Do not regress. Do not embed a live test count here — read the
  latest verify job on `build` / `main`.
- UI work: consult modern-web-guidance skill. Horizon tokens (--hz-*), per-Mytrion accent,
  one loader per surface.
- apps/mytrion-crm/app/ is committed build output. It will show dirty. Reset with:
  git clean -fd -- apps/mytrion-crm/app && git checkout -- apps/mytrion-crm/app
```

Plus, per task, the three things agents most often get wrong here:

1. **Which bot / which app.** `agent-gateway` is the product Telegram bot. `agent-telegram-bot` is
   upstream hamroh — never run it. Both `.env`s carry the same token; two pollers = 409.
2. **Which database.** App Postgres `:5433` is the only writable one. DWH, CMP MySQL `:3307`, and
   the Verification DB are read-only replicas and never migration targets.
3. **Skills ≠ integrations.** The Claude skill list includes DAT, Pinecone, Pipedream, Cohere,
   Google Sheets, Gong. **None of them exist in this codebase.** An agent that reads a skill and
   starts wiring Pinecone has wasted a day.

---

## 4. Parallelization

Safe to run concurrently — these don't share files:

- Per-Mytrion UI work (`sales/` vs `billing/` vs `admin/` are disjoint trees).
- Backend module work vs frontend module work.
- Read-only investigations (always parallelize these; that's what the fan-out is for).

Serialize — single-writer only:

- **Migrations.** Two agents generating migrations produce two `00XX_` files with colliding numbers
  and a corrupt `_journal.json`. One owner at a time.
- **`src/config/env.ts`**, **`src/modules/jobs/catalog.ts`**, **`src/lib/mytrions.ts` +
  `apps/mytrion-crm/src/access/mytrions.config.ts`** (must move together),
  and **`apps/mytrion-crm/app/`** (rebuild output — one builder, or you get merge garbage).

---

## 5. Orchestrator review checklist

Before a fleet diff is accepted:

- [ ] Every new `.where()` starts with the tenant predicate.
- [ ] No `department_access` value derived from LLM output or a client header.
- [ ] New tools declare `riskClass`, `allowedAudiences`, `requiredScopes`, and are audit-logged.
- [ ] New tables have a migration file *and* a journal entry, and `drizzle.config.ts` lists the
      schema file.
- [ ] New queues: dead-letter target created before the referrer; retry policy is deliberate
      (retryLimit 0 where the side effect isn't idempotent — see `notification.statement-weekly`).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` match CI green. Do not regress.
- [ ] If a Mytrion was added or renamed, both `mytrions.ts` files changed in the same commit.

---

## 6. Backlog worth delegating now

| Task | Owner | Why |
| --- | --- | --- |
| Investigate breached live-eval floors (routing 0.46, grounding 0.50, delegation 0.00) | Claude Code + Gemini (read `eval-reports/`) | Agent quality is currently unmeasured-good |
| Decide + execute: turn pg-boss on in prod, or delete the cron surface | orchestrator → Claude Code | 13 queues exist and none run in prod |
| Finish Horizon propagation: Sales + Finance off inline styles onto tokens | Cursor/Grok | Largest remaining visual inconsistency |
| Un-gate or delete the four coming-soon Mytrions | orchestrator decision first | Built code behind a flag rots |
| Delete duplicated `finance/*.tsx`, drop unused `@tanstack/react-query` | Cursor/Grok | Mechanical |
| Refresh stale docs (README audiences/queue, DESIGN_BRIEF "all mock", CRM `api/config.ts`) | Gemini | Cross-file, low risk |
