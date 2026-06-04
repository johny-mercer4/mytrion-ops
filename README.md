# Octane Assistant

Internal AI assistant for Octane. Serves Octane employees and external partners (drivers, fleet
managers) through a single typed backend.

> Architecture patterns are borrowed from Mytrion as a mental model only. **No Mytrion code is
> imported.** This is a clean, standalone codebase.

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in OPENAI_API_KEY, JWT_SECRET, etc.
docker compose up -d            # Postgres (pgvector)
pnpm db:migrate                 # apply schema
pnpm db:seed                    # creates admin@octane.com / changeme
pnpm dev                        # API on :3001
```

> pnpm is invoked via Corepack in this environment. If `pnpm` is not on your PATH, run
> `corepack enable pnpm` (or prefix commands with `corepack pnpm ...`).

## Architecture

- **Fastify 4** API (`src/server.ts` → `src/app.ts` factory)
- **OpenAI SDK** for chat + embeddings (`gpt-4o-mini` default, `gpt-4o` for hard tasks)
- **pgvector on Postgres 16** for knowledge retrieval (1536-dim embeddings)
- **Drizzle ORM** for type-safe DB access; every query flows through `src/repos/*`
- **Knowledge ingestion** runs synchronously in-process (chunk → embed → pgvector); no queue
- **JWT auth** (`jose`) + role-based access: `admin`, `ops`, `finance`, `support`, `viewer`,
  `driver`, `fleet_manager`
- **Multi-tenant-lite**: one schema; every row tagged with `tenant_id` + `audience`
  (`internal` | `partner`); isolation enforced in the repo layer.
- **Department RBAC**: `department_access` (caller-supplied per request) gates both RAG retrieval
  and tool calling. Knowledge docs are tagged per department (NULL = shared/global); managers get
  all-access. Train via `POST /v1/knowledge/upload` (multipart `.md`/text + optional `department`).
- **Integration auth** is centralized in `src/integrations/wrapper.ts` (`wrapper.authHeaders(platform)`),
  which caches Zoho OAuth tokens and handles CMP api-key auth.

## Tool calling

Tools are **hard-coded** TypeScript modules implementing the `ToolManifest` contract
(`src/modules/tools/types.ts`). Each declares its `riskClass`, `allowedAudiences`, and
`requiredScopes`. The dispatcher re-checks RBAC **before** every handler runs. Read-only is the
default; write tools require `riskClass: 'write'` and the `admin` role.

## Deploy

Render via `render.yaml`. One web service + one managed Postgres with pgvector.
Run `scripts/enable-pgvector.sql` (`CREATE EXTENSION IF NOT EXISTS vector;`) once before the first
deploy.

## Testing

`pnpm test` → Vitest. The RBAC cross-tenant leakage tests in `tests/unit/rbac.test.ts` must pass.

## Scripts

| Command             | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `pnpm dev`          | Run API with hot reload (tsx)                    |
| `pnpm build`        | Compile TypeScript → `dist/`                     |
| `pnpm start`        | Run compiled API (`node dist/server.js`)         |
| `pnpm db:generate`  | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate`   | Apply pending migrations                         |
| `pnpm db:seed`      | Seed initial admin user + sample tenants         |
| `pnpm lint`         | ESLint                                           |
| `pnpm typecheck`    | `tsc --noEmit`                                   |
| `pnpm test`         | Vitest                                           |
