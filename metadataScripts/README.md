# metadataScripts

Dev/ops tooling that introspects our external systems and writes a **metadata catalog**
to `output/`. We read these catalogs while building tools and seed them into the RAG knowledge
base so the model targets the *real* API names (and valid values) instead of guessing.

Each analyzer pulls the **whole** schema it can reach:

- **CRM:** org profile, users, every module (with a `custom` flag), and per module: all fields
  with **picklist values**, **lookup/relationship targets**, length/mandatory/custom, plus
  **related lists**.
- **Desk:** organizations, departments, agents, teams, and per module: fields with their
  **allowedValues** (picklist options) and custom flag.
- **People:** all forms and their components (fields + picklist options where the edition exposes them).
- **DWH:** schemas → tables/views → columns, **primary keys**, **foreign keys** (relationship
  graph), **indexes**, and **activity status** (writes / vacuum stats) plus **deprecation**
  hints from table/column comments.

These scripts are **not** part of the server runtime. They're standalone, **read-only**, and
run on demand once the relevant `.env` values are set.

> **Write side / custom modules:** there is intentionally no "create custom module" script here.
> Zoho's public APIs do **not** support creating custom modules (CRM), forms (People), or a
> module concept (Desk) — that is a product-UI/admin operation. What the APIs *do* allow is
> creating custom **fields** (CRM `POST /settings/fields`) and **records** (all three). Any such
> write tooling is a separate, gated, admin-only concern — see WORKING_NOTES.

## Analyzers

| Script                 | Command             | Source                          | Output                       |
| ---------------------- | ------------------- | ------------------------------- | ---------------------------- |
| `zohoCrmAnalyzer.ts`   | `pnpm meta:zoho-crm`   | Zoho CRM v8 settings API     | `output/zoho-crm.{json,md}`   |
| `zohoDeskAnalyzer.ts`  | `pnpm meta:zoho-desk`  | Zoho Desk v1 API             | `output/zoho-desk.{json,md}`  |
| `zohoPeopleAnalyzer.ts`| `pnpm meta:zoho-people`| Zoho People forms API        | `output/zoho-people.{json,md}`|
| `zohoMetadataFetcher.ts` | `pnpm meta:fetch -- <crm\|desk> <Module>` | One module's fields (api name + data type) | stdout (+ optional `output/zoho-{service}-{module}.*`) |
| `dwhAnalyzer.ts`       | `pnpm meta:dwh`        | DWH Postgres information_schema | `output/dwh.{json,md}`     |
| `pgCatalogAnalyzer.ts` | `pnpm meta:pg-catalog` | All schemas/tables/columns + activity/deprecation (`--target dwh\|ops`) | `output/pg-catalog-{target}.{json,md}` |
| `pgTableMetadata.ts`   | `pnpm meta:pg-table`   | One table by name: columns (API names), types, activity, deprecation | stdout (+ optional `output/pg-table-*.{json,md}`) |

### Per-module fetcher (`zohoMetadataFetcher`)

When you only need **one** module's field catalog (API names + data types), use the focused
fetcher instead of the full org sweep:

```bash
pnpm meta:fetch -- crm Leads
pnpm meta:fetch -- desk tickets
pnpm meta:fetch -- crm Deals --write          # also write output/zoho-crm-Deals.{json,md}
pnpm meta:fetch -- desk contacts --json       # fields array only
```

### Postgres catalog (`pgCatalogAnalyzer` / `pgTableMetadata`)

Full catalog (all schemas, tables, reflective columns with data types, activity status):

```bash
pnpm meta:pg-catalog                  # DWH (DWH_DATABASE_URL)
pnpm meta:pg-catalog -- --target ops  # app DB (MYTRION_OPS_DATABASE_URL)
```

Single table lookup by name:

```bash
pnpm meta:pg-table -- intm_zoho_deals
pnpm meta:pg-table -- users --target ops
pnpm meta:pg-table -- intm_zoho_deals --schema octane --write
pnpm meta:pg-table -- deals --json
```

Interactive CLI (schemas, table detail, samples):

```bash
pnpm pg:inspect
pnpm pg:inspect -- --schema octane --table intm_zoho_deals
pnpm pg:inspect -- --target ops --table users
```

Activity is inferred from `pg_stat_user_tables` (insert/update/delete counts since stats reset,
recent autovacuum/analyze). Tables/columns whose Postgres comment contains `deprecated`, `legacy`,
`obsolete`, etc. are flagged as deprecated.

- **CRM:** `GET /settings/fields?module={api_name}` (v8 field-meta). Pass the CRM module API
  name (`Leads`, `Contacts`, `Deals`, custom modules, …).
- **Desk:** `GET /organizationFields?module={api_name}` with the `orgId` header. Module enum:
  `tickets`, `contacts`, `accounts`, `tasks`, `calls`, `events`, `contracts`, `products`.
- Uses **PROD** refresh tokens from `.env` (`ZOHO_CRM_REFRESH_TOKEN` / `ZOHO_DESK_REFRESH_TOKEN`),
  never the sandbox CRM token.

Each writes two files: a `.json` (machine-readable, for codegen/reference) and a `.md`
(human-readable tables). The `output/` directory is git-ignored.

## Required env

Set these in `.env` before running (see `.env.example`):

- **All Zoho analyzers:** `ZOHO_ACCOUNTS_DOMAIN` (match your data center), `ZOHO_CLIENT_ID`,
  `ZOHO_CLIENT_SECRET`, and a per-service refresh token minted with that service's read
  scopes (`ZOHO_CRM_REFRESH_TOKEN`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_PEOPLE_REFRESH_TOKEN`).
  A shared `ZOHO_REFRESH_TOKEN` is used as a fallback when a service token is unset.
  - CRM also uses `ZOHO_CRM_API_DOMAIN`; the token's returned `api_domain` takes precedence.
    For the full catalog, mint the token with `ZohoCRM.settings.modules.READ`,
    `ZohoCRM.settings.fields.READ`, `ZohoCRM.settings.related_lists.READ`, `ZohoCRM.users.READ`,
    `ZohoCRM.org.READ` (missing scopes degrade gracefully — that section is just skipped).
  - Desk also uses `ZOHO_DESK_BASE_URL` and optionally `ZOHO_DESK_ORG_ID` (else first org).
  - People also uses `ZOHO_PEOPLE_BASE_URL`.
- **DWH analyzer:** `DWH_DATABASE_URL` (a separate read Postgres, not the app's own DB).
- **Postgres catalog / table scripts:** `DWH_DATABASE_URL` (default) or `MYTRION_OPS_DATABASE_URL` (`--target ops`).

## Notes

- Node 20+ global `fetch` is used for Zoho; `pg` for the DWH.
- Zoho scopes/endpoints vary by edition and data center. Per-module/per-form field calls
  are best-effort: a failure is logged and recorded as `fieldsError`/`error`, not fatal.
- Adjust the swept module lists (`DESK_MODULES` in `zohoDeskAnalyzer.ts`) as needed.
