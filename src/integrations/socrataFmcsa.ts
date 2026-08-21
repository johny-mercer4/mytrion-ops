/**
 * FMCSA Company Census File (`az4n-8mr2`) — the LIVE authority source, and the reason Phase 4 is
 * developable at all.
 *
 * QCMobile is the register of record, but every fmcsa.dot.gov host returns a blanket 403 to non-US
 * egress, so it only answers from the US Render instance. This dataset is third-party Socrata SaaS
 * rather than DOT infrastructure, so it answers from anywhere — and it carries most of what Phase 4
 * asks. Measured fill rates over its 4,487,571 rows (one row per DOT, a true unique key):
 *
 *   status_code        100%     A / I / P            -> USDOT status
 *   add_date           100%     'YYYYMMDD'           -> authority age
 *   power_units        99.99%                        -> fleet against the cards requested
 *   carrier_operation  95.9%    A / B / C            -> interstate vs intrastate
 *   docket1..3         39.8%    prefix + number + A/I/P status  -> the MC number AND its status
 *   legal_name         99.998%  ;  dba_name 26.9%  ;  safety_rating only 5.3%
 *
 * The docket columns matter disproportionately: `stg_broker_snapshot` carries no MC column at all, so
 * this is the only MC status we can read without QCMobile. And a carrier with NO docket is a carrier
 * with no MC authority — itself a Phase 4 finding, not a gap.
 *
 * NOT a substitute for QCMobile on INSURANCE: this file has no insurance columns, and the Socrata
 * insurance feed is frozen (see socrataFmcsaFilings.ts). Insurance status needs the register.
 */
import { logger } from '../lib/logger.js';
import { jsonFields, type JsonValue } from '../lib/jsonFields.js';
import {
  dotClause,
  integer,
  isSocrataConfigured,
  isoFromYyyymmdd,
  label,
  normalizeDot,
  READ_FAILED,
  socrataGet,
  text,
  unavailable,
  NOT_CONFIGURED,
  badDot,
  type SocrataProbe,
} from './socrataClient.js';

const CENSUS_RESOURCE = 'az4n-8mr2';

const STATUS_LABELS: Record<string, string> = {
  A: 'Active',
  I: 'Inactive',
  P: 'Other (code P — undocumented by FMCSA)',
};
/**
 * `carrier_operation`, 95.9% filled: A 2,466,274 · C 1,776,716 · B 58,466. A and C are documented; B is
 * INFERRED from those two plus the hazmat indicator, so its label carries the caveat.
 */
const CARRIER_OPERATION_LABELS: Record<string, string> = {
  A: 'Interstate',
  B: 'Intrastate hazmat (inferred)',
  C: 'Intrastate non-hazmat',
};

/** `prefix` is MC (462,695 insurance rows) / FF (4,886) / MX (402); `number` is text padded to 6, 7 above 999999. */
export interface SocrataCensusDocket {
  prefix: string;
  number: string;
  statusCode: string | null;
  statusLabel: string | null;
}

/**
 * `dotNumber` stays the string Socrata sent (see `text()`); `addDate` is ISO from the stored `YYYYMMDD` text
 * and carries authority age; `safetyRating` is S/C/U, on only 5.3% of carriers; an EMPTY `dockets` IS A
 * FINDING — a carrier with no docket has no MC authority, and only 39.8% of census rows carry one.
 */
export interface SocrataCensusRecord {
  dotNumber: string;
  legalName: string | null;
  dbaName: string | null;
  statusCode: 'A' | 'I' | 'P' | null;
  statusLabel: string | null;
  carrierOperation: 'A' | 'B' | 'C' | null;
  carrierOperationLabel: string | null;
  powerUnits: number | null;
  totalDrivers: number | null;
  addDate: string | null;
  safetyRating: string | null;
  dockets: SocrataCensusDocket[];
  address: Record<'street' | 'city' | 'state' | 'zip', string | null>;
  phone: string | null;
  /** Every census column Socrata sent, including keys the summary does not name. */
  fields?: Record<string, JsonValue>;
}

/** Per-filing verdict instead of one boolean. The five values are argued for on `insuranceStatus`. */
export interface SocrataCensusResult extends SocrataProbe { record: SocrataCensusRecord | null }

export interface SocrataCensusSearchResult extends SocrataProbe {
  records: SocrataCensusRecord[];
  truncated: boolean;
}

/** Default name-search page, its ceiling, and the shortest needle worth sending (two match ~6 figures). */
const CENSUS_NAME_LIMIT = 25;
const CENSUS_NAME_LIMIT_MAX = 100;
const CENSUS_NAME_MIN_LENGTH = 3;

function parseDockets(row: unknown): SocrataCensusDocket[] {
  const dockets: SocrataCensusDocket[] = [];
  // A slot counts only when BOTH prefix and number are present. Null columns are omitted from the JSON, so an
  // absent slot must yield nothing rather than a half-row with a blank docket number.
  for (const slot of ['1', '2', '3']) {
    const prefix = text(row, `docket${slot}prefix`);
    const number = text(row, `docket${slot}`);
    if (prefix === null || number === null) continue;
    const statusCode = text(row, `docket${slot}_status_code`);
    dockets.push({ prefix, number, statusCode, statusLabel: label(STATUS_LABELS, statusCode) });
  }
  return dockets;
}

