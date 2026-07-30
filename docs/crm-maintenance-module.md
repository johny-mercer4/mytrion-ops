# Zoho CRM `Maintenance` module — field reference

Discovered **2026-07-30** with `pnpm tsx scripts/inspectMaintenanceModule.ts` (re-run that script
after any Zoho field change). Backs the `maintenance_cases` Postgres table and the CS Mytrion
Maintenance tab.

**35 fields · 2,714 records · all created 2025–2026** (1,093 in 2025, 1,621 in 2026, nothing
before). No active blueprint on `Status`, so a plain field update is sufficient.

## Promoted columns vs. `raw`

Every field below is either a `maintenance_cases` column or deliberately left only inside the
`raw` jsonb snapshot. The rule: promote anything a card renders, a filter/sort touches, or the
form writes.

| Zoho api_name | data_type | → column | notes |
| --- | --- | --- | --- |
| `id` | bigint (read-only) | `zoho_record_id` | natural key of the migration; null for Mytrion-created rows |
| `Name` | text, **mandatory** | `name` | labelled "Company Name" — free-text company, the module's display name |
| `Company` | lookup → **Accounts** | `company_zoho_id` + `company_name` | the linked Account; can differ in casing from `Name` |
| `Carrier_ID` | text | `carrier_id` | **capital `ID`** — Zelle/Chase use `Carrier_Id` |
| `Unit_Number` | text | `unit_number` | values look like `012` — leading zeros matter, so TEXT not int |
| `Status` | picklist | `status` | `Completed` \| `In Process` \| `Cancelled` |
| `Case_Type` | picklist | `case_type` | 9 values, below |
| `Date` | date | `case_date` | renamed: `date` is a poor column name and `Date` is a COQL-touchy identifier |
| `Case_Completion` | date | `case_completion` | labelled "Completion Date" — the sign-off that makes a case *fully* complete |
| `Driver_Name` | text | `driver_name` | |
| `Phone` | phone | `phone` | |
| `Shop_Number` | text | `shop_number` | e.g. `Loves #388` |
| `Parts` | text | `parts` | free text, e.g. `A/C EVAC & RECHARGE` |
| `Work_Order_ID` | text | `work_order_id` | |
| `Reference_Number` | integer | `reference_number` | stored TEXT — it is an identifier, never arithmetic |
| `Payment_Method` | picklist | `payment_method` | 5 values, below |
| `Payment_Status` | picklist | `payment_status` | 5 values, below |
| `Invoiced` | boolean | `invoiced` | |
| `Card_Digits` | integer | `card_digits` | stored TEXT to preserve leading zeros |
| `Total_Amount` | currency | `total_amount` | `numeric(14,2)` |
| `Completion_Compensation` | currency | `completion_compensation` | set on nearly every row — does **not** discriminate completion |
| `Half_Completion_Compensation` | currency | `half_completion_compensation` | |
| `Lead_Compensation` | currency | `lead_compensation` | |
| `Owner` | ownerlookup | `owner_zoho_user_id` + `owner_name` | **COQL returns `name` as the LAST NAME ONLY** — resolved through the user directory |
| `Bonus_for_Completion` | userlookup | `bonus_completion_user_id` + `bonus_completion_name` | |
| `Bonus_for_Lead` | userlookup | `bonus_lead_user_id` + `bonus_lead_name` | |
| `Created_Time` | datetime | `created_time` | Zoho's stamp, preserved separately from our `created_at` |
| `Modified_Time` | datetime | `modified_time` | |

**`raw` only** — no column, no COQL select: `Tag`, `Record_Status__s`, `Unsubscribed_Mode`,
`Unsubscribed_Time`, `Last_Activity_Time` (marketing/system noise).

**Must be excluded from any COQL SELECT list or the whole query 400s:** `Used_Products`
(subform, labelled "Extra Info") and `Bonus_Calc` (subform).

**Absent from this module:** `Created_By` and `Modified_By` are not in the field metadata and do
not appear on a fetched record — do not select them. Provenance comes from `Owner` +
`Created_Time`, and from our own `created_by_user_id` for rows written in Mytrion.

## Picklist values

- **`Status`** — `Completed` · `In Process` · `Cancelled`
- **`Case_Type`** — `Mechanical` · `PMs` · `Tire Replacement` · `DOT Inspection` ·
  `PMs / Mechanical` · `PMs / Tire Repairs` · `PMs and CARB` · `Tire / Mechanical` · `Tire Repairs`
- **`Payment_Method`** — `LOC` · `Prepay / Card` · `Prepay / Zelle` · `Prepay / EFS` · `Selfpay`
- **`Payment_Status`** — `Paid` · `Pending` · `N/A` · `Not Paid` · `Delay`

Only `Prepay / EFS` is counted by servercrm's prepay ledger
(`services/prepayLedger.js` `MAINT_PAYMENT_METHODS`) — the other four methods never touch the
EFS balance.

## Value shapes (from a live record)

```json
{
  "id": "9000000000000000010",
  "Name": "Acme Hauling Llc",
  "Company": { "name": "ACME HAULING LLC", "id": "9000000000000000020" },
  "Carrier_ID": "5000001",
  "Unit_Number": "012",
  "Status": "In Process",
  "Case_Type": "Mechanical",
  "Date": "2026-07-29",
  "Case_Completion": "2026-07-29",
  "Total_Amount": 500.0,
  "Completion_Compensation": 5,
  "Half_Completion_Compensation": 2.5,
  "Lead_Compensation": 10,
  "Reference_Number": 7000001,
  "Invoiced": false,
  "Card_Digits": null,
  "Owner": { "name": "Dana Example", "id": "9000000000000000002", "email": "…" },
  "Created_Time": "2026-07-29T09:39:37-04:00"
}
```

- **Currency arrives as a plain JS number** (`500.0`, `2.5`), not a formatted string. The mapper
  still tolerates `"1,234.50"` in case a multicurrency setting changes that.
- **Dates are bare `YYYY-MM-DD`**; datetimes carry an offset (`-04:00`), so parse them as instants.
- A **full record fetch** (`getRecord`) resolves `Owner.name` to the full name; **COQL does not** —
  it returns `"Example"`, `"Chen"`. Verified against the directory:
  `Example → Dana Example`, `Chen → Robin Chen`. That is why the mapper resolves owner
  ids through `zohoCrm.listActiveUsers()` (same fix as `src/integrations/csMaintenance.ts`).

## COQL notes for this module

- A `WHERE` clause is **mandatory**; `where id is not null` is the match-all idiom. A bare
  `SELECT COUNT(id) FROM Maintenance` is a `SYNTAX_ERROR` — that is why the CS Home maintenance
  tile once read 0.
- `AND` is **binary**: nest conditions pairwise or the query 400s "near where".
- `Date` parses fine in a `POST /coql` body for this org (`SELECT`, `GROUP BY`, `ORDER BY`, and
  range comparisons all work — see `src/integrations/csMaintenance.ts`). servercrm's
  `services/prepayLedger.js` filters it client-side calling it a reserved word; that is defensive
  folklore, not a live constraint here.
- At 2,714 rows the whole module drains in 3 pages of 1,000. No `Created_Time` windowing needed
  (the `MAX_COQL_OFFSET` = 100k ceiling is nowhere near) and no trigram indexes needed in Postgres.
