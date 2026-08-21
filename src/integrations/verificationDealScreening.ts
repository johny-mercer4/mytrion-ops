/**
 * Phase 3's Zoho-side reads — the duplicate scan over the DEAL population, and Citifuel status.
 *
 * WHY THE DEAL POPULATION AND NOT JUST OUR OWN TABLE. `verificationScreeningRepo.matchDuplicates`
 * scans `verification_cases`, and that table is not the applicant history — it is a recent window of
 * it. The Deal poller only ingests the seven application stages, and only from a watermark that
 * defaults to TODAY (`resolveFreshIngestWatermark`: "turning the job on should not manufacture a year
 * of applications"). Measured: 52 cases locally against thousands of application Deals. So an
 * applicant who applied last quarter, or who was refused before reaching underwriting, is invisible to
 * a scan of our own cases. This is the source that sees them.
 *
 * WHAT IT DELIBERATELY DOES NOT MATCH ON:
 *  - **EIN.** Zoho `Deals` has no EIN field — verified against this org's live field metadata (138
 *    fields; the only tax-shaped one is `Business_Type`). EIN duplicates are matchable ONLY against
 *    our own cases, which do hold it. Both scans run; neither is a superset of the other.
 *  - **Phone.** COQL has no `regexp_replace`, and Zoho phone values are formatted as inconsistently
 *    as the ban list's were — the exact-match a COQL `=` gives would mostly miss, and quietly.
 *    Phone duplicates stay with the local scan, which normalises to digits on both sides.
 *
 * ONE QUERY, TWO ANSWERS. The current case's own Deal is fetched in the same statement as the
 * duplicate candidates (`id = own or (…)`) and partitioned here. Citifuel status is a column on that
 * row, so it costs no second COQL call — and every duplicate carries its own Citifuel status too.
 */
import { zohoCrm } from './zohoCrm.js';
import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/errors.js';

/** Zoho ids are numeric strings; refuse anything else so it cannot be smuggled into COQL. */
function isZohoId(value: string): boolean {
  return /^\d{6,}$/.test(value.trim());
}

/** COQL string literal. Doubling the quote is this repo's convention (see `zohoDealMap`, `callHub`). */
function coqlText(value: string): string {
  return `'${value.trim().replace(/'/g, "''")}'`;
}

/** Digits only, and empty when there are none — Zoho's MC column is full of "No assigned number". */
function digits(value: string | null | undefined): string {
  const only = (value ?? '').replace(/\D+/g, '');
  return only === '' || Number(only) === 0 ? '' : only;
}

/**
 * Citifuel status, as a verdict rather than a string comparison.
 *
 * THE VALUE SET IS NOT A PICKLIST. `citifuel_Status` is a TEXT field on both Deals and Leads, and the
 * live values prove it: `Lead Converted`, `no`, `NO`, `yes`, `App Filled`, `active`. The credit
 * platform's own check compared the exact string `Lead Converted`, so the three Deals sitting on
 * `yes` — an existing Citifuel relationship, stated plainly — passed the pre-stop silently.
 *
 * `App Filled` and anything unrecognised resolve to UNKNOWN, not to clear. An operations term this
 * desk has not been taught the meaning of is a question for a human, and Phase 3's whole design is
 * that a check which cannot answer says so instead of passing.
 */
const CITIFUEL_FLAGGED = new Set(['lead converted', 'yes', 'active']);
const CITIFUEL_CLEAR = new Set(['no']);

export type CitifuelVerdict = 'flagged' | 'clear' | 'unknown' | 'absent';

export function citifuelVerdict(raw: string | null | undefined): CitifuelVerdict {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'absent';
  if (CITIFUEL_FLAGGED.has(value)) return 'flagged';
  if (CITIFUEL_CLEAR.has(value)) return 'clear';
  return 'unknown';
}

/** Which identifier a duplicate Deal collided on — "same MC as" beats "duplicate of". */
export type DealDuplicateField = 'email' | 'mc' | 'usdot' | 'name';

export interface DealDuplicate {
  dealId: string;
  dealName: string | null;
  stage: string | null;
  applicationDate: string | null;
  matchedOn: DealDuplicateField;
  /** The duplicate's own Citifuel status, since the query already returned it. */
  citifuelStatus: string | null;
}

export interface DealScreeningNeedles {
  /** The case's own Deal, excluded from the duplicate set and the source of Citifuel status. */
  dealId: string | null;
  email: string | null;
  mc: string | null;
  dot: string | null;
  companyName: string | null;
}

export interface DealScreeningResult {
  /** False when the lookup could not be made. NEVER conflated with "found nothing" — see below. */
  available: boolean;
  error: string | null;
  duplicates: DealDuplicate[];
  citifuel: { status: string | null; verdict: CitifuelVerdict };
  /** True when the row cap was reached, so `duplicates` is a floor rather than the whole answer. */
  truncated: boolean;
}

const DEAL_SCREENING_FIELDS = [
  'id',
  'Deal_Name',
  'Stage',
  'Application_Date',
  'Email',
  'Secondary_Email',
  'MC',
  'DOT1',
  'citifuel_Status',
].join(', ');

