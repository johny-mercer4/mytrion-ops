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

## Workspace product skills

Workspace product skills (`.claude/skills/<name>/`, mirrored to `.cursor` and `.agents`): Collection, Sales, Customer Service, Billing, HR, Admin. `.agents/` is gitignored; `git add -f` skill updates like the Zoho mirrors.

Optional tooling skills: `ast-grep` (not MCP), `context7` (library docs plugin — not this repo's `mcp.json`), `render-logs` (Octane Render map). UI verify: `.cursor/rules/ui-verify.mdc`.

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

## Git branching & workflow

- **`main`** — production/deployment branch. Anything merged into `main` deploys to prod. Never push
  directly into `main`.
- **`build`** — the collection branch where updates get gathered. Never push or merge into `build`
  directly. Fetch the latest `build`, branch off it, set up locally, and work there — merging back
  into `build` goes through review, not a direct push.
- **Branch naming:** `feature/***`, `fix/***`, `hotfix/***`.
- Agents may `git push` the current `feature/*` / `fix/*` / `hotfix/*` branch (that is how PRs to `build` get opened). Never push `build` or `main` — not `origin build`/`origin main`, not `HEAD:build`/`HEAD:main`, not `--force` to those refs. Merge to `build`/`main` is PRs only. Codex: push the feature branch only; never push `build`/`main`.
- One-time: `git config core.hooksPath .githooks` so the pre-push hook is active.

## When in doubt

- Look at how Mytrion's `mytrion-engine` handles it (in another repo) — for pattern reference only.
- Ask in `WORKING_NOTES.md` before making architectural changes.
