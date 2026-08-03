/**
 * Finance Mytrion → client modal, EFS and Money Codes tabs.
 *
 * Source is servercrm's `/api/efs/touchpoints/*` surface (EFS LLC / WEX OTR SOAP behind it) — NOT
 * the warehouse. Balances, contract loads and money-code state are live vendor facts with no DWH
 * copy to read, which is also why these calls are seconds rather than milliseconds and why every
 * panel loads on demand instead of with the modal.
 *
 * ⚠️ MONEY-CODE DIGITS NEVER LEAVE THIS MODULE. An unredeemed code is a bearer instrument: whoever
 * has the digits can draw the cash at a truck stop. The established rule for the money-code system
 * is that the value reaches the carrier through the CMP notification and nobody reads it out of a
 * UI — the self-service surface strips `efs_money_code` and exposes a `has_code` flag instead. EFS's
 * `getMoneyCodes` hands back the full `code` on every row, so `toMoneyCode()` keeps the last four
 * for reconciliation and drops the rest before the row is returned. Do not "temporarily" add the
 * full code back for debugging — log the id.
 *
 * Upstream limits discovered live against prod (2026-08-04), not from the handover doc:
 *   - loads and money-code history cap the window at 90 DAYS (a wider range is a 400, not a clamp)
 *   - `/carrier/:id/rejects` and `/carrier/:id/txn-summary` are NOT usable: rejects fails inside EFS
 *     (`ADBException: Unexpected subelement startDate`) for every date format tried, and txn-summary
 *     caps at 7 days. Neither is wired here.
 *   - `voidDate` comes back as the epoch sentinel `1970-01-01T00:00:00.000-06:00` when a code was
 *     never voided — rendered raw that reads as "voided in 1970", so it is normalized to null.
 */
import { serverCrm, ServerCrmHttpError } from '../../integrations/serverCrm.js';
import { AppError, errorMessage } from '../../lib/errors.js';

/** Upstream's own ceiling on `from`/`to` for loads and money-code history. */
export const EFS_MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 30;

export interface EfsWindow {
  from: string;
  to: string;
  days: number;
  /** True when the caller gave explicit dates rather than a rolling `days` count. */
  custom: boolean;
}

