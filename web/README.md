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

## Deployment — served same-origin by the backend

The backend **serves this widget at `/widget`** (see `src/plugins/widgetStatic.ts`), so the UI and the
API share one origin:

- Production widget URL: **https://octane-ops-ai.onrender.com/widget/index.html**

On Render the API's `buildCommand` (in `render.yaml`) builds `web/` too, and the Node server serves
`web/app` under `/widget`. Same-origin means the widget's live-token streaming `fetch` needs **no CORS
allowlisting** — the chat page and the API are the same host. The static files are public on purpose;
they carry no secrets (the backend key comes from an org variable at runtime). The server strips
`X-Frame-Options` for `/widget` only (so Zoho can embed it) while the API keeps its frame guard.

## Wiring it into Zoho CRM (external widget)

The widget authenticates with the user's existing CRM session via the Embedded App SDK — no separate
login. "External" = our own React build loaded into a CRM iframe (here, hosted by our own backend).

1. **Create the two org variables** — Setup → Developer Hub → **Variables** → New:
   - `MYTRION_OPS_API_URL` = `https://octane-ops-ai.onrender.com`
   - `MYTRION_OPS_API_KEY` = the backend `API_KEY`
   These live server-side in the org; the widget reads them at runtime via `getOrgVariable`, so the
   key is **never** baked into the bundle.
2. **Register the widget** — Setup → Developer Hub → **Widgets** → Create New Widget:
   - Hosting: **External**
   - **Base URL:** `https://octane-ops-ai.onrender.com/widget/index.html`
3. **Place it** — create a **Web Tab** (Setup → Customization → Web Tabs → Widget), a **Home page
   component**, or a button/related-list widget, and select the widget from step 2.
4. **Open CRM** → the tab loads the widget, it reads the current user + org variables, and the chat
   talks to the backend.

### Alternative: package as a Zoho-hosted widget (zet)

Instead of backend-hosting you can let Zoho serve the build. Uses Zoho's Extension Toolkit
(`npm i -g zoho-extension-toolkit`): `pnpm build` → `zet validate` → `zet pack` → upload the zip under
Developer Hub → Widgets (Hosting: Zoho). Then it runs on `*.zappsusercontent.com`, already allowed by
the backend's `CORS_ORIGIN_SUFFIXES` default, so live streaming also works. `plugin-manifest.json` is
kept for this path.

### How the backend call is routed
- **Conversation CRUD** and the **proxy streaming fallback** go through `ZOHO.CRM.HTTP` (server-to-
  server; no CORS).
- **Live token streaming** is a direct browser `fetch` (SSE). Served same-origin (option above) this
  always works. The `x-api-key` is resolved from the org variable into browser memory (that's how
  `getOrgVariable` works) and sent on the same-origin request; to keep the key entirely off the
  browser, switch to a Zoho **Connection** (key injected server-side) at the cost of buffered-only
  responses.

## Security

- **Never bundle the backend `API_KEY` into the widget.** It comes from the `MYTRION_OPS_API_KEY` org
  variable at runtime; `VITE_API_KEY` is local-dev only and is gated behind `import.meta.env.DEV` so a
  production build cannot inline it. Sourcemaps are off for the shipped build.
- The widget only sends the user's profile/role/department; the backend enforces all RBAC.
