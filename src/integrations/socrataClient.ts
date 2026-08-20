/**
 * Socrata transport for the FMCSA open-data feeds — the shared half of Phase 4's authority lookups.
 *
 * WHY THIS IS ITS OWN FILE. Three FMCSA datasets are read here and ONE OF THEM IS ALIVE. The Company
 * Census file is refreshed to within days; the insurance and BOC-3 feeds are frozen at
 * {@link SOCRATA_FROZEN_AS_OF} and will never update again — their own metadata says so. That
 * distinction decides whether an answer may be trusted, so it is structural: `socrataFmcsa.ts` holds
 * the live census, `socrataFmcsaFilings.ts` holds the frozen feeds, and neither can borrow the
 * other's freshness by accident. What they share is this transport.
 *
 * READ-ONLY, ANONYMOUS, AND FREE. No account is required and there is no metering: 4,799 of 4,800
 * anonymous requests came back 200 with zero 429s when this was measured. `SOCRATA_APP_TOKEN` is
 * optional and empty in this deployment — and the header is OMITTED entirely when blank, because an
 * absent token means anonymous access while a WRONG one is a hard 403.
 *
 * NEVER THROWS. Every probe built on this returns `{ available, error, ... }`, with `available: false`
 * meaning "could not read" and never conflated with a successful empty result. Socrata makes that
 * distinction cleanly for us: an unknown DOT is `[]` with HTTP 200, while a broken query is HTTP 400
 * with an `errorCode` body.
 *
 * THERE IS NO 429 AND NO Retry-After. Backpressure is connection-level tarpitting instead — at
 * 120-way concurrency throughput fell from 68 to 10.5 req/s and one request died with no HTTP status
 * at all. So a retry loop waiting for a rate-limit status would spin forever: `runQueued` caps our own
 * concurrency and a transport failure IS the throttle signal.
 */
import { env } from '../config/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/errors.js';
/**
 * The day both the insurance and BOC-3 feeds stopped being updated, per their own Socrata metadata.
 * Every result from those two carries it, because a snapshot that gets staler forever must never be
 * rendered without its date.
 */
export const SOCRATA_FROZEN_AS_OF = '2026-05-14';

export interface SocrataProbe { available: boolean; error: string | null }
/** `frozen` is in the TYPE so a caller cannot render these two sources without the freeze date. */
export interface SocrataFrozenProbe extends SocrataProbe { frozen: true; dataAsOf: string }
export function isSocrataConfigured(): boolean {
  return Boolean(env.SOCRATA_BASE_URL);
}
export const FROZEN = { frozen: true as const, dataAsOf: SOCRATA_FROZEN_AS_OF };
export const NOT_CONFIGURED = 'SOCRATA_BASE_URL is not configured';
export const READ_FAILED = 'socrata read failed';
export const badDot = (dot: string): string => `unusable USDOT number ${JSON.stringify(dot)}`;

/** The unavailable answer, carrying whatever empty payload that probe's shape requires. */
export function unavailable<T extends object>(error: string, empty: T): { available: false; error: string } & T {
  return { available: false, error, ...empty };
}
export function label(map: Record<string, string>, code: string | null): string | null {
  return code === null ? null : (map[code] ?? null);
}

/**
 * ONE SOCRATA REQUEST AT A TIME, PROCESS-WIDE. There is NO HTTP 429 here and no `Retry-After` / `X-RateLimit`
 * header — measured. Backpressure is connection-level tarpitting: at 120-way concurrency throughput collapsed
 * from 68 to 10.5 req/s and one request died with no status at all. So the reflexive "retry on 429" never
 * fires and would not help; the only lever is not to pile on, and Phase 4's three lookups per case queue HERE
 * rather than at a call site that would forget. A transport failure IS the throttle signal, reported and never
 * retried — there is no retry helper in `src/lib` and this must not grow one. `fetchWithTimeout` bounds each
 * request, so a hung call cannot wedge the queue.
 */
