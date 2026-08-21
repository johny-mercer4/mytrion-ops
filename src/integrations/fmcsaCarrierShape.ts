/**
 * The QCMobile carrier record — its TYPES and the parsing that turns a raw envelope entry into one.
 *
 * Split out of `fmcsaQcMobile.ts` (transport + the DOT/MC/name ladder) because the shape is where the
 * register's traps live, and they are worth reading in one place without the HTTP around them. Every
 * one below is measured against real captured response bodies, not against the official docs — the
 * published element table is stale and disagrees with the API on three field names.
 *
 * THE FOUR THAT MATTER MOST:
 *  - `bipd/bond/cargoInsuranceOnFile` are DOLLAR AMOUNTS IN THOUSANDS, AS STRINGS. "1000" is
 *    $1,000,000 and "0" is none on file. Read as booleans, "0" is truthy and EVERY CARRIER LOOKS
 *    INSURED — which on this desk is a wrong credit answer, not a display bug.
 *  - the paired `*InsuranceRequired` fields use a LOWERCASE "u" for unknown alongside Y/N, so a
 *    `'Y' | 'N'` union fails on real data.
 *  - it is `phyZipcode`, not `phyZip`, and `allowedToOperate`, not `allowToOperate`. The docs and one
 *    published SDK say otherwise; the captured bodies win.
 *  - EVERY field is optional. The docs are explicit that "elements only appear if they have value" and
 *    that some are mutually exclusive, and `dbaName` / `safetyRating` / `issScore` / `snapshotDate` /
 *    `oosDate` all arrived null in real samples.
 *
 * AND FOUR FIELDS ARE DELIBERATELY ABSENT: `operatingStatus`, `telephone`, `mcNumber` and
 * `outOfService` do not exist on `/carriers/{dot}`. `operatingStatus` in particular is a SAFER
 * (HTML) concept, not a QCMobile one — anyone specifying it is reading from the wrong system. The
 * QCMobile equivalents are `statusCode` + `allowedToOperate` + the three `*AuthorityStatus` codes.
 *
 * Extra QCMobile keys (fleet, crashes, OOS rates, census type, …) live on `fields` so the
 * typed verdicts stay small and Data Center can still show the rest of the register row.
 */
import { jsonFields, type JsonValue } from '../lib/jsonFields.js';

export type FmcsaUnavailableReason =
  | 'not_configured'
  | 'blocked'
  | 'auth'
  | 'maintenance'
  | 'transport'
  | 'http';

/**
 * QCMobile's Y/N elements, as a TRI-state: the three `*InsuranceRequired` elements carry a LOWERCASE `u` for
 * unknown beside `Y` and `N` in both captured bodies, so a `'Y' | 'N'` union is wrong against real data — and
 * a boolean is worse, since `u` would have to become one of them.
 */
export type FmcsaFlag = 'yes' | 'no' | 'unknown';

/**
 * `statusCode`, as a verdict. `A` = Active is in every captured body; `I` = Inactive is INFERRED from the
 * MCMIS convention, with no captured body for it, so read 'inactive' as "the register says I" and not as a
 * fact we verified. An `O` value is sometimes claimed and we found NO citation for it, so it is deliberately
 * NOT mapped — anything unrecognised falls to 'unknown', where a human is asked.
 */
export type FmcsaStatusVerdict = 'active' | 'inactive' | 'unknown';

/**
 * The three `*AuthorityStatus` codes, as a verdict. `A` and `N` are the observed values; `I` is plausible
 * from MCMIS and was never seen here, so it lands in 'unknown' rather than being asserted as inactive — `raw`
 * keeps it, and 'unknown' makes the desk ask instead of clearing.
 */
export type FmcsaAuthorityVerdict = 'active' | 'none' | 'unknown';

/** One authority status: the code verbatim, plus the verdict derived from it. */
export interface FmcsaAuthorityLine {
  raw: string | null;
  verdict: FmcsaAuthorityVerdict;
}

/**
 * One insurance line, and THE TRAP THAT MATTERS MOST IN THIS FILE: `bipdInsuranceOnFile` /
 * `bondInsuranceOnFile` / `cargoInsuranceOnFile` are NOT Y/N booleans but DOLLAR AMOUNTS IN THOUSANDS, SERVED
 * AS STRINGS — `"1000"` is $1,000,000 on file, `"0"` is none, and both captured bodies carry `"0"` for bond
 * and cargo. Treated as a boolean, `"0"` is a non-empty string, truthy, so EVERY CARRIER LOOKS INSURED and
 * Phase 4 clears a carrier that has no policy at all.
 */
