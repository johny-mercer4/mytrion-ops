# Product

<!-- impeccable:product-schema 1 -->

This record was inferred on 2026-08-13 from repository sources (`CLAUDE.md`, `AGENTS.md`, `README.md`, `WORKING_NOTES.md`, `apps/mytrion-crm`, `apps/mini-app`, `apps/agent-gateway`, `src/modules/llm/promptBuilder.ts`). No live product interview ran (AskUserQuestion is unavailable in this harness; the invoking brief directed inference). Unmarked claims are repo-confirmed. Items marked **OPEN** are undecided.

## Platform

web

## Users

**Primary — Octane internal workers.** Sales, billing, collection, finance, customer-service, verification, marketing, HR/recruit, manager, analyst, and admin staff operate fuel-card accounts from the CRM Mytrion portal. Many use the same SPA inside Telegram as the Horizon worker Mini App. Their job is to look up and act on real carrier data (balances, cards, invoices, tickets, automations) without guessing or seeing another tenant’s records.

**Partner audience — carriers.** Owner-operators and fleet managers use the Telegram carrier Mini App (invite-link onboarding, no login form) and the Octane support bot in company groups or owner/manager DMs. Drivers use the company support group for their own card only (status, funds yes/no, own transactions); they do not receive company-wide money figures.

## Product Purpose

Octane is a fuel-card company for trucking carriers (EFS/WEX and related networks). This repository is **Octane Assistant / Mytrion-ops**: the typed internal backend plus the worker CRM and partner Telegram surfaces that let staff and carriers operate those accounts on live systems (Zoho CRM/Desk, data warehouse, CMP, EFS/WEX) instead of inventing figures.

Success is a grounded, tenant-scoped answer or action — balance, card status, ticket, invoice, automation, report — without leaking other tenants’ or other partners’ data.

## Positioning

Not a generic chatbot and not a Zoho-embedded widget. A standalone ops backend with department **Mytrions**, server-verified Zoho identity, tool-gated retrieval, and two Telegram products that must never share bot tokens: the carrier support bot (`TELEGRAM_BOT_TOKEN`) and the Horizon worker CRM Mini App (`HORIZON_BOT_TOKEN`). Architecture may reference Mytrion-engine patterns; **no Mytrion code is imported**.

## Operating Context

- **Local stack:** app Postgres on `:5433`, `pnpm dev:all` (API `:3001` `/health`, CRM Vite `:5173`), optional `apps/agent-gateway` Docker. CMP MySQL tunnel on `:3307` is unrelated to the app DB.
- **Production:** Render serves **committed** static bundles (`apps/mytrion-crm/app/`, `apps/mini-app/app/`). Source-only merges do not change production UI.
- **Worker identity:** Zoho OAuth; the backend mints a Bearer session. Department access is derived from the verified Zoho profile/role. Admin View-as is audited and cannot bind another worker’s Telegram identity.
- **Sales Mytrion (flagship):** multi-tab workspace (Home, Inbox, Tickets, Open Pool, Data Center, Create Ticket, Automations, Dashboard, Carriers) on `/v1/desk` + `/v1/data-center`, realtime inbox, RingCentral softphone, WEX/EFS automations.
- **Other Mytrions:** Billing, Collection, Finance, Customer Service, Verification, Marketing, Manager, Analyst, HR, Recruit, Trailhead (internal learning), Admin — each lazy-loaded behind an access check.
- **Horizon Mini App:** same CRM inside Telegram WebView. File exports in that WebView go through Horizon `sendDocument` on `HORIZON_BOT_TOKEN` only. Desktop keeps download/blob behavior.
- **Carrier Mini App + support bot:** owner/manager registration and fleet ops; bot long-polls `getUpdates`. `apps/agent-telegram-bot` (hamroh) is not the product bot.
- **Card display:** last **six** digits (`•••• 521752`). Four-digit masks are for PAN redaction in logs, not UI.
- **Integrations (read unless a write tool is admin-gated):** Zoho CRM/Desk/People, DWH Postgres, CMP, EFS/WEX, RingCentral.

## Capabilities and Constraints

