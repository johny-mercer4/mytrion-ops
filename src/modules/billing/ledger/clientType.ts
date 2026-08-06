/**
 * Ledger client-type resolution — decides which carriers the Billing Ledger covers at all, and
 * whether each is LOC or Prepay.
 *
 * BASE TRUTH is DWH `octane.dim_company.payment_terms`. That is a deliberate choice among four
 * disagreeing sources (a live CMP SYSTEM tag, Zoho `Payment_Type_Billing`, and the
 * `is_wex_funded`/`Credit_Setup` pair are the others): `payment_terms` is what every existing money
 * calculation in this repo already keys on — notably `../prepayLedger.ts`, whose prepay universe is
 * `WHERE payment_terms = 'Prepay'` — so using anything else would make the Ledger disagree with the
 * Prepay tab on day one. The CMP tag is more current but costs one HTTP call per carrier and fails
 * OPEN to "LOC", which would silently mislabel the whole book during a CMP outage.
 *
 * Three normalizations, all from the TZ:
 *   • `Deposit` → Prepay. Matches what servercrm's `agentDwh.js` already does. Measured 2026-08-06:
 *     `Deposit` has ZERO rows in dim_company, so this is currently inert — kept because the value is
 *     live in Zoho's picklist and could start flowing.
 *   • `is_wex_funded` carriers are EXCLUDED entirely (TZ §5.3 — company funds are not involved, so
 *     no Customer Balance and no AR exist for them). Measured: 32 carriers.
 *   • An untyped carrier is OUT of scope, not defaulted. Measured: 5,030 of 8,145 carriers have no
 *     `payment_terms` (mostly inactive). Defaulting them to LOC would invent an 8k-carrier AR book.
 *
 * An `ledger_client_type_overrides` open row beats the DWH — the escape hatch for the untyped tail
 * and for the cases where the four sources disagree.
 *
 * SCD: `dim_company` is a slowly-changing dimension. Every query here collapses it with
 * `distinct on (carrier_id) … order by carrier_id, update_date desc nulls last` — the
 * `../../finance/financeClients.ts` pattern. Without it a carrier fans out across historical rows and
 * every downstream sum multiplies.
 */
import { dwh } from '../../../integrations/dwh.js';
import { ledgerClientTypeRepo } from '../../../repos/ledgerClientTypeRepo.js';
import type { LedgerClientType } from './sections.js';

/** Why a carrier is not in the ledger — surfaced so an exclusion never looks like a data bug. */
export type LedgerScopeExclusion = 'wex-funded' | 'no-type' | 'not-found';

export interface LedgerCarrier {
  carrierId: string;
  companyName: string;
  clientType: LedgerClientType;
  billingCycle: string;
  /** Whether the type came from the DWH or from an agent's override. */
  source: 'dwh' | 'override';
  /** Raw `payment_terms` as stored, for drift display. */
  dwhValue: string;
  isActive: boolean;
}

export interface LedgerCarrierLookup {
  found: boolean;
  carrier?: LedgerCarrier;
  /** Present when `found` is false, or when the carrier exists but is out of scope. */
  reason?: LedgerScopeExclusion;
  /** Raw DWH row values even when out of scope — the manual-entry modal explains itself with these. */
  companyName?: string;
  dwhValue?: string;
  isWexFunded?: boolean;
}

interface DimRow {
  carrier_id: string | number;
  company_name: string | null;
  payment_terms: string | null;
  billing_cycle: string | null;
  /** BOOLEAN in the dim. */
  is_wex_funded: boolean | null;
  /**
   * INTEGER in the dim (0/1) — NOT boolean, unlike its `is_*` siblings `is_wex_funded`,
   * `is_debtor` and `is_loc_suspended`. Verified against information_schema 2026-08-06. A strict
   * `=== true` here silently excluded every typed carrier, so read it through `truthy()`.
   */
  is_active: boolean | number | null;
}

/** Tolerate the dim's mixed boolean/integer flag columns (see `DimRow.is_active`). */
function truthy(v: boolean | number | string | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes';
}

/** The SCD-collapsed dim_company projection every query below builds on. */
const DIM_COMPANY_CTE = `
  select distinct on (carrier_id)
         carrier_id, company_name, payment_terms, billing_cycle, is_wex_funded, is_active
    from octane.dim_company
   where carrier_id is not null
   order by carrier_id, update_date desc nulls last`;

/**
 * Map a raw `payment_terms` value onto a ledger client type. Returns null when the value is absent
 * or unrecognized — the caller decides whether that is an exclusion or an override candidate.
 */