let socrataQueue: Promise<void> = Promise.resolve();
function runQueued<T>(run: () => Promise<T>): Promise<T> {
  const started = socrataQueue.then(run);
  socrataQueue = started.then(() => undefined, () => undefined);
  return started;
}

/**
 * A 400 body reduced to something a reviewer can act on. TWO shapes exist, both measured: a SoQL fault is
 * `{ message, errorCode: 'query.soql.no-such-function', … }`, a rejected query param is
 * `{ error: true, message: 'Unrecognized arguments [nonce]' }` with no `errorCode` at all.
 */
function socrataErrorText(body: string): string {
  let obj: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) obj = parsed as Record<string, unknown>;
  } catch {
    // Not JSON. `obj` stays empty and the raw body is quoted below.
  }
  const code = typeof obj.errorCode === 'string' ? obj.errorCode : '';
  const message = typeof obj.message === 'string' ? obj.message.slice(0, 200) : '';
  return [code, message].filter(Boolean).join(': ') || body.slice(0, 200);
}

/**
 * GET one resource. `rows: null` exactly when the read FAILED, never on an empty answer. ONLY `$`-PREFIXED
 * PARAMS MAY BE PASSED: Socrata rejects any unknown query argument with HTTP 400 "Unrecognized arguments [x]",
 * so no cache-busting nonce and no tracing param. `encodeURIComponent`, not `URLSearchParams`, because the
 * latter encodes a space as `+` and inside a `$where` a bare `+` is the addition operator.
 */
export async function socrataGet(
  resource: string,
  params: Record<string, string>,
  whatFailed: string,
): Promise<{ rows: unknown[] | null; error: string | null }> {
  return runQueued(async () => {
    try {
      // BUILT INSIDE THE TRY, deliberately. `encodeURIComponent` raises URIError on a lone UTF-16
      // surrogate, and a SoQL value here can be a carrier name straight out of a free-text column —
      // so building the URL outside this block made a malformed byte reject out of a function
      // documented as never throwing. There is nothing to gain from hoisting it.
      const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      const url = `${env.SOCRATA_BASE_URL.replace(/\/+$/, '')}/resource/${resource}.json?${query}`;
      // The token header is OMITTED ENTIRELY when blank: an absent token means anonymous access, which works
      // and is what this deployment runs on, whereas an empty or wrong one is a hard HTTP 403
      // `permission_denied` — so sending `X-App-Token: ''` would break every call outright.
      const token = env.SOCRATA_APP_TOKEN;
      const headers = { Accept: 'application/json', ...(token ? { 'X-App-Token': token } : {}) };
      const res = await fetchWithTimeout(url, { headers }, env.OUTBOUND_HTTP_TIMEOUT_MS);
      const body = await res.text();
      // Non-2xx, a non-JSON body and a non-array body all land in the one catch below, so there is exactly one
      // failure log per lookup however it broke.
      if (!res.ok) throw new Error(`socrata HTTP ${res.status} ${socrataErrorText(body)}`);
      const parsed: unknown = JSON.parse(body);
      if (!Array.isArray(parsed)) throw new Error('socrata returned a non-array body');
      return { rows: parsed, error: null };
    } catch (err) {
      // The URL is deliberately not logged: unlike QCMobile's `webKey` — a query param on every call — the
      // Socrata token is a header, and nothing else in the URL is worth a log line.
      const message = errorMessage(err);
      logger.warn({ err: message }, whatFailed);
      return { rows: null, error: message };
    }
  });
}

/**
 * One column, or null. TWO MEASURED FACTS ARE BAKED IN, and both bite a naive deserializer. (1) A NULL COLUMN
 * IS OMITTED FROM THE JSON ENTIRELY — not sent as `null` — so `row.x === null` is never true, it is
 * `undefined`, and a strict parse fails on most rows (`dba_name` is present on 26.9%). (2) EVERY VALUE IS A
 * JSON STRING, including census `dot_number` and `power_units`, though `dot_number` is a declared number column.
 */
