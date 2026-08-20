/**
 * The two FROZEN FMCSA feeds — insurance filings (`qh9u-swkp`) and BOC-3 process agents
 * (`2emp-mxtb`).
 *
 * READ THIS BEFORE TRUSTING ANYTHING THESE RETURN. Both datasets are dead. Their own Socrata metadata
 * says "last refreshed on 05/14/2026 and will no longer be updated", and `max(trans_date)` confirms
 * it. Worse, they LOOK fresh: the row-level `:created_at` reads 2026-08-19 on every one of the
 * 467,983 insurance rows because the table is truncate-and-reloaded wholesale, three months NEWER
 * than the data cutoff. Anything read here is a snapshot that gets staler forever, so every result
 * carries `frozen: true` and `dataAsOf` and the desk labels it on screen.
 *
 * The cost is quantified, not theoretical: 17,969 carriers (4.7%) that read as insured at the cutoff
 * have already passed their scheduled cancellation date, and 48,813 carriers registered after it
 * return `[]` from BOC-3 — indistinguishable from a genuine "no process agent on file". That is a
 * confident false negative on exactly the new applicants Phase 4 sees most. Live insurance status
 * comes from QCMobile; this is corroboration and history.
 */
import {
  dotClause,
  FROZEN,
  isSocrataConfigured,
  isoDay,
  isoFromMmddyyyy,
  normalizeDot,
  READ_FAILED,
  socrataGet,
  text,
  thousandsToDollars,
  unavailable,
  NOT_CONFIGURED,
  badDot,
  type SocrataFrozenProbe,
} from './socrataClient.js';

const INSURANCE_RESOURCE = 'qh9u-swkp';
const BOC3_RESOURCE = '2emp-mxtb';

/**
 * BIPD liability — 392,700 of the 467,983 insurance rows, and the form that decides whether a carrier
 * is legally on the road, so it is the one Phase 4's insurance check reads.
 *
 * EXPORTED BECAUSE THE STORED VALUES CARRY NO `BMC-` PREFIX. A live `$group` returns exactly
 * 91X / 34 / 84 / 91 / 85 / 82 / 83 / 35, so a filter written `BMC-91X` — which is what everyone says
 * out loud, and what the FMCSA form itself is titled — matches nothing and returns HTTP 200 with `[]`.
 * A caller picking the liability filing must compare against this constant, not against a guess.
 */
export const SOCRATA_BIPD_FORM_CODE = '91X';

/**
 * How old the newest filing in a group may be before we refuse to call it "active". A JUDGEMENT, NOT A SOURCE
 * FACT, hence a named export: the table has no expiry column, `cancl_effective_date IS NULL` means only
 * "never formally cancelled", and the history keeps uncancelled filings from insurers that no longer exist
 * (DOT 652739 still carries a 2005 cargo filing with no cancel date). Nothing separates that from live
 * coverage, so past this horizon the honest answer is 'stale', never 'active'.
 */
export const SOCRATA_INSURANCE_STALE_AFTER_YEARS = 5;

/**
 * USDOT / docket status, 100% filled: A 2,230,861 · I 2,255,586 · P 1,124. `P` IS NOT GUESSED — FMCSA does not
 * document it, so the label says so rather than reading "Pending". Same rule as `citifuelVerdict`: a code this
 * desk has not been taught must never resolve to the reassuring branch.
 */
export type SocrataInsuranceStatus = 'active' | 'cancelled' | 'future' | 'stale' | 'superseded';

/**
 * `docketNumber` is NOT a 1:1 key — one DOT maps to up to 4 dockets, so `dot_number` is the primary key.
 * `formCode` is as stored (`91X`, never `BMC-91X`) and `formLabel` comes from `mod_col_1`, NOT derivable from
 * it: 91X alone spans `BIPD/Primary` (386,661), `BIPD/Excess` (5,945), `BIPD/Full (1)` and `(2)`. The money
 * fields are dollars — the stored value x1000 — and null means NOT STATED, which is not $0.
 */
export interface SocrataInsuranceFiling {
  docketNumber: string;
  formCode: string;
  formLabel: string | null;
  insurer: string | null;
  policyNo: string | null;
  transDate: string | null;
  effectiveDate: string;
  canclEffectiveDate: string | null;
  maxCoverageDollars: number | null;
  underlyingLimitDollars: number | null;
  status: SocrataInsuranceStatus;
}

/** `agentName` and the whole address are the AGENT's, never the carrier's. */
export interface SocrataProcessAgent {
  docketNumber: string | null;
  agentName: string | null;
  attnTo: string | null;
  address: Record<'street' | 'city' | 'state' | 'country' | 'zip', string | null>;
}

/** `available: false` means the read did not happen or did not succeed — never "we found nothing". */
export interface SocrataInsuranceResult extends SocrataFrozenProbe { filings: SocrataInsuranceFiling[] }