export interface FmcsaInsuranceLine {
  raw: string | null;
  /** `raw` x 1000, in DOLLARS. Null when the element was absent — never a silent 0. */
  dollars: number | null;
  /** `dollars > 0`. False for `"0"` (required, nothing filed) and false when we do not know. */
  onFile: boolean;
  required: FmcsaFlag;
  /** Only BIPD has a required AMOUNT (`bipdRequiredAmount`, thousands too). Null on the others. */
  requiredDollars: number | null;
}

/**
 * A carrier as QCMobile actually serves it. EVERY DESCRIPTIVE FIELD IS OPTIONAL: the API documents that
 * "Elements only appear if they have value" and that "Some elements are mutually exclusive and may not appear
 * together" (their example: if the operate flag is Y, the out-of-service date has no value), and `dbaName`,
 * `safetyRating` and `oosDate` were all null in real samples. The derived verdicts are the only non-optional
 * members — each total, each encoding absence as 'unknown' rather than as a clear. `dotNumber` and `ein` are
 * NUMBERS on the wire, normalised to strings here.
 *
 * FIELDS THE DOCS PROMISE THAT DO NOT EXIST, and are therefore not declared:
 *  - `phyZip` and `allowToOperate` — what the docs and the npm SDK say; every captured body says `phyZipcode`
 *    and `allowedToOperate`.
 *  - `operatingStatus`, `telephone`, `mcNumber`, `complaintCount`, `outOfService` — absent from the real
 *    `/carriers/:dot` payload entirely. `operatingStatus` is a SAFER (HTML site) concept, not a QCMobile
 *    element; its equivalent here is `statusCode` + `allowedToOperate` + the three `*AuthorityStatus` codes.
 *    A declared field the API never sends is a criterion that never fires.
 */
export interface FmcsaCarrier {
  dotNumber?: string;
  legalName?: string;
  dbaName?: string;
  ein?: string;
  /** The code verbatim, kept because anything outside A/I resolves to 'unknown'. */
  statusCode?: string;
  status: FmcsaStatusVerdict;
  allowedToOperate: FmcsaFlag;
  oosDate?: string;
  authority: Record<'common' | 'contract' | 'broker', FmcsaAuthorityLine>;
  insurance: Record<'bipd' | 'bond' | 'cargo', FmcsaInsuranceLine>;
  carrierOperationCode?: string;
  carrierOperationDesc?: string;
  phyStreet?: string;
  phyCity?: string;
  phyState?: string;
  phyZipcode?: string;
  safetyRating?: string;
  /**
   * Up to 38 significant digits on the wire (`1.15830115830115830115830115830115830116`), so both lose
   * precision the moment `JSON.parse` makes them doubles. Indicative percentages for a human to read: never
   * build a threshold or an equality check on their exactness.
   */
  driverOosRate?: number;
  vehicleOosRate?: number;
  /** Every element QCMobile sent on this carrier, including keys the summary does not name. */
  fields?: Record<string, JsonValue>;
}

/** One row of `/carriers/{dot}/authority`. Optional for the same "elements only appear" reason. */
export interface FmcsaAuthorityRecord {
  applicantId?: number;
  dotNumber?: string;
  /** Digits only; `prefix` ("MC") is the other half of the familiar "MC-138328". */
  docketNumber?: string;
  prefix?: string;
  /**
   * Verbatim, and NO verdict is derived from it: the value set is undocumented and it disagrees with the
   * codes beside it — the captured record has `authority: "N"` while all three `*AuthorityStatus` fields are
   * "A". The three lines below are the answer.
   */
  authority?: string;
  authorizedForProperty: FmcsaFlag;
  authorizedForPassenger: FmcsaFlag;
  authorizedForHouseholdGoods: FmcsaFlag;
  authorizedForBroker: FmcsaFlag;
  common: FmcsaAuthorityLine;
  contract: FmcsaAuthorityLine;
  broker: FmcsaAuthorityLine;
}

export interface FmcsaCarrierLookup {
  /** False when we could not read. NEVER conflated with "the register says no such carrier". */
  available: boolean;
  error: string | null;
  reason: FmcsaUnavailableReason | null;
  /** Which key produced the hit — provenance decides whether a reviewer trusts it. */
  matchedOn: 'dot' | 'mc' | 'name' | null;
  carrier: FmcsaCarrier | null;
  candidates: FmcsaCarrier[];
  candidatesTruncated: boolean;
  /** True only when the API answered cleanly that no such carrier exists. */
  notFound: boolean;
  retrievalDate: string | null;
}

export interface FmcsaAuthorityResult {
  available: boolean;
  error: string | null;
  reason: FmcsaUnavailableReason | null;
  records: FmcsaAuthorityRecord[];
}

// --- Value primitives, shared with the transport.

