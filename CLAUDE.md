# CLAUDE.md — Octane Assistant working instructions

## Project identity

Octane internal AI assistant. TypeScript backend. Multi-tenant-lite (internal + partner audiences).
Borrows architecture patterns from Mytrion but is a clean, standalone codebase.

## Telegram agent apps — DO NOT confuse them

There are **two** Telegram agent apps under `apps/`, plus a **separate Horizon worker bot** on the API.
When asked to "run the bot / gateway", the answer is almost always `agent-gateway` — not
`agent-telegram-bot`, and not the Horizon bot.

- **`apps/agent-gateway`** ← THE Octane support bot ("support bot v2", Claude Agent SDK, Node/tsx).
  Own `Dockerfile` + `docker-compose.yml` (`container_name: octane-agent-gateway`). Run it with
  `cd apps/agent-gateway && docker compose up -d --build`, logs `docker logs -f octane-agent-gateway`.
  Talks to the backend via `OCTANE_API_BASE` (`http://host.docker.internal:3001` inside the container).
  Token: **`TELEGRAM_BOT_TOKEN`** (carrier client mini-app / support bot). Long-polls `getUpdates`.
- **`apps/agent-telegram-bot`** — upstream **hamroh** framework (Python/uv, `python -m hamroh`). Not
  the product bot; do not launch it for Octane work.
- **Horizon worker CRM Mini App** (`apps/mytrion-crm` inside Telegram) — a **third** bot. Token:
  **`HORIZON_BOT_TOKEN`** + webhook secret **`HORIZON_BOT_SECRET`**. Webhooked by the API at
  `/v1/telegram/horizon-webhook`. Never put this token in agent-gateway. Never reuse
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CARRIER_BOT_TOKEN` as Horizon.
- **Only one poller per bot token.** Both gateway apps' `.env` carry the *same* `TELEGRAM_BOT_TOKEN`, so
  running both at once = Telegram `Conflict` (409). Kill one before starting the other.
  *(Session 2026-07-22: launched hamroh by mistake — wrong bot + token clash with the gateway.)*
  Setting `setWebhook` on the client token would also kill gateway polling — Horizon `setWebhook`
  uses `HORIZON_BOT_TOKEN` only.

## Local run stack (what "the app" needs to be up)

1. **Postgres on `localhost:5433`** — the app DB (`MYTRION_OPS_DATABASE_URL`). Provided by the **root**
   `docker-compose.yml` (`octane-postgres`, pgvector/pg16): `docker compose up -d postgres`. If it's
   down, the backend boots fine but every DB-backed route (e.g. `/v1/support-bot/whoami`) fails with
   `ECONNREFUSED ::1:5433` — this is the "Backend issue" the bot reports, NOT the server being off.
2. **Backend API + CRM web** — `pnpm dev:all` (API `:3001` health `/health`, web `:5173`). `dev:all`
   also starts the CMP **MySQL** SSH tunnel on `:3307` — that is unrelated to the `:5433` app DB.
3. **Gateway** — see above.

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
10. **Karpathy guidelines apply to every change** — think before coding, simplicity first, surgical
    changes, goal-driven execution. Stated in full below and in `.claude/skills/karpathy-guidelines/`.
11. For any UI/UX and web components work, you MUST first consult the `modern-web-guidance` skill. Prioritize modern aesthetics such as glassmorphism, dynamic animations, modern color thematics, and sleek loading states (avoid double loaders). Workspace product skills: Collection, Sales, Customer Service, Billing, HR, Admin (`.claude/skills/<name>-mytrion/`).

## Karpathy guidelines — apply to every change

Full text: `.claude/skills/karpathy-guidelines/SKILL.md` (mirrored to `.agents/skills/` and
`.cursor/skills/`). Derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876)
on LLM coding pitfalls; distillation from `forrestchang/andrej-karpathy-skills` (MIT). Biased toward
caution over speed — for trivial tasks, use judgment.

1. **Think before coding.** State assumptions explicitly; ask when uncertain. Present multiple
   interpretations rather than picking one silently. Say so when a simpler approach exists. If
   something is unclear, stop and name it.
2. **Simplicity first.** Minimum code that solves the problem, nothing speculative. No features
   beyond what was asked, no abstractions for single-use code, no unrequested flexibility, no error
   handling for impossible scenarios. 200 lines that could be 50 get rewritten.
3. **Surgical changes.** Touch only what you must; clean up only your own mess. Don't improve
   adjacent code, comments or formatting. Don't refactor what isn't broken. Match existing style.
   Mention unrelated dead code — don't delete it. Every changed line traces to the request.
4. **Goal-driven execution.** Define success criteria and loop until verified. "Fix the bug" becomes
   "write a test that reproduces it, then make it pass". For multi-step work, state a plan with a
   verify step per line.

Where these meet the hard rules above, both apply: `repos/` and `ToolManifest` are tenant-isolation
and RBAC boundaries, not speculative abstraction, so routing through them IS the minimal solution.

## Daily workflow

- Run `pnpm lint && pnpm typecheck && pnpm test` before pushing.
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`.
- **UI PRs — rebuild vendored frontends before opening/pushing the PR** (see below). Source-only
  merges do **not** change production UI.
- **Pre-push** (`.githooks/pre-push` → `scripts/git-pre-push.sh`) also runs the cheap CI PR
  gates vs `origin/build`: conventional commits, file-size cap, CRM vitest when
  `apps/mytrion-crm` src changed, vendored-bundle check. Not the full backend suite.

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

Rebase on `build` and rebuild the widget last before opening the PR.

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
- **ast-grep** (optional): `brew install ast-grep`, then `ast-grep --version`. Agents may shell out to `ast-grep` for syntax-shaped search. Missing binary is fine — see `.claude/skills/ast-grep/`. Not an MCP.

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
- Agents may `git push` the current `feature/*` / `fix/*` / `hotfix/*` branch (that is how PRs to `build` get opened). Never push `build` or `main` — not `origin build`/`origin main`, not `HEAD:build`/`HEAD:main`, not `--force` to those refs. Merge to `build`/`main` is PRs only.
- One-time: `git config core.hooksPath .githooks` so the pre-push hook is active.

## When in doubt

- Look at how Mytrion's `mytrion-engine` handles it (in another repo) — for pattern reference only.
- Ask in `WORKING_NOTES.md` before making architectural changes.