export interface SocrataProcessAgentResult extends SocrataFrozenProbe { agents: SocrataProcessAgent[] }

const INSURANCE_FIELDS = [
  // `mod_col_1` IS THE FIELD NAME; its DISPLAY name on the dataset page is `ins_type_desc`, which a reader of
  // that page tries first — and `$select=ins_type_desc` is an HTTP 400. `cancl_effective_date` is projected
  // even though 95.3% of rows omit it, so a source-side rename becomes an HTTP 400 rather than "nobody is
  // ever cancelled".
  'docket_number, dot_number, ins_form_code, mod_col_1, name_company, policy_no, trans_date',
  'underl_lim_amount, max_cov_amount, effective_date, cancl_effective_date',
].join(', ');
/** A history table — one carrier can carry decades of filings. 50 newest is more than Phase 4 reads. */
const INSURANCE_LIMIT = 50;

/**
 * Every insurance filing on record for one DOT, newest first, each with its own verdict. FROZEN, so it cannot
 * see the 4.7% whose printed cancellation date has since passed — hence `frozen` and `dataAsOf`.
 *
 * `$order` CASTS, AND THAT IS LOAD-BEARING. `$order=trans_date DESC` sorts by MONTH first because the value is
 * `MM/DD/YYYY` text: a 07/08/1996 filing came back as the "newest", ahead of one from 05/31/2024. Since the
 * current-versus-superseded decision below is "first row per group wins", a text-ordered page silently inverts
 * every answer — and an UNORDERED page is worse, its natural scan order leading with the 46 typo rows. THERE
 * IS NO DATE PREDICATE IN `$where`, on purpose: `future` and `stale` are answers this desk needs, so filtering
 * by date server-side would hide them; if one is ever added it MUST carry `::floating_timestamp`, since a raw
 * text comparison returns 0 rows with HTTP 200.
 */
export async function fetchInsuranceByDot(
  dot: string,
  now: Date = new Date(),
): Promise<SocrataInsuranceResult> {
  const empty = { ...FROZEN, filings: [] };
  if (!isSocrataConfigured()) return unavailable(NOT_CONFIGURED, empty);
  // Every status below is relative to this instant, and `toISOString()` raises RangeError on an
  // invalid Date — which would reject out of a probe that must never throw. Refused before the
  // request, so a bad clock costs nothing on the wire either.
  if (Number.isNaN(now.getTime())) return unavailable('unusable as-of date', empty);
  const normalized = normalizeDot(dot);
  if (normalized === null) return unavailable(badDot(dot), empty);
  const { rows, error } = await socrataGet(
    INSURANCE_RESOURCE,
    {
      $select: INSURANCE_FIELDS,
      $where: dotClause(normalized),
      // Both keys cast. `trans_date` is when the filing was recorded and decides which row is current;
      // `effective_date` breaks ties between same-day transactions so the page is deterministic.
      $order: 'trans_date::floating_timestamp DESC, effective_date::floating_timestamp DESC',
      $limit: String(INSURANCE_LIMIT),
    },
    'socrata insurance lookup by dot failed',
  );
  if (rows === null) return unavailable(error ?? READ_FAILED, empty);

  const today = isoDay(now);
  const staleYear = now.getUTCFullYear() - SOCRATA_INSURANCE_STALE_AFTER_YEARS;
  const staleBefore = isoDay(new Date(Date.UTC(staleYear, now.getUTCMonth(), now.getUTCDate())));
  const seenGroups = new Set<string>();
  const filings: SocrataInsuranceFiling[] = [];
  for (const row of rows) {
    const docketNumber = text(row, 'docket_number');
    const formCode = text(row, 'ins_form_code');
    const effectiveDate = isoFromMmddyyyy(text(row, 'effective_date'));
    // Every status is defined relative to `effective_date`, so an undateable row is dropped, not guessed.
    if (docketNumber === null || formCode === null || effectiveDate === null) continue;
    const canclEffectiveDate = isoFromMmddyyyy(text(row, 'cancl_effective_date'));
    // THE 55 TYPO ROWS: 46 filings have effective_date == cancl_effective_date and 9 are inverted (0.012%
    // together, both measured today) — source-side YEAR typos, e.g. 08/10/2032 keyed into both columns and
    // usually corrected weeks later by a fresh row on the same `policy_no`; DOT 652739 carries one now.
    // Filtering on `effective <= cancel` is what the data supports.
    if (canclEffectiveDate !== null && canclEffectiveDate <= effectiveDate) continue;
    // Newest-first ordering means the first row seen for a group is the current one and the rest are
    // history. Grouping on (docket, form, LAYER), not the DOT: a carrier can hold liability, cargo and
    // surety filings at once across up to 4 dockets, and cargo must not supersede liability.
    //
    // THE LAYER IS PART OF THE KEY BECAUSE `91X` IS NOT ONE THING. `mod_col_1` splits it into
    // BIPD/Primary (386,661 rows), BIPD/Excess (5,945), BIPD/Full (1) and BIPD/Full (2). Keying on
    // (docket, form) alone let a later-filed EXCESS row mark the carrier's live PRIMARY liability
    // filing superseded — and then the surviving row reported the excess limit as the coverage figure.
    // That is a wrong number on a credit decision, not a cosmetic mis-grouping.
    const layer = text(row, 'mod_col_1') ?? '';
    const groupKey = `${docketNumber} ${formCode} ${layer}`;
    const isCurrent = !seenGroups.has(groupKey);
    seenGroups.add(groupKey);
    const filing: SocrataInsuranceFiling = {
      docketNumber,
      formCode,
      effectiveDate,
      canclEffectiveDate,
      status: 'active',
      formLabel: text(row, 'mod_col_1'),
      insurer: text(row, 'name_company'),
      policyNo: text(row, 'policy_no'),
      transDate: isoFromMmddyyyy(text(row, 'trans_date')),
      maxCoverageDollars: thousandsToDollars(row, 'max_cov_amount'),
      underlyingLimitDollars: thousandsToDollars(row, 'underl_lim_amount'),
    };
    filing.status = insuranceStatus(filing, isCurrent, today, staleBefore);
    filings.push(filing);
  }
  return { available: true, error: null, ...FROZEN, filings };
}