/** A plain object or null. Arrays excluded — `content` can be either and they mean different things. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  // Narrowing an object of unknown shape for keyed reads; every read below re-checks its own type.
  return value as Record<string, unknown>;
}
/** Trimmed text, or undefined. Numbers are stringified: `dotNumber` and `ein` arrive as numbers. */
export function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
export function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

// --- Parsing.

export function flag(value: unknown): FmcsaFlag {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (raw === 'Y') return 'yes';
  if (raw === 'N') return 'no';
  return 'unknown'; // lowercase 'u', absent, null, or anything new
}
export function statusVerdict(value: unknown): FmcsaStatusVerdict {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (raw === 'A') return 'active';
  if (raw === 'I') return 'inactive';
  return 'unknown';
}
export function authorityLine(value: unknown): FmcsaAuthorityLine {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const verdict: FmcsaAuthorityVerdict = raw === 'A' ? 'active' : raw === 'N' ? 'none' : 'unknown';
  return { raw: str(value) ?? null, verdict };
}
/** The x1000. `"1000"` in, $1,000,000 out. Absent in, null out — not 0. */
export function insuranceDollars(value: unknown): number | null {
  const thousands = num(value);
  return thousands === undefined ? null : thousands * 1000;
}

export function insuranceLine(onFile: unknown, req: unknown, reqAmount: unknown): FmcsaInsuranceLine {
  const dollars = insuranceDollars(onFile);
  return {
    raw: str(onFile) ?? null,
    dollars,
    onFile: dollars !== null && dollars > 0,
    required: flag(req),
    requiredDollars: insuranceDollars(reqAmount),
  };
}

/**
 * Optional-property assembly under `exactOptionalPropertyTypes`: writing `legalName: str(...)` in a literal
 * would force the property to accept `undefined`, defeating the point of "elements only appear if they have
 * value". A key whose value is undefined is never written at all.
 */
function put<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

export function parseCarrier(c: Record<string, unknown>): FmcsaCarrier {
  const operation = asRecord(c.carrierOperation);
  const out: FmcsaCarrier = {
    status: statusVerdict(c.statusCode),
    allowedToOperate: flag(c.allowedToOperate),
    authority: {
      common: authorityLine(c.commonAuthorityStatus),
      contract: authorityLine(c.contractAuthorityStatus),
      broker: authorityLine(c.brokerAuthorityStatus),
    },
    insurance: {
      bipd: insuranceLine(c.bipdInsuranceOnFile, c.bipdInsuranceRequired, c.bipdRequiredAmount),
      bond: insuranceLine(c.bondInsuranceOnFile, c.bondInsuranceRequired, undefined),
      cargo: insuranceLine(c.cargoInsuranceOnFile, c.cargoInsuranceRequired, undefined),
    },
  };
  // Elements whose QCMobile name is identical to ours, and whose value is text.
  const identity = ['dotNumber', 'legalName', 'dbaName', 'ein', 'statusCode', 'oosDate'] as const;
  const details = ['phyStreet', 'phyCity', 'phyState', 'phyZipcode', 'safetyRating'] as const;
  for (const field of [...identity, ...details]) put(out, field, str(c[field]));
  put(out, 'carrierOperationCode', str(operation?.carrierOperationCode));
  put(out, 'carrierOperationDesc', str(operation?.carrierOperationDesc));
  put(out, 'driverOosRate', num(c.driverOosRate));
  put(out, 'vehicleOosRate', num(c.vehicleOosRate));
  put(out, 'fields', jsonFields(c));
  return out;
}
/** Every carrier-bearing envelope wraps the record: `{ _links, carrier }`. */
export function carrierFromEntry(entry: unknown): FmcsaCarrier | null {
  const record = asRecord(entry);
  const carrier = record === null ? null : asRecord(record.carrier);
  return carrier === null ? null : parseCarrier(carrier);
}

export function authorityFromEntry(entry: unknown): FmcsaAuthorityRecord | null {
  const record = asRecord(entry);
  const a = record === null ? null : asRecord(record.carrierAuthority);
  if (a === null) return null;
  const out: FmcsaAuthorityRecord = {
    authorizedForProperty: flag(a.authorizedForProperty),
    authorizedForPassenger: flag(a.authorizedForPassenger),
    authorizedForHouseholdGoods: flag(a.authorizedForHouseholdGoods),
    authorizedForBroker: flag(a.authorizedForBroker),
    common: authorityLine(a.commonAuthorityStatus),
    contract: authorityLine(a.contractAuthorityStatus),
    broker: authorityLine(a.brokerAuthorityStatus),
  };
  // `applicantID`, with that capitalisation — the one element here that breaks camelCase.
  put(out, 'applicantId', num(a.applicantID));
  const verbatim = ['dotNumber', 'docketNumber', 'prefix', 'authority'] as const;
  for (const field of verbatim) put(out, field, str(a[field]));
  return out;
}
