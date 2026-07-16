# Wrappers

Named, typed façades over external systems — one file per system, exposing domain methods
(`getCarrierBalance(carrierId)`) instead of raw path strings or SQL leaking into callers. This is
the formalization of what was previously ad-hoc inline calls in route handlers.

## What's here

- **`serverCrmWrapper.ts`** — the servercrm HTTP surface (`src/integrations/serverCrm.ts`). Carrier
  balance/overview/cards/transactions/payment-info/invoices — all DWH-backed reads, live EFS balance
  included. First consumer: `src/routes/v1/carrierMiniApp.routes.ts`'s self-service routes.
- **`cmpWrapper.ts`** — CMP-touching servercrm endpoints (live CMP debtors overlay, invoice
  PDF/Excel export). Thin façade — CMP itself is never called directly from this repo; servercrm
  holds the real REST client. Scaffolded from servercrm's route inventory, not yet exercised by a
  live caller here — verify shapes before depending on them in production code.
- **`efsWrapper.ts`** — EFS-touching servercrm endpoints (live card list/info/override, single-card
  EFS lookup, activation). Same thin-façade shape — EFS itself (SOAP) is never called directly here.
- **`serverCrmClient.ts`** — the shared low-level GET/POST + error-mapping used by all three of the
  above, so the servercrm error handling lives in one place.

## What's intentionally NOT here

- **Zoho CRM/Desk/People** (`src/integrations/zohoCrm.ts`/`zohoDesk.ts`/`zohoPeople.ts`) — already a
  solid, working wrapper layer sharing `wrapper.ts`'s auth base. Left alone; not migrated into this
  directory.
- **DWH** (`src/integrations/dwh.ts` + `dwhCards.ts`/`dwhClients.ts`/`dwhOperators.ts`/`dwhRetention.ts`)
  — same story, already solid, left alone.
- **PostgreSQL (internal)** — `src/repos/*.ts` + `src/repos/util.ts` + `src/db/client.ts` already fill
  this role (one file per domain, no shared base class) — matches servercrm's own philosophy of "no
  shared repository abstraction, just focused query modules." Not re-invented here.
- **`cmpDatabaseWrapper.ts` (MySQL / CMP database, `tss_db`) — not yet built.** `src/integrations/awsMysql.ts`
  is real and previously verified live against `tss_db` (92 tables) through an SSH bastion tunnel
  (commit `243761f`), but has zero callers today and needs real connection credentials in `.env`
  (`AWS_MYSQL_HOST`/`_PORT`/`_USER`/`_PASSWORD`/`_DATABASE`, or `AWS_MYSQL_DATABASE_URL`) before this
  wrapper can be written against real table/column names. Next step once credentials land: run
  `pnpm mysql:inspect --db tss_db` to find the balance/card/transaction/invoice tables, then add
  `cmpDatabaseWrapper.ts` mirroring `dwhCards.ts`'s shape (typed query functions over `awsMysqlQuery`).
- **Direct CMP/EFS clients** (`src/integrations/cmp.ts`/`efs.ts`) — real, dormant, zero callers.
  EFS/CMP requests go through servercrm (`cmpWrapper.ts`/`efsWrapper.ts` above); these direct clients
  stay unused unless servercrm is ever bypassed for a specific flow.

## Adding a new wrapper (the "Custom Wrapper" pattern)

1. One file in `src/wrappers/`, exporting named methods — never a raw path string or a hand-built SQL
   string handed back to the caller.
2. Pick the shape based on whether the target needs cached session/token state:
   - **Stateless/simple REST or SQL** → a plain object of functions (see `serverCrmWrapper.ts`,
     `cmpWrapper.ts`, `efsWrapper.ts`).
   - **Stateful (SOAP session, per-entity child tokens, etc.)** → a class, exported as a singleton
     instance (mirrors servercrm's own `EfsService`/`WexService` pattern — see
     `/Users/jamshid/Projects/Octane/CRM/servercrm/services/efs.js` for the reference shape).
3. Register it in `src/wrappers/index.ts`.
4. If it needs its own auth/token cache, reuse `src/integrations/tokenCache.ts`'s generic
   `createTokenProvider<T>()` rather than hand-rolling a new cache.
5. Keep files under CLAUDE.md's 600-line cap — split by concern (auth vs. reads vs. writes) the way
   servercrm splits `cmpAuth.js` from `cmpClients.js`/`cmpInvoices.js`.
