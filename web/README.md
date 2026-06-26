# Octane Assistant — Zoho CRM widget (React + TS)

A Zoho CRM **widget** (runs inside CRM) built with Vite + React + TypeScript. Auth is the user's
existing **Zoho CRM session** via the **Embedded App SDK** — no login screen. On mount it reads the
current user (id, name, email, **profile, role**) and derives a department; the Mytrion Ops backend
uses that for department-agent RBAC (which knowledge + tools the chat may use). The main view is an
**AI Chat** that streams answers (RAG + tool calls) scoped to the signed-in user.

## How it works

**Auth / identity**
- `index.html` loads the Embedded App SDK (`ZohoEmbededAppSDK.min.js`) → global `ZOHO`.
- `src/zoho/embeddedApp.ts` — `loadZohoContext()`: registers `PageLoad`, calls
  `ZOHO.embeddedApp.init()`, then `ZOHO.CRM.CONFIG.getCurrentUser()`. Cached so it runs once.
  `getZohoSdk()` exposes the initialized SDK to the API layer.
  - `deriveDepartmentScope(user)` — **you own this**: maps profile/role → department key
    (sales/billing/customer-service/verification/collection/retention). Example rules included.
  - Outside CRM (local `vite dev`) the SDK can't initialize, so DEV falls back to a mock user
    (Administrator / CEO → unlimited scope, ideal for testing the agentic features).
- `src/hooks/useZohoUser.ts` — runs `loadZohoContext()` on mount; exposes loading/ready/error.

**Backend transport** (`src/api/`)
- `config.ts` — `resolveApiConfig()`: inside CRM reads the backend URL/key from **org variables**
  via `ZOHO.CRM.API.getOrgVariable`; in dev uses `VITE_API_URL` / `VITE_API_KEY`.
- `transport.ts` — `request()`: inside CRM routes through `ZOHO.CRM.HTTP` (no CORS, key injected
  server-side); in dev does a direct `fetch`. Unwraps the proxy envelope, throws `ApiError`.
- `chat.ts` — conversation session CRUD (`/v1/chat/conversations`).
- `stream.ts` — `streamChat()`: direct `fetch` + `body.getReader()` for live SSE tokens; on a CORS
  failure falls back (sticky) to the buffered `ZOHO.CRM.HTTP.post` proxy. Parses `event:`/`data:`
  frames → handlers (start/status/context/tool_call/tool_result/token/done/error).

**Chat UI** (`src/features/chat/`, one component + `.module.css` each)
- `useChat.ts` — `useReducer` state machine: send a turn, accrete tokens/tools/grounding onto the
  streaming assistant row, list/open/delete conversation sessions (owner-scoped by Zoho user id).
- `ChatPanel` (sidebar + transcript + composer) · `ConversationList` · `MessageList` ·
  `MessageBubble` (status, tool chips, grounding count, streaming caret) · `Composer`.
- `src/App.tsx` gates on `useZohoUser` → renders `<ChatPanel context={…} />` when ready.

## Local dev (outside CRM)

```bash
pnpm install
pnpm dev          # http://localhost:3000 — shows the DEV MOCK user (SDK can't init outside CRM)
pnpm typecheck
pnpm build        # → ./app  (the widget web root)
```

`vite dev` runs on port **3000**, which is already in the backend's CORS allowlist.

## Run / package as a Zoho widget (zet)

Uses Zoho's Extension Toolkit (`npm i -g zoho-extension-toolkit`, then `zet`):

```bash
pnpm build        # builds into ./app
zet run           # serves ./app over HTTPS for the CRM sandbox to load
zet validate      # checks plugin-manifest.json
zet pack          # → zip for upload to the Zoho Marketplace / your org
```

Adjust `plugin-manifest.json`:
- `modules.widgets[].type` / location to your widget placement (web tab, button, related list).
- `cspDomains.connect-src` → your real backend host (replace `YOUR_BACKEND_HOST`).

## Security

- **Never bundle the backend `API_KEY` into the widget.** In production, call the backend through a
  Zoho **Connection** (key stored server-side, injected by Zoho's proxy) — `VITE_API_KEY` is for
  local dev only.
- The widget only needs the user's profile/role/department; the backend enforces all RBAC.
