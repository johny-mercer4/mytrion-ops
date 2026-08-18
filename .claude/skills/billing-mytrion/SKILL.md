---
name: billing-mytrion
description: Product facts for Billing Mytrion — live tabs (Data Center, Transactions, Ledger, Debtors, Prepay, Returns), ledger sub-surfaces, CMP vs app Postgres vs DWH, map/unmap writes, debounce, money format. Use when editing billing schema, repos, routes, CRM billing UI, billingTabs, or mytrions billing access. Not Finance Mytrion.
---

# Billing Mytrion

Daily money desk. Department **`billing`**. CRM sends `x-department-access: billing`. Profiles **Billing** and **Standard Plus** (plus admin bypass). Write mode is enforced (`requireMytrionWrite` / `mytrionAccessModes.billing === 'read'` → 403). Layer-2 tab grants are UI-only; the endpoint is the security boundary.

Tables have **no `tenant_id`**. Isolation is `requireDepartment(..., 'billing')`, not tenancy. Payment/ledger tables are global on `carrier_id`.

**Finance is a different Mytrion** (`department: 'finance'`). Do not treat `mytrions/finance/**` as Billing leftovers.

## Writers — do not invert

| Store | Role |
| --- | --- |
| **App Postgres** (`MYTRION_OPS_DATABASE_URL`, local `:5433`) | **The only Billing-writable DB.** `payment_transactions` (row-of-record + mapping columns), `payment_returns`, `payment_carrier_memory`, `ledger_opening_balances` (append-only supersede), `ledger_import_batches`, `ledger_client_type_overrides`, `ledger_daily_snapshots`. |
| **CMP** | Money movement. This repo never talks CMP MySQL / the `:3307` tunnel. Writes go `servercrm` `/api/billing/cmp/*` (invoice-payment, reverse, company-balance). PG stamps mapping only after CMP succeeds. |
| **DWH** (`DWH_DATABASE_URL`) | **Read-only replica.** Ledger feeds, Prepay companies/loads, `octane.dim_company`, fuzzy roster, Data Center / Debtors via servercrm `/api/billing/dwh/*`. **Never migrate. Never `drizzle-kit push`.** |

Ingest (`/billing/ingest/*`) upserts payments/returns and **must not overwrite** PG mapping columns. Identity on desk writes is the verified session, never the client. Every write is audited.

Opening `null` ≠ `0`. Null means “no inception recorded”; zero claims a real zero position. Fabricating 0 buries the migration backlog inside variance.

## Live tabs (`billingTabs.ts` + `Shell.tsx`)

| Tab | Kind | Source | Writes |
| --- | --- | --- | --- |
| **Data Center** (`datacenter`) | Roster of deals | DWH `billing.datacenter.deals`; detail: avg-days (DWH) + CMP invoices (`GET /billing/invoices/search?withPaymentDates=1`) | **None.** Zoho deal-billing edit is gone. |
| **Transactions** | Inbound payments (zelle / chase / mx / stripe) | PG `GET /billing/transactions` + `/stats` + `/search` | map / unmap / top-up / split / sync-crm-only / manual Chase. CMP then PG. |
| **Ledger** | AR book (TZ §5) | Live compute: DWH feeds + PG openings. Snapshot: nightly job. | Openings, client-type override, Excel import, `/recompute`. Mapping stays on Transactions. |
| **Debtors** | Overdue-invoice roll-up | DWH `billing.debtors.list` once; filter/page client-side | **None.** Nested invoices are in the roll-up, not a tab. |
| **Prepay** | Loaded vs payments | `GET /billing/prepay/{companies,rmve,externals,ledger}` (DWH + PG + servercrm) | **None.** |
| **Returns** | ACH returns + Stripe disputes | PG `GET /billing/returns` | `POST .../match` (CMP reverse when needed). |

Default tab: **Data Center**. Panels lazy-mount and stay mounted. `contentScroll="content"` — Ledger / Data Center virtualise (`useWindowedRows`); a second scroll parent corrupts the window.

**Not tabs:** **Statements** = `LedgerStatementModal` on a Ledger row (`GET /billing/ledger/statement`). Running balance is **server-computed**; do not re-sum in the client. **Invoices** = CMP picker (`GET /billing/invoices/search`) in TransactionModal + Data Center detail, plus Debtors nested rows. There is no Invoices / Statements rail item.

## Ledger sub-nav (`ledgerSections.ts`)

Live: `cb-loc` · `unbilled` · `ar` · `cb-prepay` · `untopped` · `controls` · `payments` · `openings`.

