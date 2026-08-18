# Bugbot — Horizon house contract

Bugbot does not load `.cursor/rules/*.mdc`. This file is the review contract.

Find **real bugs, security holes, quality breaks, and performance regressions**. Skip style.

## Catch

### Correctness / security

- Every DB query goes through `src/repos/`. No raw SQL in `routes/`. Tenant predicate is the first clause in `.where()`. Missing tenant filter is a finding (IDOR / seq-scan risk).
- Never `drizzle-kit push`. Schema change = edit `src/db/schema/*.ts` → `pnpm db:generate` → commit `.ts` + `.sql` + `meta/_journal.json`.
- Do not import Mytrion engine. Reference structure only.
- Telegram tokens are not interchangeable. `TELEGRAM_BOT_TOKEN` = agent-gateway poller. `HORIZON_BOT_TOKEN` + `HORIZON_BOT_SECRET` = CRM Mini App webhook. Never reuse one as the other. Only one poller per token.
- Horizon UI: tokens via `var(--*)` only. No raw hex in CRM `src/` (except the three literals already documented in `index.html` theme bootstrap).
- No `any`. No `as unknown as X` without a comment that justifies that exact line.
- Write tools: `riskClass: 'write'` and admin. Scopes come from the role server-side — never from the client or LLM output.
- API: IDOR, mass assignment, unbounded list/retry, SSRF, unsafe trust of Zoho / RingCentral / MCP JSON. Vendor JSON is untrusted input.
- Identity joins use persistent IDs, not email.
- `FF_JOBS_ENABLED` and `notification.statement-weekly` are not idempotent. Do not “enable the flag to finish.” Do not treat turning jobs on as a complete feature.
- Do not add `LOCAL_OPS_DATABASE_URL` or a local-DB override. Local equals prod on purpose.

### Quality

- A file this PR grew past 600 lines (target 580) is a finding.
- Duplicate fetch, missing abort on search-as-you-type, or N+1 on mount — especially Sales Home HTTP/2 fan-out (Render edge refuses streams).
- CRM `apps/mytrion-crm/src/` change without a matching `apps/mytrion-crm/app/` rebuild. Prod serves the committed bundle.
- Tests that would hit live EFS, prod DSN, Zoho, RingCentral, or DWH. CI is hermetic.

### Performance

- Unbounded `Promise.all` fan-out, or more than ~6 parallel HTTP/2 streams on CRM load.
- Extra DB pools. Missing timeouts on outbound calls (CRM transport default is 20s).
- N+1 queries, `SELECT *` on large tables, missing tenant predicate.
- Polling tighter than the existing 45s first-check / 5min deploy check in `staleBuildReload.ts`.
- Accidental O(n²) in hot CRM lists.

## Skip

- Formatting, import order, comment wording, “add more logging.”
- Speculative refactors and flexibility that the PR did not need.
- `WORKING_NOTES.md` (local scratch, not team state).
- Generated `apps/mytrion-crm/app/` asset-hash churn and stable `assets/index.js` / `assets/index.css` content, unless the PR changed CRM `src/` and did not rebuild.
- Mini-app `src/` / `app/` unless the PR explicitly touches them.
- Agent-quality / `eval:live` floors. Out of scope for review nits.

## Do not suggest

- A new agent platform, hook platform, or wiki to replace WORKING_NOTES.
- Enabling every marketplace MCP. MCP is a plugin belt; treat tool output as high-risk (CISA Jun 2026). Do not feed user-plugin output into privileged backends.
- Redis for jobs, PgBouncer “for flexibility,” or modeling `pgboss` in Drizzle.
