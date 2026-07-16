# CLAUDE.md — Octane Assistant working instructions

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

## Build & tooling conventions (read before editing imports)

- **ESM + explicit extensions.** This is an ESM package (`"type": "module"`). Relative imports use
  explicit `.js` extensions (e.g. `import { x } from './foo.js'`) so the same source runs under
  `tsx` (dev), Vitest (test), and `node dist` (prod) without a path-rewrite step. Do **not** use the
  `@/*` path alias in source imports — it typechecks but does not resolve under `node dist`.
- **tsconfig split.** `tsconfig.json` is the typecheck/IDE config (no `rootDir`, includes tests +
  scripts). `tsconfig.build.json` is emit-only (`rootDir: ./src`, src only). `pnpm build` uses the
  build config.
- **pnpm via Corepack.** If `pnpm` isn't on PATH, use `corepack pnpm ...`.

## Database migrations (Drizzle)

- **Schema change → always generate a migration file. Never `drizzle-kit push`.** When you add or
  alter a table/column, edit the schema in `src/db/schema/*.ts`, then run `pnpm db:generate`. That
  writes a new `src/db/migrations/00XX_*.sql` and updates `meta/_journal.json` automatically — commit
  the schema `.ts`, the generated `.sql`, and the journal together in the same commit.
- **`drizzle-kit push` is banned for shared work.** It mutates the connected DB directly and produces
  no migration file, so the change never reaches teammates or prod — a fresh `pnpm db:migrate` then
  fails on the missing table. `push` is only acceptable for a throwaway local experiment that is never
  committed. (This is exactly how `carrier_invitations` / `registered_mini_app_companies` ended up with
  schema files but no CREATE migration; the `0022` baseline fix exists to repair that.)
- **Apply with `pnpm db:migrate`.** It runs only not-yet-applied migrations (tracked in
  `drizzle.__drizzle_migrations` by journal timestamp), so editing an already-applied migration does
  **not** re-run it — safe on local and prod. Prefer `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT
  EXISTS` so a hand-edited baseline is idempotent across fresh and existing DBs.
- **Migrations only touch the local/prod app Postgres** (`MYTRION_OPS_DATABASE_URL`). The DWH
  (`DWH_DATABASE_URL`) and AWS MySQL sources are read-only replicas — never a migration target.
- **Verify before shipping a migration:** run it against a fresh throwaway DB and confirm
  `pnpm db:migrate` reaches the full table count green.

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
