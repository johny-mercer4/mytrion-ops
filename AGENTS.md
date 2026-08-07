# AGENTS.md — Octane Assistant working instructions

## Project identity

Octane internal AI assistant. TypeScript backend. Multi-tenant-lite (internal + partner audiences).
Borrows architecture patterns from Mytrion but is a clean, standalone codebase.

## Hard rules

1. Never import code from Mytrion. Reference structure only.
2. Every DB query goes through `repos/`. Repos enforce `tenant_id` isolation. No raw queries in `routes/`.
3. Every tool implements `ToolManifest`. No exceptions.
4. Every tool call passes through `toolDispatcher`, which re-checks RBAC.
5. File size cap: 600 lines, 580 target.
6. Strict TypeScript. No `any`. No `as unknown as X` without a comment justifying it.
7. Read-only is default. Write tools require `riskClass: 'write'` and admin role.
8. Every tool call is audit-logged.
9. Tests for RBAC cross-tenant leakage MUST pass before any feature work.

## Daily workflow

- Append a dated entry to `WORKING_NOTES.md` for each session.
- Run `pnpm lint && pnpm typecheck && pnpm test` before pushing.
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`.
- **UI PRs — rebuild vendored frontends before opening/pushing the PR** (see below). Source-only
  merges do **not** change production UI.

## Vendored frontend builds (REQUIRED before UI PRs)

Prod (Render) serves **committed** static bundles — it does **not** run Vite at deploy time:

| App | Source | Served from (commit these) | Rebuild command |
| --- | --- | --- | --- |
| Sales / CRM Mytrion | `apps/mytrion-crm/src/` | `apps/mytrion-crm/app/` | `pnpm build:widget` |
| Telegram mini-app | `apps/mini-app/src/` | `apps/mini-app/app/` | `pnpm -C apps/mini-app build` (then commit `app/`) |

**Before every PR that changes UI under those `src/` trees:**

1. Run the rebuild command for the app you touched.
2. Commit the updated `app/` (and `app/index.html`) in the **same PR** as the source change.
3. Confirm the new behavior string exists in the hashed bundle (e.g. `rg 'EFS Balance' apps/mytrion-crm/app`).

Skipping this ships code that looks merged on GitHub while prod still shows the old screen
*(2026-08-07: Overview EFS Balance tile missing until `app/` was rebuilt — PR #149).*

`pnpm dev:all` / Vite dev server is fine for local preview; it is **not** a substitute for
committing `app/` when opening a PR to `build` / `main`.

## Build & tooling conventions (read before editing imports)

- **ESM + explicit extensions.** This is an ESM package (`"type": "module"`). Relative imports use
  explicit `.js` extensions (e.g. `import { x } from './foo.js'`) so the same source runs under
  `tsx` (dev), Vitest (test), and `node dist` (prod) without a path-rewrite step. Do **not** use the
  `@/*` path alias in source imports — it typechecks but does not resolve under `node dist`.
- **tsconfig split.** `tsconfig.json` is the typecheck/IDE config (no `rootDir`, includes tests +
  scripts). `tsconfig.build.json` is emit-only (`rootDir: ./src`, src only). `pnpm build` uses the
  build config.
- **pnpm via Corepack.** If `pnpm` isn't on PATH, use `corepack pnpm ...`.

## Git branching & workflow

- **`main`** — production/deployment branch. Anything merged into `main` deploys to prod. Never push
  directly into `main`.
- **`build`** — the collection branch where updates get gathered. Never push or merge into `build`
  directly. Fetch the latest `build`, branch off it, set up locally, and work there — merging back
  into `build` goes through review, not a direct push.
- **Branch naming:** `feature/***`, `fix/***`, `hotfix/***`.

## When in doubt

- Look at how Mytrion's `mytrion-engine` handles it (in another repo) — for pattern reference only.
- Ask in `WORKING_NOTES.md` before making architectural changes.
