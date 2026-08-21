---
name: render-logs
description: Octane-specific Render debugging — which service is the API vs CRM widget, how to list_deploys/list_logs, and what Telegram "Backend issue" actually means (Postgres :5433). Use on failed deploys, prod 500s, or missing CRM UI after merge.
---

# Render logs (Octane)

Use the **existing** Render Cursor plugin (`list_services`, `list_deploys`, `list_logs`, `list_log_label_values`, `get_service`). Do **not** add a second Render MCP. Generic setup lives under `~/.cursor/plugins/cache/cursor-public/render/` — this file is the Octane map.

## What is deployed

**One web service.** Live name: **`mytrion-ops`**. `render.yaml`'s `octane-assistant-api` has drifted — do not apply that blueprint (it would downgrade the plan). Public URL: `https://octane-ops-ai.onrender.com`.

That process is the **API**. CRM is **not** a separate static site: Render serves the committed `apps/mytrion-crm/app` bundle from the same image at `/widget`. Source-only merges do not change prod UI. Health: `/v1/health` on Render (`healthCheckPath`); local API is `:3001` `/health`.

## Debug a failed deploy / 500

1. `get_selected_workspace` / `list_workspaces` — confirm the Octane workspace.
2. `list_services` — find `mytrion-ops` (web). Keep the service id.
3. `list_deploys` for that id — latest status / failed deploy.
4. `list_log_label_values` if you need `type` / instance values.
5. `list_logs` with `resource: [serviceId]`:
   - Build fail → `type: ["build"]`
   - Runtime 500 → `type: ["app"]` or `["request"]`, `level: ["error"]`, optional `path: ["/v1/..."]`
   - Paginate with `nextStartTime` / `nextEndTime` when `hasMore` is true.

Bind `0.0.0.0:$PORT`. Disk is ephemeral — see the Render platform rule.

## Local "Backend issue" on the Telegram bot

The API can boot while **Postgres on `localhost:5433`** is down (`MYTRION_OPS_DATABASE_URL`). That is the "Backend issue" the support bot reports — not "the server is off". Fix: `docker compose up -d postgres` (root compose, `octane-postgres`). The CMP MySQL tunnel on `:3307` is unrelated.

Wrong bot is a common miss (CLAUDE.md):

| Thing | Token / how |
| --- | --- |
| Support bot | `apps/agent-gateway`, `TELEGRAM_BOT_TOKEN`, long-poll |
| hamroh | `apps/agent-telegram-bot` — do not launch for Octane |
| Horizon CRM Mini App | `HORIZON_BOT_TOKEN` + webhook `/v1/telegram/horizon-webhook` |
