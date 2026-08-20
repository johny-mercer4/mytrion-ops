/**
 * FMCSA QCMobile — Verification Phase 4's source of truth for MC/USDOT status, operating authority and
 * INSURANCE. The only authority-shaped column the desk had was `stg_broker_snapshot.operating_status`
 * (`modules/verification/carrierEnrich.ts`): a column in somebody else's scrape, with no insurance in it at
 * all. QCMobile is the register itself.
 *
 * WRITTEN BLIND, WHICH IS THE MOST IMPORTANT THING TO KNOW ABOUT IT. QCMobile is UNREACHABLE from this
 * machine: every path under `mobile.fmcsa.dot.gov` answers HTTP 403 with a 118-byte HTML body from an AWS-ELB
 * edge keyed on our egress IP (Tashkent, UZ) — byte-identical with a valid `webKey` and with none at all, so
 * it is not authentication, while usa.gov / api.data.gov / irs.gov answer 200 from the same machine, so it is
 * not our network. It resolves from the US Render instance. So (1) a 403 IS PERMANENT AND IS NEVER RETRIED:
 * an edge deny is not throttling and no backoff turns it into a 200, so `reason: 'blocked'` is terminal and
 * the ladder below stops dead on it (there is no retry helper in `src/lib`, and this file adds none); (2)
 * every parse below is pinned to CAPTURED FIXTURES, and where they disagree with the docs the fixtures win
 * and the disagreement is named in a comment — do NOT "correct" a field name to the documentation; (3) we do
 * not try to get around the deny. No proxy, no VPN, no user-agent games; it is a federal system.
 *
 * THE DEGRADATION CONTRACT. Plain module — no class, no registry, no ToolManifest — and it NEVER THROWS.
 * Every probe returns `{ available, error, ... }` where `available: false` means "could not read" and is
 * NEVER the same value as a successful empty answer; "not configured" and "our IP is denied" are unavailable
 * REASONS, not exceptions. Phase 4 must never record an authority clear it did not receive. Mirrors the two
 * Phase-3 probes deliberately.
 */
import { env } from '../config/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/errors.js';

/**
 * Used when `FMCSA_BASE_URL` is blank — which the vitest baseline pins it to on purpose, so a suite that
 * forgot to stub `fetch` cannot reach FMCSA. Zod's default only fires when the var is ABSENT.
 */
const DEFAULT_BASE_URL = 'https://mobile.fmcsa.dot.gov/qc/services';

/**
 * HTTP 200 DOES NOT IMPLY JSON: in a maintenance window QCMobile serves an HTML page with this exact title
 * AND a 200 status, so a client that trusts the status code dies in `JSON.parse` on a planned outage. Sniffed
 * after a parse failure, the only moment it can be true.
 */
const MAINTENANCE_TITLE = '<title>FMCSA System Maintenance Page</title>';

/**
 * The name search is silently capped: the docs say "data is limited to the first 50 carriers" and the
 * envelope carries NO total-count element, so a full page and a page that is merely exactly full are
 * indistinguishable. Exactly this many results is therefore reported as truncated.
 */
const NAME_SEARCH_SIZE = 50;

/**
 * THE LOOKUP-KEY FLOOR, measured rather than guessed — and measured in BOTH directions, which is why it is 5
 * and not 6. Over our own 52 verification cases the USDOT column holds `221` and `2231` (owner-operator junk
 * typed into the wrong box) and one `48644490` that matches nothing anywhere, while `carrierEnrich.ts` gates
 * its DWH lookup at >= 4 digits, which lets `2231` straight through to a query. But two of the three carriers
 * in our captured fixtures have FIVE-digit USDOTs — 53467 (the `/authority` capture) and 44110 (the
 * `/docket-numbers` capture) — so the 6-digit floor this client was specified with would have refused to look
 * up real, live carriers. Five is the tightest floor that keeps every real number we have seen and drops all
 * of our junk. `48644490` still passes, because nothing about its shape says it is junk, and comes back as a
 * clean not-found, which is the correct answer for it.
 */
