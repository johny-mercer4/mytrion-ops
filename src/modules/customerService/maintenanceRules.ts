/**
 * The two Zoho workflow rules that used to run on the `Maintenance` module, reimplemented here.
 *
 * Zoho workflow rules fire on Zoho RECORDS. Freezing Zoho and moving the data to Postgres therefore
 * dropped the module's automation on the floor — silently, because a rule that never runs raises no
 * error, it just leaves a column empty forever. Both rules were still firing on the Zoho side when
 * this was written (`last_executed_time` 2026-07-30), which is why every imported row already carries
 * the values below and a case created in the Mytrion tab would not have.
 *
 * Recovered read-only from the live org (scripts/inspectMaintenanceAutomation.ts), not reconstructed
 * from field names — see docs/crm-maintenance-module.md for the captured definitions.
 *
 *
 * RULE 1 — "Compensation Prepopulation"  (create_or_edit, repeat: true)
 *
 *   criteria: Completion_Compensation == EMPTY
 *          OR Lead_Compensation == EMPTY
 *          OR Half_Completion_Compensation == EMPTY
 *   actions:  three static field updates — 5 / 10 / 2.5 USD
 *
 *   DELIBERATE DIVERGENCE. Zoho's criteria are OR'd across the three fields while all three actions
 *   fire unconditionally, so in Zoho one empty field resets the OTHER TWO to the defaults — a case
 *   with a hand-set 7.00 completion fee silently reverts to 5.00 the moment anything else is blank.
 *   That is an artifact of expressing three independent defaults as one rule, not an intent anybody
 *   would state out loud, so this applies each default INDEPENDENTLY and only where the value is
 *   actually empty. An override entered in Mytrion sticks. Nothing in the live data relies on the
 *   clobber: all 2,718 imported rows hold exactly 5.00 / 10.00 / 2.50.
 *
 *
 * RULE 2 — "UpdateCompanyForMaintenance"  (create only, no criteria)
 *
 *   Deluge: if the Company lookup is empty, find an Account whose Account_Name equals the case's
 *   Name; if none exists, CREATE that Account (Account_Name = Name, Phone = Phone) and link it.
 *
 *   Note what that means in the end: whether it matched or created, the linked Account's name always
 *   equals the case's `Name`. So the observable outcome is "company name = case name", which is what
 *   is reproduced here.
 *
 *   DELIBERATE DIVERGENCE. It does NOT create anything in Zoho. Writing an Account back would break
 *   the freeze that this whole migration rests on, and Mytrion has a better source for the same
 *   answer: the DWH company dimension, which also yields the carrier id. So: fill `companyName` from
 *   `name`, then try the DWH for a canonical name + carrier id. `companyZohoId` stays null on a
 *   Mytrion-created case by design — there is no Zoho Account to point at.
 */
import type { NewMaintenanceCase } from '../../db/schema/maintenance_cases.js';
import { searchCompanies } from '../../integrations/dwhCompanies.js';

/**
 * The three static values from the Zoho field-update actions, at NUMERIC(14,2) scale so they match
 * what `money()` produces and what the columns store.
 *
 * `BONUS_FULL_USD` / `BONUS_HALF_USD` in integrations/csMaintenance.ts are the SAME two rates seen
 * from the analytics side and import from here, so the payout rate and the per-case default can no
 * longer drift apart.
 */
export const COMPENSATION_DEFAULTS = {
  completionCompensation: '5.00',
  halfCompletionCompensation: '2.50',
  leadCompensation: '10.00',
} as const;

export type CompensationField = keyof typeof COMPENSATION_DEFAULTS;

const COMPENSATION_FIELDS = Object.keys(COMPENSATION_DEFAULTS) as CompensationField[];

/**
 * All three compensations present as strings — what a create returns.
 *
 * `Omit` first, then re-add. A plain `T & Record<…, string>` collapses to `never` the moment a caller's
 * T declares one of these as `null` (`{a: null} & {a: string}` has no inhabitant), which is exactly
 * how a route passing an explicitly-cleared field would be silently un-typeable.
 */
type Filled<T> = Omit<T, CompensationField> & Record<CompensationField, string>;

/** The same, for an edit: a field the patch never mentioned stays absent. */
type Refilled<T> = Omit<T, CompensationField> & Partial<Record<CompensationField, string>>;

/** Empty the way this data is actually empty: absent, null, or a blank string from a cleared input. */
const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Rule 1 on CREATE — every missing compensation gets its default.
 *
 * Returns a new object; the caller's patch is not mutated.
 */
export function withCompensationDefaults<T extends Partial<NewMaintenanceCase>>(
  data: T,
): Filled<T> {
  const out = { ...data } as Filled<T>;
  for (const field of COMPENSATION_FIELDS) {
    if (isEmpty(out[field])) out[field] = COMPENSATION_DEFAULTS[field];
  }
  return out;
}

/**
 * Rule 1 on EDIT — refill only a compensation the edit itself blanked.
 *
 * Zoho's rule re-fires on any edit of a record that has an empty compensation, even one the edit did
 * not touch. Reproducing that exactly would mean reading the row back before every PATCH. It would
 * also be unobservable: the only rows that can carry an empty compensation are rows created before
 * this module existed, and there are none — the import filled all 2,718 and every create from here on
 * goes through `withCompensationDefaults`. So this stays a pure function over the patch.
 */
export function withCompensationRefill<T extends Partial<NewMaintenanceCase>>(
  patch: T,
): Refilled<T> {
  const out = { ...patch } as Refilled<T>;
  for (const field of COMPENSATION_FIELDS) {
    // `in` matters: only a field the patch actually mentions, so an untouched column is left alone
    // rather than being resurrected with a default.
    if (field in out && isEmpty(out[field])) out[field] = COMPENSATION_DEFAULTS[field];
  }
  return out;
}

/**
 * Rule 2 on CREATE — give the case a company, and a carrier id if the DWH knows one.
 *
 * Never throws: a DWH outage must not block creating a case. The company name still lands from
 * `name`, which is the same answer the Zoho rule produced in its create-an-Account branch.
 */
export async function withResolvedCompany<T extends Partial<NewMaintenanceCase>>(
  data: T,
): Promise<T & Partial<Pick<NewMaintenanceCase, 'companyName' | 'carrierId'>>> {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return data;
  // An explicit company from the tab's DWH picker is already canonical — nothing to resolve.
  if (!isEmpty(data.companyName) && !isEmpty(data.carrierId)) return data;

  const out: T & Partial<Pick<NewMaintenanceCase, 'companyName' | 'carrierId'>> = { ...data };
  if (isEmpty(out.companyName)) out.companyName = name;

  const needsCarrier = isEmpty(out.carrierId);
  const needsCanonical = isEmpty(data.companyName);
  if (needsCarrier || needsCanonical) {
    const matches = await searchCompanies(name).catch(() => []);
    // Only an exact, case-insensitive name match may adopt a carrier id. A fuzzy hit would attach a
    // case — and its money — to the wrong carrier, which is far worse than leaving the field blank.
    const exact = matches.find((m) => m.companyName.trim().toLowerCase() === name.toLowerCase());
    if (exact) {
      if (needsCarrier) out.carrierId = exact.carrierId;
      if (needsCanonical) out.companyName = exact.companyName;
    }
  }
  return out;
}