Parked: **`transitions`** (`TRANSITIONS_PARKED` — empty table would lie). WEX-funded carriers are **out of the book**.

`Closing = Opening + Debit − Credit`. Chain is shared feed functions, not two queries staying in sync. Period bar is **Apply-gated** (only `applied` is fetched). Default period: last 7 days. Reporting zone **America/Chicago**.

**`endDate` INCLUSIVE** on every `/billing/ledger/*` endpoint (`toWireRange`). Tx list dates are exclusive-ish; `/billing/prepay/ledger` is inclusive (Prepay modal shifts the exclusive list end back one day). Do not “fix” one convention with the other.

`PERIOD_MAX_DAYS` = **400**. Section/statement reads use `billingGetSlow` (**60s**). `/summary` + `/variances` read the nightly snapshot (`billing.ledger.daily-snapshot`, cron `0 5 * * *` Chicago) — not the live compute. `/recompute` queues that job.

## API caps / pagination

| Surface | Server | UI |
| --- | --- | --- |
| Transactions list/search | default **200**, max **2000** | load-next **200** (`BM_TX_PAGE_SIZE`); stats are whole-book |
| Returns fetch | default **200**, max **2000** | loop up to **25×200**, then page **50** |
| Debtors / Prepay | one payload | page **50** client-side |
| Ledger sections / statement / variances / payments | default **100**, max **500** | table / journal **50** |
| Opening balances | default **100**, max **500** | fetch **500** then group by carrier |

KPI / source tiles describe the **whole book**, never the loaded page.

## Debounce / money

- Search: `BM_SEARCH_DEBOUNCE_MS` = **200** (`transactionModel.ts`).
- Mapping burst → **one** `fetchTransactionStats` after **500ms** (`Transactions.debounce.test.tsx`). Do not reload stats per map.
- `fmtCurrency` (`data.ts`): `$` + 2dp, unsigned. Transactions / Debtors / Prepay / Returns.
- `fmtMoney` (`ledgerModel.ts`): signed, `—` for null/undefined, **not** for zero.

`.bm-root` is a **token scope**. Dropping it unsets ~7k `.bm-root .bm-*` rules. Do not restyle `MytrionShell` sidebar/header.

## Map

| Layer | Path |
| --- | --- |
| Schema | `src/db/schema/payment_*.ts`, `ledger_*.ts` |
| Repos | `paymentTransactionRepo`, `paymentReturnRepo`, `carrierMemoryRepo`, `ledgerOpeningBalanceRepo`, `ledgerClientTypeRepo`, `ledgerImportBatchRepo`, `ledgerSnapshotRepo` |
| Routes | `src/routes/v1/billing.routes.ts`, `billingLedger.routes.ts`, `billingLedgerSections.routes.ts`, `billingLedgerImport.routes.ts` |
| CMP / DWH | `src/modules/billing/cmpWrites.ts`, `cmpReads.ts`, `ledger/feeds.ts`, `prepayLedger.ts` |
| CRM API | `apps/mytrion-crm/src/api/billing.ts`, `ledgerTypes.ts` |
| UI | `apps/mytrion-crm/src/mytrions/billing/**` · tabs `billingTabs.ts` |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` (`department: 'billing'`) |

Ingest (`paymentsIngest.routes.ts`) and money-code routes (`department: 'billing'`) are **not** Billing tabs. Money codes are mini-app / support.

## Do not document as current

- **Tickets** — `TICKETS_PARKED` in `Shell.tsx` (`soon: true` in `billingTabs.ts`). Sales files Desk again.
- **Ledger transitions** — parked; no change-log yet.
- **BillingCopilot** — file + CSS exist; **not mounted**. ONBOARDING listing it as a live surface is stale.
- **`index.tsx` “Prepay / Returns are Soon stubs”** — stale. Both are live read (Returns also writes match).
- **Finance `finance/redesign/`** — gone. Current `mytrions/finance/**` is **Finance Mytrion** (Home + Clients), restricted (Administrator or username contains Azimov / Mirjalol). Overlapping words (debtors, invoices, EFS) ≠ the same desk.

## Keep in sync

If you change Billing **schema, routes, tabs, ledger sections, parked flags, or API caps**, update this skill in the **same PR** (mirrors: `.claude/skills/billing-mytrion/`, `.cursor/skills/billing-mytrion/`, `.agents/skills/billing-mytrion/`). `.agents/` is gitignored; `git add -f` the skill like the Zoho mirrors.
