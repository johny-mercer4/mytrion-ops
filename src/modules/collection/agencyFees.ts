/**
 * What an agency charges to collect a debt, and therefore what the debtor actually owes.
 *
 * DERIVED FROM PRODUCTION, NOT INVENTED — unlike everything in `DESK_POLICY`. Zoho computes
 * `Agency_Fee` and `Total_Debt_With_Fee` as formula fields, and the CRM API does not expose
 * formula expressions, so the rates below were recovered by fitting them against all 212 live
 * cases that carry a fee (2026-08-20):
 *
 *     Agency_Fee = Total_Debt_Amount × rate        206 of 212 exact, the other 6 explained below
 *     Total_Debt_With_Fee = Total_Debt_Amount + Agency_Fee    338 of 338 exact
 *
 * The base is `total_debt_amount`, not the remaining balance: fitting against remaining matched
 * only 190 of 212, and the with-fee total only reconciled on the debt figure.
 *
 * Caine & Weiner were the six "misses" and they are not misses — they charge 25% under $5,000 and
 * 20% at or above it, with the twelve sub-$5,000 cases and six $5,000+ cases separating cleanly
 * on that line. A volume discount, not noise.
 *
 * GG&R appears in the agency picklist but has never held a case, so there is no rate to fit and
 * `agencyFee` returns null rather than guessing one. A null fee renders as "not known", which is
 * the truth; a guessed one would be quoted to a debtor.
 */
import type { CollectionAgency } from '../../db/schema/collection.js';

/** The line Caine & Weiner drop from 25% to 20% at. Fitted, then confirmed by a clean split. */
export const CAINE_WEINER_VOLUME_FLOOR_USD = 5_000;

const FLAT_RATES: Partial<Record<CollectionAgency, number>> = {
  'Trust Altus': 0.15,
  Dustin: 0.2,
  'IC system': 0.25,
  'Freight Recovery': 0.25,
};

/**
 * The commission rate for this agency on a debt of this size, or null when the agency has never
 * held a case and there is nothing to go on.
 */
export function agencyFeeRate(agency: string | null | undefined, debt: number): number | null {
  if (!agency) return null;
  if (agency === 'Caine & Weiner') {
    return debt >= CAINE_WEINER_VOLUME_FLOOR_USD ? 0.2 : 0.25;
  }
  return FLAT_RATES[agency as CollectionAgency] ?? null;
}

/** The agency's cut, rounded to the cent as Zoho stores it. Null when the rate is unknown. */
export function agencyFee(agency: string | null | undefined, debt: number): number | null {
  const rate = agencyFeeRate(agency, debt);
  if (rate === null) return null;
  return Math.round(debt * rate * 100) / 100;
}

/**
 * What the debtor owes all in — the figure a collector quotes on a call. Falls back to the bare
 * debt when the fee is unknown, so the number is never inflated by a guess.
 */
export function totalDebtWithFee(agency: string | null | undefined, debt: number): number {
  const fee = agencyFee(agency, debt);
  return Math.round((debt + (fee ?? 0)) * 100) / 100;
}