const MIN_LOOKUP_DIGITS = 5;

/** Why a read could not be made. `null` beside `available: false` means it never left the process. */
import {
  carrierFromEntry,
  authorityFromEntry,
  asRecord,
  str,
  type FmcsaAuthorityResult,
  type FmcsaCarrierLookup,
  type FmcsaUnavailableReason,
} from './fmcsaCarrierShape.js';

export type {
  FmcsaAuthorityLine,
  FmcsaAuthorityRecord,
  FmcsaAuthorityResult,
  FmcsaCarrierLookup,
  FmcsaAuthorityVerdict,
  FmcsaCarrier,
  FmcsaFlag,
  FmcsaInsuranceLine,
  FmcsaStatusVerdict,
  FmcsaUnavailableReason,
} from './fmcsaCarrierShape.js';

/**
 * Whether a lookup can even be attempted.
 *
 * The key is a QUERY PARAM, not a header, so a blank one builds a URL that looks perfectly valid and comes
 * back 404 "Webkey not found". Checked before every read; the round trip buys nothing.
 */
export function isFmcsaConfigured(): boolean {
  return env.FMCSA_API_KEY.trim() !== '';
}

// --- Transport: one function, so all six unavailable reasons get decided in one place.

/**
 * `not_found` is a SUCCESSFUL read whose answer is "no such carrier", a separate member from `unavailable` so
 * no caller can express one as the other — the mistake this module exists to stop.
 */
type QcRead =
  | { kind: 'ok'; content: unknown; retrievalDate: string | null }
  | { kind: 'not_found'; retrievalDate: string | null }
  | { kind: 'unavailable'; reason: FmcsaUnavailableReason; error: string };

/**
 * The `webKey` travels in the URL, so ANY message quoting a URL or query string can leak it (undici transport
 * errors and proxy error pages both do). Every string that reaches a log or a return value passes through
 * here; `split`/`join`, so the key needs no regex escaping.
 */
function scrubKey(message: string): string {
  const key = env.FMCSA_API_KEY.trim();
  return key === '' ? message : message.split(key).join('***');
}
/** The one warn per failed read. Object first (pino), key scrubbed, never a URL. */
function unavailable(reason: FmcsaUnavailableReason, error: string): QcRead {
  const safe = scrubKey(error);
  logger.warn({ err: safe }, `fmcsa qcmobile read failed (${reason})`);
  return { kind: 'unavailable', reason, error: safe };
}

/** `undefined` means "not JSON": valid JSON never parses to undefined, so the signal is unambiguous. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A `content` STRING is always an error, and classifying it is where the worst trap lives: A BAD OR UNKNOWN
 * `webKey` COMES BACK AS HTTP **404**, not 401, with body `{"content":"Webkey not found"}`. The obvious
 * mapping — 404 means no such carrier — therefore reports "not in the federal register" for an authentication
 * failure, about a carrier that may be perfectly authorised. THE ORDER OF THE TWO CHECKS IS THE FIX AND MUST
 * NOT BE SWAPPED: "Webkey not found" matches /not found/ too.
 */
function classifyMessage(status: number, message: string, retrievalDate: string | null): QcRead {
  const text = message.trim();
  if (/webkey/i.test(text)) return unavailable('auth', `webKey rejected (HTTP ${status}): ${text}`);
  if (status === 404 || /not\s*found/i.test(text)) return { kind: 'not_found', retrievalDate };
  return unavailable('http', `HTTP ${status}: ${text}`);
}