/** Either a rolling window (`days` back from now) or an explicit `from`/`to` pair of yyyy-mm-dd. */
export interface WindowInput {
  days?: number;
  from?: string;
  to?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * EFS's own clock. Its timestamps come back with a Central offset (`…T12:07:00.000-05:00`) and the
 * prepay ledger already established that EFS days must be bucketed by that CT date, not UTC or NY.
 */
const EFS_TZ = 'America/Chicago';

/**
 * The Central offset in effect on a given calendar day, e.g. `-05:00`.
 *
 * Computed rather than hardcoded because Central observes DST: a March range and a December range
 * need different offsets, and picking the wrong one shifts a whole day's movements across the
 * boundary. `longOffset` yields `GMT-05:00` / `GMT-06:00`; midday is probed so the answer can't land
 * on the ambiguous hour of a transition.
 */
function efsOffset(ymd: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EFS_TZ,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${ymd}T12:00:00Z`));
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-]\d{2}:\d{2})/.exec(raw);
  // A missing ICU offset would silently become UTC and shift every bound, so fail loudly instead.
  if (!m?.[1]) throw badWindow(`could not resolve the ${EFS_TZ} offset for ${ymd}`);
  return m[1];
}

/**
 * Resolve a window to the ISO instants the touchpoints want.
 *
 * Two shapes. A number (or `{days}`) is the rolling case, clamped to 1..90 rather than passed
 * through — a 91-day request is a 400 from EFS about range width, which surfaces to a finance user as
 * a broken tab, so bounding it means the widest offered range always answers.
 *
 * `{from, to}` is the custom-range case. Both ends are inclusive calendar days: `from` starts at
 * 00:00 and `to` ends at 23:59:59.999, so picking the same date twice returns that day's movements
 * rather than nothing.
 *
 * Those bounds are built in EFS's own CENTRAL time, not UTC. The rows come back stamped CT, so a UTC
 * midnight bound pulls in the previous CT evening — pick "1–31 July" and you get a movement that
 * displays as `30 Jun 19:00`. On a reconciliation screen a picked calendar month has to mean that
 * month as the rows show it.
 *
 * Throws a 400 for a malformed date, an inverted pair, or a span past EFS's 90-day ceiling — the
 * caller is asking for something the vendor cannot answer, and saying so beats a SOAP fault.
 */
export function efsWindow(input?: number | WindowInput, now = new Date()): EfsWindow {
  const opts: WindowInput = typeof input === 'number' ? { days: input } : (input ?? {});

  if (opts.from !== undefined || opts.to !== undefined) {
    const from = String(opts.from ?? '');
    const to = String(opts.to ?? '');
    if (!YMD.test(from) || !YMD.test(to)) {
      throw badWindow('a custom range needs both from and to as yyyy-mm-dd');
    }
    if (from > to) throw badWindow(`range starts after it ends (${from} → ${to})`);
    // A day that does not exist ROLLS OVER rather than becoming Invalid Date — `2026-02-30` parses as
    // 2 March. Round-tripping the date back to yyyy-mm-dd is what actually catches that, and an
    // impossible date must be refused rather than quietly answered for a different day.
    if (!isRealDay(from) || !isRealDay(to)) {
      throw badWindow(`not a real date (${from} → ${to})`);
    }
    const start = new Date(`${from}T00:00:00.000${efsOffset(from)}`);
    const end = new Date(`${to}T23:59:59.999${efsOffset(to)}`);
    // Inclusive day count: 01→01 is one day, not zero. Rounded because a DST transition inside the
    // range makes the span 23 or 25 hours off a whole multiple of a day.
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (days > EFS_MAX_WINDOW_DAYS) {
      throw badWindow(
        `EFS keeps only ${EFS_MAX_WINDOW_DAYS} days of history; that range is ${days} days`,
      );
    }
    return { from: start.toISOString(), to: end.toISOString(), days, custom: true };
  }

  const raw = Number.isFinite(opts.days) ? Number(opts.days) : DEFAULT_WINDOW_DAYS;
  const clamped = Math.min(Math.max(Math.trunc(raw), 1), EFS_MAX_WINDOW_DAYS);
  const to = new Date(now.getTime());
  const from = new Date(now.getTime() - clamped * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), days: clamped, custom: false };
}

/** True when `ymd` is a real calendar day — `2026-02-30` parses, but as 2 March, so it is not. */
function isRealDay(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

/** A window the vendor cannot answer is the caller's mistake, so 400 — not a 502. */
function badWindow(message: string): AppError {
  return new AppError(`Invalid date range: ${message}`, {
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    expose: true,
  });
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/**
 * EFS timestamps → the string as sent, minus the sentinels.
 *
 * A never-set date arrives as `1970-01-01T00:00:00.000-06:00`; anything at or before the epoch is a
 * placeholder, not a real event. Real values keep their offset verbatim — they are already zoned, so
 * re-parsing would only risk shifting them.
 */
function efsDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return t <= 0 ? null : s;
}

/** Wrap an upstream failure so a finance user sees a retryable 502, never a raw SOAP fault. */
function efsError(err: unknown): AppError {
  const status = err instanceof ServerCrmHttpError && err.status === 400 ? 400 : 502;
  return new AppError(`EFS read failed: ${errorMessage(err)}`, {
    statusCode: status,
    code: 'EFS_ERROR',
    expose: true,
    cause: err,
  });
}

/** servercrm answers 4xx for bad params, but also carries `success:false` in some bodies. */
function assertOk(body: { success?: boolean; error?: string }, what: string): void {
  if (body.success === false) {
    throw new AppError(`EFS ${what} failed: ${body.error ?? 'unknown upstream error'}`, {
      statusCode: 502,
      code: 'EFS_ERROR',
      expose: true,
    });
  }
}

// ─── Carrier snapshot (balance + contracts + cards) ───────────────────────────────────────────

export interface EfsContract {
  contractId: string;
  description: string;
  balance: number;
}

export interface EfsCard {
  cardNumber: string;
  status: string;
  type: string;
  balance: number;
}

export interface EfsCarrierSnapshot {
  carrierId: string;
  totalBalance: number;
  contracts: EfsContract[];
  cards: EfsCard[];
  cardCount: number;
  /** Non-null when EFS returned contracts but the card detail leg failed — a partial answer. */
  cardDetailError: string | null;
  fetchedAt: string;
}

interface RawSnapshot {
  success?: boolean;
  error?: string;
  totalBalance?: unknown;
  contracts?: unknown;
  cards?: unknown;
  cardCount?: unknown;
  cardDetailError?: unknown;
  fetchedAt?: unknown;
}

/** Live EFS position for one carrier: contract balances and the cards drawing on them. */
export async function fetchEfsSnapshot(carrierId: string): Promise<EfsCarrierSnapshot> {
  let raw: RawSnapshot;
  try {
    raw = await serverCrm.get<RawSnapshot>(`/api/efs/touchpoints/carrier/${carrierId}/snapshot`);
  } catch (err) {
    throw efsError(err);
  }
  assertOk(raw, 'carrier snapshot');

  const contracts = (Array.isArray(raw.contracts) ? raw.contracts : []).map((c) => {
    const r = c as Record<string, unknown>;
    return {
      contractId: str(r['contractId']),
      description: str(r['description']),
      balance: num(r['balance']),
    };
  });
  const cards = (Array.isArray(raw.cards) ? raw.cards : []).map((c) => {
    const r = c as Record<string, unknown>;
    return {
      cardNumber: str(r['cardNumber']),
      status: str(r['status']),
      type: str(r['type']),
      balance: num(r['balance']),
    };
  });

  return {
    carrierId,
    totalBalance: num(raw.totalBalance),
    contracts,
    cards,
    cardCount: num(raw.cardCount) || cards.length,
    cardDetailError: str(raw.cardDetailError) || null,
    fetchedAt: str(raw.fetchedAt) || new Date().toISOString(),
  };
}

// ─── Fund movements (TOPUP / SWEEP) ──────────────────────────────────────────────────────────

export interface EfsLoad {
  /** Sign of the amount, as classified upstream: `amount > 0` TOPUP, `amount < 0` SWEEP. */
  direction: 'TOPUP' | 'SWEEP';
  amount: number;
  amountAbs: number;
  contractId: string;
  when: string | null;
  /** EFS's dedup key. Null on rows EFS never assigned one (common on sweeps). */
  responseId: string | null;
  refNum: string | null;
}

export interface EfsLoadsResult {
  window: EfsWindow;
  summary: {
    total: number;
    topupCount: number;
    topupAmount: number;
    sweepCount: number;
    sweepAmount: number;
    /** topups − sweeps over the window. */
    net: number;
  };
  loads: EfsLoad[];
}

interface RawLoads {
  success?: boolean;
  error?: string;
  summary?: {
    total?: unknown;
    topups?: { count?: unknown; amount?: unknown };
    sweeps?: { count?: unknown; amount?: unknown };
    net?: unknown;
  };
  data?: unknown;
}

/** Top-ups and sweeps between the parent account and one carrier's contracts. */
export async function fetchEfsLoads(
  carrierId: string,
  window_?: number | WindowInput,
): Promise<EfsLoadsResult> {
  const window = efsWindow(window_);
  let raw: RawLoads;
  try {
    raw = await serverCrm.get<RawLoads>(`/api/efs/touchpoints/loads/${carrierId}`, {
      from: window.from,
      to: window.to,
      direction: 'ALL',
    });
  } catch (err) {
    throw efsError(err);
  }
  assertOk(raw, 'fund movements');

  const loads: EfsLoad[] = (Array.isArray(raw.data) ? raw.data : []).map((row) => {
    const r = row as Record<string, unknown>;
    const amount = num(r['amount']);
    return {
      direction: str(r['direction']) === 'SWEEP' || amount < 0 ? 'SWEEP' : 'TOPUP',
      amount,
      amountAbs: num(r['amountAbs']) || Math.abs(amount),
      contractId: str(r['contractId']),
      when: efsDate(r['when']),
      responseId: str(r['responseId']) || null,
      refNum: str(r['refNum']) || null,
    };
  });

  const s = raw.summary ?? {};
  return {
    window,
    summary: {
      total: num(s.total) || loads.length,
      topupCount: num(s.topups?.count),
      topupAmount: num(s.topups?.amount),
      sweepCount: num(s.sweeps?.count),
      sweepAmount: num(s.sweeps?.amount),
      net: num(s.net),
    },
    loads,
  };
}

// ─── Money codes ─────────────────────────────────────────────────────────────────────────────

export const MONEY_CODE_STATUSES = ['ALL', 'OPEN', 'USED', 'PARTIAL', 'VOIDED'] as const;
export type MoneyCodeStatus = (typeof MONEY_CODE_STATUSES)[number];

/** One money code, with the redeemable digits removed. See the module header. */
export interface FinanceMoneyCode {
  /** EFS `codeId` — the safe handle, and what `fetchMoneyCodeDetail` takes. */
  id: string;
  /** Last four digits only, for matching against a paper trail. Never the full code. */
  codeLast4: string;
  status: string;
  efsStatus: string;
  amount: number;
  amountUsed: number;
  amountRemaining: number;
  feeAmount: number;
  contractId: string;
  /** The carrier EFS issued the code TO — codes are drawn on the MAIN contract, not the child's. */
  issuedTo: string;
  notes: string;
  payee: string;
  /** EFS username of whoever drew it. */
  issuedBy: string;
  codeType: string;
  createdAt: string | null;
  firstUseAt: string | null;
  voided: boolean;
  voidedAt: string | null;
}

export interface MoneyCodesResult {
  window: EfsWindow;
  status: MoneyCodeStatus;
  summary: {
    total: number;
    openCount: number;
    openAmount: number;
    usedCount: number;
    usedAmount: number;
    partialCount: number;
    partialAmount: number;
    voidedCount: number;
    /** Fees EFS charged on the codes in this window — real cost, worth showing. */
    feeTotal: number;
  };
  codes: FinanceMoneyCode[];
}

interface RawMoneyCodes {
  success?: boolean;
  error?: string;
  summary?: Record<string, { count?: unknown; amount?: unknown; amountUsed?: unknown }> & {
    total?: unknown;
  };
  data?: unknown;
}

/** Strip the digits, keep everything a reconciler needs. */
function toMoneyCode(row: Record<string, unknown>): FinanceMoneyCode {
  const full = str(row['code']) || str(row['alphaCode']);
  const amount = num(row['amount']);
  const used = num(row['amountUsed']);
  return {
    id: str(row['id']),
    codeLast4: full.length > 4 ? full.slice(-4) : full,
    status: str(row['status']),
    efsStatus: str(row['efsStatus']),
    amount,
    amountUsed: used,
    amountRemaining: num(row['amountRemaining']) || Math.max(amount - used, 0),
    feeAmount: num(row['feeAmount']),
    contractId: str(row['contractId']),
    issuedTo: str(row['issuedTo']),
    notes: str(row['notes']),
    payee: str(row['payee']),
    issuedBy: str(row['who']),
    codeType: str(row['codeType']),
    createdAt: efsDate(row['created']) ?? efsDate(row['activeDate']),
    firstUseAt: efsDate(row['firstUse']),
    voided: row['voided'] === true,
    voidedAt: row['voided'] === true ? efsDate(row['voidDate']) : null,
  };
}

/**
 * One carrier's money codes for the window.
 *
 * EFS's history is PARENT-WIDE — `carrierId` is an upstream filter on `issuedTo`, so the call is as
 * slow as the parent's whole book regardless (≈7s for 60 days). That is why the panel asks for this
 * only when its tab is opened.
 */
export async function fetchCarrierMoneyCodes(
  carrierId: string,
  window_?: number | WindowInput,
  status: MoneyCodeStatus = 'ALL',
): Promise<MoneyCodesResult> {
  const window = efsWindow(window_);
  let raw: RawMoneyCodes;
  try {
    raw = await serverCrm.get<RawMoneyCodes>('/api/efs/touchpoints/money-codes', {
      from: window.from,
      to: window.to,
      status,
      carrierId,
    });
  } catch (err) {
    throw efsError(err);
  }
  assertOk(raw, 'money codes');

  const rows = Array.isArray(raw.data) ? raw.data : [];
  const codes = rows.map((r) => toMoneyCode(r as Record<string, unknown>));
  const s = raw.summary ?? {};
  return {
    window,
    status,
    summary: {
      total: num(s.total) || codes.length,
      openCount: num(s['open']?.count),
      openAmount: num(s['open']?.amount),
      usedCount: num(s['used']?.count),
      usedAmount: num(s['used']?.amount),
      partialCount: num(s['partial']?.count),
      partialAmount: num(s['partial']?.amount),
      voidedCount: num(s['voided']?.count),
      feeTotal: codes.reduce((sum, c) => sum + c.feeAmount, 0),
    },
    codes,
  };
}

export interface MoneyCodeUse {
  amount: number;
  /** EFS check number for the draw — the reconciliation handle at the truck stop. */
  checkNumber: string;
  at: string | null;
}

export interface MoneyCodeDetail {
  id: string;
  codeLast4: string;
  status: string;
  amount: number;
  amountUsed: number;
  uses: MoneyCodeUse[];
  firstUseAt: string | null;
  voided: boolean;
  voidedAt: string | null;
}

/**
 * Redemption detail for one code, by EFS `codeId`.
 *
 * `getMoneyCodeById(codeId)` is the only safe lookup — passing the 10-digit serial to
 * `getMoneyCode` crashes EFS outright ("Can not serialize OM Element Envelope"), which is the other
 * reason this API takes an id and the UI never holds the digits.
 */
export async function fetchMoneyCodeDetail(codeId: string): Promise<MoneyCodeDetail> {
  let raw: { success?: boolean; error?: string; data?: Record<string, unknown> };
  try {
    raw = await serverCrm.get('/api/efs/touchpoints/money-codes/detail', { codeId });
  } catch (err) {
    throw efsError(err);
  }
  assertOk(raw, 'money-code detail');

  const d = raw.data ?? {};
  const full = str(d['code']) || str(d['alphaCode']);
  const uses = (Array.isArray(d['uses']) ? d['uses'] : []).map((u) => {
    const r = u as Record<string, unknown>;
    return { amount: num(r['amount']), checkNumber: str(r['checkNumber']), at: efsDate(r['time']) };
  });
  return {
    id: str(d['codeId']) || codeId,
    codeLast4: full.length > 4 ? full.slice(-4) : full,
    status: str(d['status']),
    amount: num(d['amount']),
    amountUsed: num(d['amountUsed']),
    uses,
    firstUseAt: efsDate(d['firstUse']),
    voided: d['voided'] === true,
    voidedAt: d['voided'] === true ? efsDate(d['voidDate']) : null,
  };
}