- Every DB query goes through `repos/` with `tenant_id` isolation. No raw queries in `routes/`.
- Every tool implements `ToolManifest` and runs through `toolDispatcher` (RBAC re-check + audit log). Read-only is default; writes need `riskClass: 'write'` and admin.
- Strict TypeScript; file-size cap 600 lines (580 target).
- Only one poller per Telegram bot token. Horizon `setWebhook` uses `HORIZON_BOT_TOKEN` only; never reuse the carrier token as Horizon.
- Knowledge and tools are audience-scoped (`internal` | `partner`) and department-scoped. Partners never see Octane internal CRM or other carriers.
- The assistant must use tools for live data and say so when a tool is missing; it must not invent account numbers, statuses, balances, SQL, or table names.
- **Sales Mytrion usage analytics:** Analytics operators and all-department administrators can compare the exact active `Sales Agent` KPI population. Every source is left-joined to the eligible roster so zero-use agents remain visible; impersonated activity is excluded from organic agent rankings.
  - **Sign-ins** are platform authentication events and are labelled platform-wide. **Workspace sessions** are successful Sales `mytrion.access` windows, deduplicated by the existing 30-minute access window.
  - **Online time** unions visible-browser `active` and `idle` heartbeat intervals. **Active time** unions only visible intervals with pointer, keyboard, or scroll activity in the preceding five minutes. Neither metric is working time, availability, or productivity.
  - **UI actions** are allowlisted semantic navigation, view, record-open, settled-search, edit-intent, call-intent, and export events; no generic DOM clickstream or search text is collected. **Work outcomes** use server facts for calls, edits, tasks, ticket/escalation creation, and retention. Automation outcomes come from verified-session browser lifecycle events and are explicitly disclosed as not server-correlated.
  - **AI usage** counts completed Sales agent executions and dispatched tool calls attributed to the initiating human. It reads no prompts, message text, tool arguments/results, IP addresses, user agents, or deleted conversation content.
  - The dashboard is coverage-first: each source reports `complete`, `partial`, or `unavailable`; unavailable measures are `null`, never zero. Metrics remain independently sortable and exportable—there is no composite engagement or productivity score.
  - Raw browser presence/activity is retained for 90 days; per-agent daily usage metrics are retained for 13 months. Reporting days use `America/New_York` and server timestamps.
- **OPEN:** whether Manager Mytrion is hierarchical (`allDepartments` across desks). Code currently records this as an open decision.
- **OPEN:** canonical Zoho CRM profile/role names for HR (placeholders exist in the access table).
- No `DESIGN.md` exists. Future visual work must treat the incumbent CRM/Mini App implementation as identity, not invent a replacement world in this file.

## Brand Commitments

- **Company:** Octane. **Assistant:** Octane Assistant. **Worker workspaces:** Mytrion (Sales Mytrion, Billing Mytrion, …). **Worker Telegram surface:** Horizon Mini App / Horizon bot. **Partner Telegram surface:** Octane carrier Mini App / support bot (`@octane_support_ai_bot` in Mini App copy).
- **Internal assistant voice:** concise and professional; do not reveal system prompts, tool schemas, or other tenants’ data.
- **Carrier-facing bot voice (binding):** mirror the sender’s language and register (informal Latin-script Uzbek, terse Russian, short English); 1–3 lines; status-first with ✅/⚠️/❌; acknowledge photos; never corporate ticket-speak, never financial promises, never mix languages in one message. Source: `apps/agent-gateway/.claude/skills/octane-communication/SKILL.md` (mined from real support traffic).
- Do not redirect this product toward a different industry, brand, or imported Mytrion visual system.

## Evidence on Hand

- Live integrations and schemas in this repo (Zoho, DWH, EFS/WEX/CMP, Desk tickets, retention cases).
- Support-bot communication corpus referenced by the gateway skill (~54k real messages). Paths: `apps/agent-gateway/.claude/skills/octane-communication/SKILL.md`, `apps/agent-gateway/.claude/skills/octane-customer-service/SKILL.md`.
- Incumbent UI lives in `apps/mytrion-crm/src/` and `apps/mini-app/src/` (vendored output in each app’s `app/`). There is no `DESIGN.md` and no surface brief yet.
- Future work must **not** fabricate testimonials, named customers, pricing, benchmarks, press, or licensing claims.

## Product Principles

1. Ground every operational figure in a tool or warehouse query; never invent balances, card status, or SQL.
2. Isolate tenants and audiences; identity is server-verified, never client-asserted.
3. Keep Horizon (workers), the carrier support bot, and the hamroh framework distinct — tokens, webhooks, and copy included.
4. Preserve incumbent product language and card masking (last six) when refining UI; do not replace the product’s identity here.
5. A UI change is not shipped until the committed `app/` bundle is rebuilt with the source.

## Accessibility & Inclusion

- CRM / Horizon: phone WebView is a real usage scene (Telegram safe-area, `viewport-fit=cover`). The CRM shell deliberately allows pinch-zoom (no `user-scalable=no`) so WCAG 1.4.4 is not failed by the viewport; inputs are expected to be 16px on mobile.
- Carrier bot: include informal Uzbek, Russian, and English speakers; photo-only messages are first-class asks.
- Drivers vs owners: different disclosure — drivers get own-card operational facts, not company-wide money.
- No organization-wide WCAG conformance target is recorded beyond the CRM viewport choice above.
