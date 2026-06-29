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

## Backend

Production backend: **https://octane-ops-ai.onrender.com** (Render). The widget never hardcodes this —
it reads the URL + key at runtime from the org variables below, and `plugin-manifest.json`'s
`cspDomains.connect-src` whitelists the host so the browser permits the call.

## Run / package as a Zoho widget (zet)

Uses Zoho's Extension Toolkit (`npm i -g zoho-extension-toolkit`, then `zet`):

```bash
pnpm build        # builds into ./app
zet run           # serves ./app over HTTPS for the CRM sandbox to load (dev/test)
zet validate      # checks plugin-manifest.json
zet pack          # → zip for upload to your org (Developer Hub) or the Marketplace
```

`plugin-manifest.json` is already wired:
- `cspDomains.connect-src` → `https://octane-ops-ai.onrender.com` (+ `http://localhost:3001` for dev).
- `modules.widgets[]` → adjust `type`/placement to your widget location (web tab, button, related list).

## Wiring it into Zoho CRM (external widget)

The widget authenticates with the user's existing CRM session via the Embedded App SDK — there is no
separate login. "External" here means **our own React build**, loaded into a CRM iframe; you can let
Zoho host the build (zip) or host it on your own HTTPS URL. Steps:

1. **Create the two org variables** — Setup → Developer Hub → **Variables** → New:
   - `MYTRION_OPS_API_URL` = `https://octane-ops-ai.onrender.com`
   - `MYTRION_OPS_API_KEY` = the backend `API_KEY`
   These live server-side in the org; the widget reads them at runtime via `getOrgVariable`, so the
   key is **never** baked into the bundle.
2. **Register the widget** — Setup → Developer Hub → **Widgets** → Create New Widget:
   - Hosting **Zoho** → upload the `zet pack` zip (Zoho serves it from `*.zwidgets.com`), **or**
     Hosting **External** → point at your HTTPS URL serving `app/index.html`.
   - Index page: `/app/index.html`.
3. **Place it** — create a **Web Tab** (Setup → Customization → Web Tabs → Widget), a **Home page
   component**, or a button/related-list widget, and select the widget from step 2.
4. **CSP** — `connect-src` (above) must include the backend host or the browser blocks the call. The
   SDK script host (`live.zwidgets.com`) is allowed by Zoho automatically.
5. **Open CRM** → the tab loads the widget, it reads the current user + org variables, and the chat
   talks to the backend (via the `ZOHO.CRM.HTTP` proxy, with a direct-fetch streaming attempt first).

### How the backend call is routed (and the key tradeoff)
- **Conversation CRUD** and the **proxy streaming fallback** go through `ZOHO.CRM.HTTP` — a
  server-to-server proxy (no CORS; the request leaves Zoho's infra, not the browser).
- **Live token streaming** is attempted first as a direct browser `fetch` (SSE). For this to succeed
  the backend must allow the widget's origin. A **Zoho-hosted** widget runs on
  `https://<instance>.zappsusercontent.com`, which the backend already allows via
  `CORS_ORIGIN_SUFFIXES=zappsusercontent.com` (its default) — so live streaming works out of the box.
  An **externally-hosted** widget must have its exact origin added to the backend's `CORS_ORIGINS`.
  If the origin isn't allowed, the widget transparently falls back to the buffered proxy for the
  rest of the session (you still get the full answer, just not token-by-token).
- The `x-api-key` is resolved from the org variable into browser memory either way (that's how
  `getOrgVariable` works), so the direct-fetch attempt's only extra exposure is the user's own Network
  tab. To keep the key entirely off the browser, switch to a Zoho **Connection** (key injected
  server-side) — at the cost of buffered-only responses inside CRM.

## Security

- **Never bundle the backend `API_KEY` into the widget.** It comes from the `MYTRION_OPS_API_KEY` org
  variable at runtime; `VITE_API_KEY` is local-dev only and is gated behind `import.meta.env.DEV` so a
  production build cannot inline it. Sourcemaps are off for the shipped build.
- The widget only sends the user's profile/role/department; the backend enforces all RBAC.
