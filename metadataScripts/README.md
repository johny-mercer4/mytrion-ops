# metadataScripts

Dev/ops tooling that introspects our external systems and writes a **metadata catalog**
(module/form API names, field API names, types, schemas, columns) to `output/`. We read
these catalogs while building tools so we target the *real* API names instead of guessing.

These scripts are **not** part of the server runtime. They're standalone, read-only, and
run on demand once the relevant `.env` values are set.

## Analyzers

| Script                 | Command             | Source                          | Output                       |
| ---------------------- | ------------------- | ------------------------------- | ---------------------------- |
| `zohoCrmAnalyzer.ts`   | `pnpm meta:zoho-crm`   | Zoho CRM v6 settings API     | `output/zoho-crm.{json,md}`   |
| `zohoDeskAnalyzer.ts`  | `pnpm meta:zoho-desk`  | Zoho Desk v1 API             | `output/zoho-desk.{json,md}`  |
| `zohoPeopleAnalyzer.ts`| `pnpm meta:zoho-people`| Zoho People forms API        | `output/zoho-people.{json,md}`|
| `dwhAnalyzer.ts`       | `pnpm meta:dwh`        | DWH Postgres information_schema | `output/dwh.{json,md}`     |

Each writes two files: a `.json` (machine-readable, for codegen/reference) and a `.md`
(human-readable tables). The `output/` directory is git-ignored.

## Required env

Set these in `.env` before running (see `.env.example`):

- **All Zoho analyzers:** `ZOHO_ACCOUNTS_DOMAIN` (match your data center), `ZOHO_CLIENT_ID`,
  `ZOHO_CLIENT_SECRET`, and a per-service refresh token minted with that service's read
  scopes (`ZOHO_CRM_REFRESH_TOKEN`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_PEOPLE_REFRESH_TOKEN`).
  A shared `ZOHO_REFRESH_TOKEN` is used as a fallback when a service token is unset.
  - CRM also uses `ZOHO_CRM_API_DOMAIN`; the token's returned `api_domain` takes precedence.
  - Desk also uses `ZOHO_DESK_BASE_URL` and optionally `ZOHO_DESK_ORG_ID` (else first org).
  - People also uses `ZOHO_PEOPLE_BASE_URL`.
- **DWH analyzer:** `DWH_DATABASE_URL` (a separate read Postgres, not the app's own DB).

## Notes

- Node 20+ global `fetch` is used for Zoho; `pg` for the DWH.
- Zoho scopes/endpoints vary by edition and data center. Per-module/per-form field calls
  are best-effort: a failure is logged and recorded as `fieldsError`/`error`, not fatal.
- Adjust the swept module lists (`DESK_MODULES` in `zohoDeskAnalyzer.ts`) as needed.
