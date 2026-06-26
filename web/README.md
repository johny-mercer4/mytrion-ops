# Octane Assistant — Zoho CRM widget (React + TS)

A Zoho CRM **widget** (runs inside CRM) built with Vite + React + TypeScript. Auth is the user's
existing **Zoho CRM session** via the **Embedded App SDK** — no login screen. On mount it reads the
current user (id, name, email, **profile, role**) and derives a department, which the Mytrion Ops
backend uses for department-agent RBAC.

## How it works

- `index.html` loads the Embedded App SDK (`ZohoEmbededAppSDK.min.js`) → global `ZOHO`.
- `src/zoho/embeddedApp.ts` — `loadZohoContext()`: registers `PageLoad`, calls
  `ZOHO.embeddedApp.init()`, then `ZOHO.CRM.CONFIG.getCurrentUser()`. Cached so it runs once.
  - `deriveDepartmentScope(user)` — **you own this**: maps profile/role → department key
    (sales/billing/customer-service/verification/collection/retention). Example rules included.
  - Outside CRM (local `vite dev`) the SDK can't initialize, so DEV falls back to a mock user.
- `src/hooks/useZohoUser.ts` — runs `loadZohoContext()` on mount; exposes loading/ready/error.
- `src/App.tsx` + `src/components/UserContext.tsx` — render the resolved user context.

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