export function text(row: unknown, key: string): string | null {
  if (typeof row !== 'object' || row === null) return null;
  // Safe after the guard above; `object` cannot be string-indexed without it.
  const raw = (row as Record<string, unknown>)[key];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}
export function integer(row: unknown, key: string): number | null {
  const raw = text(row, key);
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * MONEY IS IN THOUSANDS, AS TEXT: `'750'` is the $750,000 FMCSA general-freight minimum, `'1000'` is $1M,
 * `'5000'` is $5M — the raw value understates coverage 1000x. AND `'0'` BECOMES NULL ("not stated") rather
 * than $0, because zero here is a structural placeholder: 75,281 rows carry it, including 100% of forms 34,
 * 84, 91, 85, 82 and 83. Form 91 is a valid liability filing and all 5,414 of its rows say 0, so a
 * coverage-minimum check reading that as "no coverage" would decline carriers over a column that never held a
 * figure. Null forces the caller to say "unknown".
 */
export function thousandsToDollars(row: unknown, key: string): number | null {
  const raw = integer(row, key);
  if (raw === null || raw <= 0) return null;
  return raw * 1000;
}

/** Census dates are `YYYYMMDD` text — and `mcs150_date` appends a time, so trailing junk is ignored. */
export function isoFromYyyymmdd(raw: string | null): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw ?? '');
  if (!match) return null;
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return null;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Insurance dates are literal `MM/DD/YYYY` TEXT, the quietest trap in the source:
 * `$where=effective_date > '2026-01-01'` returns 0 rows with HTTP 200 because the comparison is lexicographic.
 * ISO here is what lets the status logic compare dates as plain strings — on `YYYY-MM-DD` lexicographic order
 * IS chronological, which is exactly what `MM/DD/YYYY` is not.
 */
export function isoFromMmddyyyy(raw: string | null): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw ?? '');
  if (!match) return null;
  const [, month, day, year] = match;
  if (year === undefined || month === undefined || day === undefined) return null;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
export function isoDay(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/**
 * The bare integer to compare against, or null when the input cannot be a USDOT number. A HARD REFUSAL, NOT A
 * BEST EFFORT: `dot_number::number = 0` is not an empty answer but 7,855 insurance rows — the `'00000000'`
 * broker / freight-forwarder sentinel — and 159,140 BOC-3 rows, so a value normalising to 0 attaches thousands
 * of unrelated carriers' filings to the case under review. The six-digit floor is the one `isZohoId` uses; it
 * costs the legacy sub-six-digit DOTs (174 and 535 are real), and that trade is accepted because a truncated
 * `221` would otherwise silently screen a real, unrelated carrier and report a clear. Zero-padded input IS
 * accepted, being what the frozen datasets emit: `'00652739'` becomes 652739, `'00000221'` still fails the
 * floor, and nothing longer than 8 digits fits either padded column.
 */
export function normalizeDot(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,8}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < 100_000 || value > 99_999_999) return null;
  return value;
}

/**
 * THE ONE `$where` CLAUSE THAT WORKS ON ALL THREE DATASETS. On INSURANCE and BOC-3 `dot_number` is TEXT
 * zero-padded to exactly 8 characters on 100% of rows, so a bare `dot_number = '652739'` matches ZERO rows and
 * returns `[]` with HTTP 200 — verified live today — and a formatting bug therefore becomes a confident false
 * negative on a compliance check with nothing anywhere to notice. On CENSUS the column is a number, so every
 * spelling coerces. Do NOT "fix" this into an OR of the bare and padded spellings, wrong on the padded
 * datasets the moment padding width changes and pointless on census; and do not reach for `to_number()`,
 * `ltrim()` or `pad_left()`, none of which exists in this SoQL dialect (HTTP 400
 * `query.soql.no-such-function`). Cast, or pad client-side with `padStart(8, '0')`.
 */
export function dotClause(dot: number): string {
  return `dot_number::number = ${dot}`;
}