function parseCensusRow(row: unknown): SocrataCensusRecord | null {
  const dotNumber = text(row, 'dot_number');
  if (dotNumber === null) return null;
  const status = text(row, 'status_code');
  const statusCode = status === 'A' || status === 'I' || status === 'P' ? status : null;
  const op = text(row, 'carrier_operation');
  const carrierOperation = op === 'A' || op === 'B' || op === 'C' ? op : null;
  const record: SocrataCensusRecord = {
    dotNumber,
    statusCode,
    carrierOperation,
    legalName: text(row, 'legal_name'),
    dbaName: text(row, 'dba_name'),
    statusLabel: label(STATUS_LABELS, statusCode),
    carrierOperationLabel: label(CARRIER_OPERATION_LABELS, carrierOperation),
    powerUnits: integer(row, 'power_units'),
    totalDrivers: integer(row, 'total_drivers'),
    addDate: isoFromYyyymmdd(text(row, 'add_date')),
    safetyRating: text(row, 'safety_rating'),
    dockets: parseDockets(row),
    phone: text(row, 'phone'),
    address: { street: text(row, 'phy_street'), city: text(row, 'phy_city'),
      state: text(row, 'phy_state'), zip: text(row, 'phy_zip') },
  };
  const fields = jsonFields(row);
  if (fields !== undefined) record.fields = fields;
  return record;
}

/**
 * The census row for one DOT — status, authority age, fleet, MC number and MC status. `$limit=2` on a unique
 * key is deliberate: `dot_number` is one row per DOT (4,487,571 rows over 4,487,571 distinct values), so
 * asking for two makes a broken assumption a log line instead of an arbitrary silent pick. No `$order`,
 * because there is no page to order.
 */
export async function fetchCensusByDot(dot: string): Promise<SocrataCensusResult> {
  if (!isSocrataConfigured()) return unavailable(NOT_CONFIGURED, { record: null });
  const normalized = normalizeDot(dot);
  if (normalized === null) return unavailable(badDot(dot), { record: null });
  const { rows, error } = await socrataGet(
    CENSUS_RESOURCE,
    // No `$select`: the typed summary is a subset. Data Center needs every census column
    // (email, officers, MCS-150, cargo flags, mailing address, …) that Socrata has for the DOT.
    { $where: dotClause(normalized), $limit: '2' },
    'socrata census lookup by dot failed',
  );
  if (rows === null) return unavailable(error ?? READ_FAILED, { record: null });
  if (rows.length > 1) {
    logger.warn({ dot: normalized, rows: rows.length }, 'socrata census returned >1 row for a dot');
  }
  // `[]` with HTTP 200 is a real answer: no such DOT in the census. Available, record null.
  if (rows.length === 0) return { available: true, error: null, record: null };
  const record = parseCensusRow(rows[0]);
  // A ROW WE COULD NOT PARSE IS NOT AN ABSENT CARRIER. `parseCensusRow` returns null when
  // `dot_number` is not a JSON string — and it is a declared *number* column, so a Socrata type
  // change would flip every lookup to "not in the census" silently. Unavailable is the only safe
  // direction: it can never be mistaken for a clear.
  if (record === null) {
    return unavailable('socrata census row could not be read', { record: null });
  }
  return { available: true, error: null, record };
}

/**
 * Census rows whose legal name contains `name`, via `upper(legal_name) like upper(…)`, ALWAYS: SoQL `like` is
 * CASE-SENSITIVE and census data is stored uppercase, so `legal_name like '%swift trans%'` returns 0 rows
 * while the `upper()` form returns 116 — both measured today, and the lower-case spelling is the kind of query
 * that looks like it ran. A `%` typed by the caller stays a wildcard; a `'` is doubled so it cannot end the
 * literal.
 */
export async function searchCensusByName(
  name: string,
  limit: number = CENSUS_NAME_LIMIT,
): Promise<SocrataCensusSearchResult> {
  const empty = { records: [], truncated: false };
  if (!isSocrataConfigured()) return unavailable(NOT_CONFIGURED, empty);
  const needle = name.trim();
  if (needle.length < CENSUS_NAME_MIN_LENGTH) {
    // NOT a successful empty answer — we declined to ask, and the caller must hear "no lookup".
    return unavailable(`name needle must be at least ${CENSUS_NAME_MIN_LENGTH} characters`, empty);
  }
  // `Math.trunc(NaN)` is NaN and every clamp propagates it, so a non-finite limit emitted `$limit=NaN`
  // and turned a recoverable input into an HTTP 400. Reachable from any handler doing `Number(query.limit)`.
  const requested = Number.isFinite(limit) ? Math.trunc(limit) : CENSUS_NAME_LIMIT;
  const capped = Math.min(Math.max(requested, 1), CENSUS_NAME_LIMIT_MAX);
  const { rows, error } = await socrataGet(
    CENSUS_RESOURCE,
    {
      $where: `upper(legal_name) like upper('%${needle.replace(/'/g, "''")}%')`,
      // Unordered pages are not stable between requests, so the same search can disagree with itself.
      $order: 'legal_name ASC',
      $limit: String(capped),
    },
    'socrata census name search failed',
  );
  if (rows === null) return unavailable(error ?? READ_FAILED, empty);
  const records: SocrataCensusRecord[] = [];
  for (const row of rows) {
    const parsed = parseCensusRow(row);
    if (parsed !== null) records.push(parsed);
  }
  return { available: true, error: null, records, truncated: rows.length >= capped };
}