/** Enough to prove a pattern; a case colliding with more than this needs a human either way. */
const DEAL_SCREENING_LIMIT = 50;

const UNAVAILABLE = (error: string): DealScreeningResult => ({
  available: false,
  error,
  duplicates: [],
  citifuel: { status: null, verdict: 'absent' },
  truncated: false,
});

/**
 * Duplicate Deals sharing an identifier with this case, plus this case's Citifuel status.
 *
 * NEVER THROWS, for the same reason `matchCreditPlatformBanList` does not: Phase 3 runs three
 * independent probes and one unreachable source must not take the other two down. The caller writes
 * `available` onto the phase findings and the pane renders a failed lookup as a failed lookup.
 *
 * IN-FLIGHT DEALS ARE INCLUDED. There is no Stage filter — the credit platform's equivalent excludes
 * active cases, which is the exact opposite of what Check B is for. Two applications open at once is
 * the interesting case, not the one to hide.
 */
export async function screenDealsForCase(
  needles: DealScreeningNeedles,
): Promise<DealScreeningResult> {
  const ownDealId = needles.dealId && isZohoId(needles.dealId) ? needles.dealId.trim() : null;

  const clauses: string[] = [];
  const email = (needles.email ?? '').trim().toLowerCase();
  if (email !== '') {
    clauses.push(`Email = ${coqlText(email)}`);
    clauses.push(`Secondary_Email = ${coqlText(email)}`);
  }
  const mc = digits(needles.mc);
  if (mc !== '') clauses.push(`MC = ${coqlText(mc)}`);
  const dot = digits(needles.dot);
  // DOT1 is an INTEGER on Deals (`DOT` is a Leads field and 400s here) — compare unquoted.
  if (dot !== '') clauses.push(`DOT1 = ${dot}`);
  const companyName = (needles.companyName ?? '').trim();
  if (companyName !== '') clauses.push(`Deal_Name = ${coqlText(companyName)}`);

  // Nothing to ask, and no own Deal to read Citifuel from: there is no query to make. That is a
  // successful empty answer, not an unavailable one.
  if (clauses.length === 0 && !ownDealId) {
    return { available: true, error: null, duplicates: [], citifuel: { status: null, verdict: 'absent' }, truncated: false };
  }

  const where = ownDealId
    ? clauses.length > 0
      ? `(id = ${coqlText(ownDealId)}) or (${clauses.join(' or ')})`
      : `id = ${coqlText(ownDealId)}`
    : clauses.join(' or ');

  try {
    const { rows, count } = await zohoCrm.runCoql(
      `select ${DEAL_SCREENING_FIELDS} from Deals where ${where}` +
        ` order by Application_Date desc, id desc limit 0, ${DEAL_SCREENING_LIMIT}`,
    );

    const text = (row: Record<string, unknown>, key: string): string | null => {
      const raw = row[key];
      const value = raw == null ? '' : String(raw).trim();
      return value === '' ? null : value;
    };

    let citifuelStatus: string | null = null;
    const duplicates: DealDuplicate[] = [];
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (id === '') continue;
      if (ownDealId && id === ownDealId) {
        citifuelStatus = text(row, 'citifuel_Status');
        continue;
      }
      const matchedOn = matchedField(row, { email, mc, dot, companyName });
      // A row can come back only because it satisfied a clause, so a null here means the projection
      // and the WHERE disagree — log it rather than filing an unattributable duplicate.
      if (!matchedOn) {
        logger.warn({ dealId: id }, 'deal duplicate matched no known needle');
        continue;
      }
      duplicates.push({
        dealId: id,
        dealName: text(row, 'Deal_Name'),
        stage: text(row, 'Stage'),
        applicationDate: text(row, 'Application_Date'),
        matchedOn,
        citifuelStatus: text(row, 'citifuel_Status'),
      });
    }

    return {
      available: true,
      error: null,
      duplicates,
      citifuel: { status: citifuelStatus, verdict: citifuelVerdict(citifuelStatus) },
      truncated: count >= DEAL_SCREENING_LIMIT,
    };
  } catch (err) {
    const message = errorMessage(err);
    logger.warn({ err: message }, 'verification deal screening failed');
    return UNAVAILABLE(message);
  }
}

/** Which needle this row satisfied. Ordered most to least specific, so MC beats a shared name. */
function matchedField(
  row: Record<string, unknown>,
  needles: { email: string; mc: string; dot: string; companyName: string },
): DealDuplicateField | null {
  const value = (key: string): string => String(row[key] ?? '').trim();
  if (needles.mc !== '' && digits(value('MC')) === needles.mc) return 'mc';
  if (needles.dot !== '' && digits(value('DOT1')) === needles.dot) return 'usdot';
  if (
    needles.email !== '' &&
    (value('Email').toLowerCase() === needles.email ||
      value('Secondary_Email').toLowerCase() === needles.email)
  ) {
    return 'email';
  }
  if (needles.companyName !== '' && value('Deal_Name').toLowerCase() === needles.companyName.toLowerCase()) {
    return 'name';
  }
  return null;
}