export function normalizeClientType(paymentTerms: string | null | undefined): LedgerClientType | null {
  const v = (paymentTerms ?? '').trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper === 'LOC' || upper === 'LINE OF CREDIT') return 'LOC';
  // 'Deposit' is a prepaid arrangement — folded into Prepay per the TZ + agentDwh precedent.
  if (upper === 'PREPAY' || upper === 'DEPOSIT') return 'Prepay';
  return null;
}

function toCarrier(row: DimRow, override: LedgerClientType | null): LedgerCarrier | null {
  const dwhType = normalizeClientType(row.payment_terms);
  const clientType = override ?? dwhType;
  if (!clientType) return null;
  return {
    carrierId: String(row.carrier_id),
    companyName: row.company_name ?? '',
    clientType,
    billingCycle: row.billing_cycle ?? '',
    source: override ? 'override' : 'dwh',
    dwhValue: (row.payment_terms ?? '').trim(),
    isActive: truthy(row.is_active),
  };
}

export interface ScopeResult {
  carriers: LedgerCarrier[];
  /** Counts of what was left out, so the UI can say "3 WEX-Funded carriers excluded". */
  excluded: { wexFunded: number; noType: number; inactive: number };
}

/**
 * Every carrier in ledger scope. ONE DWH query plus ONE Postgres query for the overrides — never
 * per-carrier. Measured 2026-08-06: 8,145 dim rows in, ~2,847 in scope out.
 */
export async function listLedgerCarriers(
  opts: { clientType?: LedgerClientType | undefined; includeInactive?: boolean | undefined } = {},
): Promise<ScopeResult> {
  const rows = await dwh.query<DimRow>(`with company as (${DIM_COMPANY_CTE}) select * from company`);
  const overrides = await ledgerClientTypeRepo.findOpenBatch(rows.map((r) => String(r.carrier_id)));

  const carriers: LedgerCarrier[] = [];
  const excluded = { wexFunded: 0, noType: 0, inactive: 0 };

  for (const row of rows) {
    if (truthy(row.is_wex_funded)) {
      excluded.wexFunded += 1;
      continue;
    }
    const override = overrides.get(String(row.carrier_id))?.clientType ?? null;
    const carrier = toCarrier(row, override);
    if (!carrier) {
      excluded.noType += 1;
      continue;
    }
    if (!carrier.isActive && !opts.includeInactive) {
      excluded.inactive += 1;
      continue;
    }
    if (opts.clientType && carrier.clientType !== opts.clientType) continue;
    carriers.push(carrier);
  }

  carriers.sort((a, b) => a.companyName.localeCompare(b.companyName));
  return { carriers, excluded };
}

/**
 * Resolve one carrier. Returns the raw DWH values even when out of scope, because this powers the
 * manual opening-balance lookup: "no carrier found for 5762019" and "WEX-Funded carriers are out of
 * scope" are different messages and the agent needs to be told which one applies.
 */
export async function lookupLedgerCarrier(carrierId: string): Promise<LedgerCarrierLookup> {
  const id = String(carrierId).trim();
  if (!id) return { found: false, reason: 'not-found' };

  const rows = await dwh.query<DimRow>(
    `with company as (${DIM_COMPANY_CTE}) select * from company where carrier_id::text = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return { found: false, reason: 'not-found' };

  const base = {
    companyName: row.company_name ?? '',
    dwhValue: (row.payment_terms ?? '').trim(),
    isWexFunded: truthy(row.is_wex_funded),
  };

  if (truthy(row.is_wex_funded)) return { found: false, reason: 'wex-funded', ...base };

  const override = (await ledgerClientTypeRepo.findOpen(id))?.clientType ?? null;
  const carrier = toCarrier(row, override);
  if (!carrier) return { found: false, reason: 'no-type', ...base };

  return { found: true, carrier, ...base };
}

/**
 * Resolve many carriers at once, as a Map. Used by the importer (validating up to 10,000 rows) and
 * by every read that needs to attach a company name to a stored opening balance.
 */
export async function resolveLedgerCarriers(
  carrierIds: readonly string[],
): Promise<Map<string, LedgerCarrier>> {
  const ids = [...new Set(carrierIds.map((c) => String(c).trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await dwh.query<DimRow>(
    `with company as (${DIM_COMPANY_CTE}) select * from company where carrier_id::text = any($1::text[])`,
    [ids],
  );
  const overrides = await ledgerClientTypeRepo.findOpenBatch(ids);

  const out = new Map<string, LedgerCarrier>();
  for (const row of rows) {
    if (truthy(row.is_wex_funded)) continue;
    const override = overrides.get(String(row.carrier_id))?.clientType ?? null;
    const carrier = toCarrier(row, override);
    if (carrier) out.set(carrier.carrierId, carrier);
  }
  return out;
}