/**
 * The verdict for one filing, and A BOOLEAN HERE WOULD BE A LIE: `cancl_effective_date` is NULL on 445,864
 * rows (95.3%) and that does not mean "insured"; when present it is always a FUTURE scheduled cancellation
 * (statutory 30-day notice, modal gap ~365 days), so it does not mean "uninsured" either. The caller decides.
 * The ORDER of the tests is the argument: superseded first, since a newer filing for this (docket, form) makes
 * the rest moot; then future, because effective tomorrow is neither coverage today nor staleness; then
 * cancelled, a cancellation date that has PASSED — the 4.7% the freeze hides, where the row said "scheduled to
 * cancel", the date has since arrived and the dataset never learned; then stale, uncancelled but ancient,
 * because a 1996 filing with no cancel date is NOT active and this table is full of them; only then active.
 */
function insuranceStatus(
  filing: SocrataInsuranceFiling,
  isCurrent: boolean,
  today: string,
  staleBefore: string,
): SocrataInsuranceStatus {
  if (!isCurrent) return 'superseded';
  if (filing.effectiveDate > today) return 'future';
  if (filing.canclEffectiveDate !== null && filing.canclEffectiveDate <= today) return 'cancelled';
  // The filing's own age: the transaction date when we have one, otherwise the effective date.
  return (filing.transDate ?? filing.effectiveDate) < staleBefore ? 'stale' : 'active';
}

const BOC3_FIELDS =
  'docket_number, dot_number, co_name, attn_to_or_title, street_po, city, state_code, ctry_code, zip_code';
/** Measured worst case is 12 filings for one DOT; 50 leaves room without paging. */
const BOC3_LIMIT = 50;

/**
 * The process agents on file for one DOT. MULTI-ROW BY DESIGN: 1,860,604 rows over 1,679,121 distinct DOTs,
 * and one carrier can carry a dozen. WHAT THIS CANNOT TELL YOU, and no parsing will fix: WHICH filing is
 * current. The dataset has NINE columns and not one is a date, verified against the live schema, so rows come
 * back in the order given with no "current" flag — inventing one would be a guess printed as a fact, and
 * `$order` is on the agent name purely so the page is repeatable, NOT recency. FROZEN, at its most misleading
 * here: the 48,813 carriers registered after the cutoff each return an empty list, which is "we cannot know"
 * and not "no process agent on file" — hence `frozen` and `dataAsOf` even on an empty answer.
 */
export async function fetchProcessAgentsByDot(dot: string): Promise<SocrataProcessAgentResult> {
  const empty = { ...FROZEN, agents: [] };
  if (!isSocrataConfigured()) return unavailable(NOT_CONFIGURED, empty);
  const normalized = normalizeDot(dot);
  if (normalized === null) return unavailable(badDot(dot), empty);
  const { rows, error } = await socrataGet(
    BOC3_RESOURCE,
    { $select: BOC3_FIELDS, $where: dotClause(normalized), $order: 'co_name ASC', $limit: String(BOC3_LIMIT) },
    'socrata boc-3 lookup by dot failed',
  );
  if (rows === null) return unavailable(error ?? READ_FAILED, empty);
  return {
    available: true,
    error: null,
    ...FROZEN,
    agents: rows.map((row) => ({
      docketNumber: text(row, 'docket_number'),
      agentName: text(row, 'co_name'),
      attnTo: text(row, 'attn_to_or_title'),
      address: { street: text(row, 'street_po'), city: text(row, 'city'), state: text(row, 'state_code'),
        country: text(row, 'ctry_code'), zip: text(row, 'zip_code') },
    })),
  };
}