async function readQcMobile(
  path: string,
  query: Readonly<Record<string, string>> = {},
): Promise<QcRead> {
  if (!isFmcsaConfigured()) {
    // No warn: not-configured is a deployment state, not a failure, and it would log on every case.
    const error = 'FMCSA_API_KEY is not configured';
    return { kind: 'unavailable', reason: 'not_configured', error };
  }

  let status = 0;
  let body = '';
  try {
    const base = (env.FMCSA_BASE_URL.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const url = new URL(`${base}/${path}`);
    url.searchParams.set('webKey', env.FMCSA_API_KEY.trim());
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    // `Accept` and nothing else: QCMobile has no auth header, and sending one invites a 400.
    const headers = { Accept: 'application/json' };
    const res = await fetchWithTimeout(url, { headers }, env.OUTBOUND_HTTP_TIMEOUT_MS);
    status = res.status;
    // 403 FIRST, AND GENUINELY WITHOUT READING THE BODY: the AWS-ELB edge deny on our egress IP is
    // 118 bytes of HTML on every path, permanent, so there is nothing to retry and nothing in it to
    // read. Returning before `res.text()` is what makes that claim true rather than decorative.
    if (status === 403) {
      return unavailable(
        'blocked',
        'HTTP 403 — this egress IP is denied at the FMCSA edge; permanent, not retried',
      );
    }
    body = await res.text();
  } catch (err) {
    // Includes the deadline: `fetchWithTimeout` aborts via AbortSignal.timeout, and that lands here.
    return unavailable('transport', errorMessage(err));
  }

  // Never observed (QCMobile answers 404 for a bad key) but a 401 could not mean anything else.
  if (status === 401) return unavailable('auth', 'HTTP 401 — FMCSA rejected the webKey');

  const parsed = safeJsonParse(body);
  if (parsed === undefined) {
    if (body.includes(MAINTENANCE_TITLE)) {
      return unavailable('maintenance', `FMCSA is in a maintenance window (HTTP ${status})`);
    }
    return unavailable('http', `HTTP ${status} with a non-JSON body`);
  }
  const envelope = asRecord(parsed);
  if (envelope === null) return unavailable('http', `HTTP ${status} with an unrecognised body`);
  const retrievalDate = str(envelope.retrievalDate) ?? null;
  const content = envelope.content;

  // `content` HAS THREE SHAPES, not two: an object (single carrier), an array (any search), and a
  // BARE STRING on every error. A client that types it `object | array` crashes on the error path —
  // the path we are on constantly while the IP deny stands.
  if (typeof content === 'string') return classifyMessage(status, content, retrievalDate);
  if (status < 200 || status >= 300) return unavailable('http', `HTTP ${status}`);
  if (content === null || content === undefined) {
    // Unavailable rather than "found nothing", deliberately: an empty search legitimately returns an
    // empty ARRAY, so a missing content element is a body we do not understand — and "could not
    // read" is the safe direction to be wrong in, because it can never be mistaken for a clear.
    return unavailable('http', `HTTP ${status} with no content element`);
  }
  return { kind: 'ok', content, retrievalDate };
}


/**
 * `/carriers/{dot}` serves ONE OBJECT and every search serves an ARRAY, same wrapper inside either way — so a
 * single object is read as a one-element list rather than duplicating the parse. An entry that does not parse
 * is dropped, never pushed on as a blank record.
 */
function mapContent<T>(content: unknown, parse: (entry: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const entry of Array.isArray(content) ? content : [content]) {
    const parsed = parse(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

// --- The probes.

/**
 * Digits of a value fit to be a lookup key, or '' when it is not one. MC and USDOT reach us as `MC-778211`,
 * `DOT 158121`, `No assigned number` and `0` — the sentinel soup `verificationDealScreening.digits` also
 * faces — so strip first, then require non-empty, non-zero and at least `MIN_LOOKUP_DIGITS` long.
 */
/**
 * How many entries the register actually sent, before parsing had an opinion.
 *
 * The single-carrier endpoint answers with an object, every search with an array; either way one
 * envelope element is one carrier the register believes in. Compared against the PARSED count, this
 * is what separates "no such carrier" from "carriers we could not read".
 */
function wireCount(content: unknown): number {
  if (Array.isArray(content)) return content.length;
  return content === null || content === undefined ? 0 : 1;
}

function lookupDigits(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D+/g, '');
  if (digits === '' || Number(digits) === 0 || digits.length < MIN_LOOKUP_DIGITS) return '';
  return digits;
}

/** One builder for both directions, so a failure can never be assembled with `available: true`. */
/**
 * The name, as a URL path segment, WITHOUT the one way encoding can throw.
 *
 * `encodeURIComponent` raises `URIError: URI malformed` on a lone UTF-16 surrogate, and it was being
 * called in the caller's own frame — outside every try — so a single malformed byte in a Zoho company
 * name took the whole "never throws" contract down with it. Names reach this module from free-text
 * columns that carry no UTF-16 guarantee.
 *
 * Lone surrogates are dropped rather than escaped: they are not part of any real carrier name, so
 * there is nothing to preserve, and a name search is a last-resort fuzzy rung anyway.
 */
function nameSegment(name: string): string {
  return encodeURIComponent(name.replace(/[\uD800-\uDFFF]/g, ''));
}

function result(over: Partial<FmcsaCarrierLookup>): FmcsaCarrierLookup {
  return {
    available: true,
    error: null,
    reason: null,
    matchedOn: null,
    carrier: null,
    candidates: [],
    candidatesTruncated: false,
    notFound: false,
    retrievalDate: null,
    ...over,
  };
}
/** An unavailable read, copied onto the lookup shape. Never carries a partial answer with it. */
function failedRead(read: { reason: FmcsaUnavailableReason; error: string }): FmcsaCarrierLookup {
  return result({ available: false, error: read.error, reason: read.reason });
}

/**
 * A carrier from QCMobile, by USDOT then MC then name. THE LADDER IS THE POINT, and each rung is a measured
 * decision:
 *  - USDOT first: the register's own key, and the only one that returns a single carrier by construction.
 *  - MC second, and ONLY as a retry of a GENUINE not-found. An unavailable read never falls through to the
 *    next rung — a 403 deny, a maintenance page or a rejected webKey fails the same way on the MC path, so a
 *    second call buys nothing and doubles the latency of a failing run (which is also why a 403 makes no
 *    second attempt at all).
 *  - MC IS SKIPPED WHEN ITS DIGITS EQUAL THE USDOT'S. Measured: 10 of our 15 cases with both columns filled
 *    carry the same number in both, so the retry would ask the register the same question down another path
 *    and get the same not-found one round trip later.
 *  - Name is a last resort and NEVER auto-picks: it returns a LIST (two live carriers match "VERIHA" in our
 *    own captured sample), so it resolves to `candidates` for a human to choose from, never to `carrier`.
 *    Provenance is in `matchedOn`. NEVER THROWS.
 */
export async function lookupFmcsaCarrier(keys: {
  // `| undefined` alongside `?` on purpose: under `exactOptionalPropertyTypes` a caller assembling
  // this from nullable Zoho/DB columns cannot pass an explicit `undefined` without it.
  dot?: string | null | undefined;
  mc?: string | null | undefined;
  name?: string | null | undefined;
}): Promise<FmcsaCarrierLookup> {
  const dot = lookupDigits(keys.dot);
  const mc = lookupDigits(keys.mc);
  const name = (keys.name ?? '').trim();

  // NOT a clean lookup. Nothing was asked, so nothing was cleared — reporting `available: true` here
  // would let a caller that reads "available and no carrier" as "not in the register" record a
  // finding about a carrier it never looked up. `reason: null` says it never left the process.
  if (dot === '' && mc === '' && name === '') {
    return result({ available: false, error: 'no usable USDOT, MC or carrier name to look up' });
  }

  if (dot !== '') {
    const read = await readQcMobile(`carriers/${dot}`);
    if (read.kind === 'unavailable') return failedRead(read);
    if (read.kind === 'ok') {
      const carrier = mapContent(read.content, carrierFromEntry)[0];
      if (carrier !== undefined) {
        return result({ matchedOn: 'dot', carrier, retrievalDate: read.retrievalDate });
      }
      // Through `failedRead` so it passes the single `logger.warn` site — a remote-shape failure that
      // logs nothing is one nobody finds out about until a reviewer asks why the pane is empty.
      return failedRead({
        reason: 'http',
        error: 'FMCSA sent an envelope with no carrier element',
      });
    }
    // Genuinely not in the register. Fall through only if there is a DIFFERENT question to ask.
    if ((mc === '' || mc === dot) && name === '') {
      return result({ notFound: true, retrievalDate: read.retrievalDate });
    }
  }

  if (mc !== '' && mc !== dot) {
    const read = await readQcMobile(`carriers/docket-number/${mc}`);
    if (read.kind === 'unavailable') return failedRead(read);
    if (read.kind === 'ok') {
      const { retrievalDate } = read;
      const carriers = mapContent(read.content, carrierFromEntry);
      const first = carriers[0];
      if (carriers.length === 1 && first !== undefined) {
        return result({ matchedOn: 'mc', carrier: first, retrievalDate });
      }
      // A docket number resolving to more than one carrier is not a hit. Same rule as the name
      // search: more than one answer is a question for a human, not a coin toss.
      if (carriers.length > 1) return result({ candidates: carriers, retrievalDate });
      // Same wire-vs-parse rule as the name rung below.
      if (wireCount(read.content) > 0) {
        return failedRead({
          reason: 'http',
          error: 'FMCSA returned docket entries with no carrier element',
        });
      }
    }
    if (name === '') return result({ notFound: true, retrievalDate: read.retrievalDate });
  }

  const page = { start: '1', size: String(NAME_SEARCH_SIZE) };
  const read = await readQcMobile(`carriers/name/${nameSegment(name)}`, page);
  if (read.kind === 'unavailable') return failedRead(read);
  if (read.kind === 'not_found') {
    return result({ notFound: true, retrievalDate: read.retrievalDate });
  }
  const candidates = mapContent(read.content, carrierFromEntry);
  const returned = wireCount(read.content);
  // PARSED-ZERO IS NOT WIRE-ZERO. `mapContent` silently drops any entry without a `carrier` element,
  // so deriving `notFound` from the parsed length turned "the register answered with carriers we
  // could not read" into "this carrier is not in the register" — the exact conflation this module
  // exists to prevent, and the one direction it must never be wrong in.
  if (candidates.length === 0 && returned > 0) {
    return failedRead({
      reason: 'http',
      error: 'FMCSA returned entries with no carrier element',
    });
  }
  return result({
    candidates,
    // Exactly a full page means "at least this many" — there is no total-count element to check.
    // Counted on the WIRE too: one unreadable entry in a full page would otherwise report the page
    // as complete and hide the other 49 matches that exist.
    candidatesTruncated: returned >= NAME_SEARCH_SIZE,
    notFound: returned === 0,
    retrievalDate: read.retrievalDate,
  });
}

/**
 * The operating-authority records for one USDOT — the grant itself, not the summary codes on the carrier
 * record. AN EMPTY ANSWER IS A REAL ANSWER HERE: a carrier with no authority record holds no operating
 * authority, exactly what Phase 4 wants to know. So a clean not-found returns `available: true` with no
 * records; only a read we could not make is `available: false`. NEVER THROWS.
 */
export async function fetchFmcsaAuthority(dotNumber: string): Promise<FmcsaAuthorityResult> {
  const dot = lookupDigits(dotNumber);
  // Unavailable with `reason: null` — the same distinction the lookup makes. An unusable USDOT must
  // not come back as "this carrier holds no authority".
  if (dot === '') {
    const error = 'not a usable USDOT number for a QCMobile authority lookup';
    return { available: false, error, reason: null, records: [] };
  }

  const read = await readQcMobile(`carriers/${dot}/authority`);
  if (read.kind === 'unavailable') {
    return { available: false, error: read.error, reason: read.reason, records: [] };
  }
  if (read.kind === 'not_found') return { available: true, error: null, reason: null, records: [] };
  const records = mapContent(read.content, authorityFromEntry);
  return { available: true, error: null, reason: null, records };
}

