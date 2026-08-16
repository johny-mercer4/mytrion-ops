/**
 * Mytrion Watch — behavioural scoring for carriers already on the books.
 *
 * Reads come from OUR snapshot table (`/v1/verification/watch/*`), never the warehouse, so the desk
 * stays fast and still renders when the DWH is down. Everything is verification-gated.
 *
 * Numbers arrive as JSON numbers, not strings: the backend builds these payloads with `to_jsonb`
 * over `numeric` columns and casts the derived aggregates to `float8`. Typing them as `number` here
 * is a claim about the wire format, and `watchNum` below is the guard for the one case that breaks
 * it — a `numeric` big enough that Postgres emits it as a string.
 */
import { request } from './transport';

export const WATCH_BANDS = ['low', 'watch', 'elevated', 'high'] as const;
export type WatchBand = (typeof WATCH_BANDS)[number];

export type WatchMovement = 'worsened' | 'improved';

/** One carrier, one scoring date. Mirrors `mytrion_watch_scores`. */
export interface WatchScoreRow {
  id: string;
  scoringDate: string;
  carrierId: string;
  modelVersion: string;
  companyName: string | null;
  agentName: string | null;
  creditLimit: number | null;
  sumContribution: number;
  logit: number;
  pdScore: number;
  creditScore: number;
  band: WatchBand;
  /** Null on a carrier's first appearance — no earlier snapshot to move against. */
  prevCreditScore: number | null;
  scoreDelta: number | null;
  features: Record<string, number | null>;
  riskDrivers: string[];
}

export interface WatchAggregates {
  total: number;
  low: number;
  watch: number;
  elevated: number;
  high: number;
  worsened: number;
  improved: number;
  avgScore: number | null;
  /** Approved credit sitting on carriers in the Elevated and High bands. */
  exposureAtRisk: number | null;
}

export interface WatchQueueResult {
  /** Null when nothing has been scored yet — the desk shows "no snapshot" rather than an empty list. */
  scoringDate: string | null;
  items: WatchScoreRow[];
  total: number;
  aggregates: WatchAggregates;
  lastRun: WatchRun | null;
}

export interface WatchContribution {
  id: string;
  feature: string;
  rawValue: number | null;
  binId: number;
  woe: number;
  coef: number;
  /** woe x coef. POSITIVE raises the probability of default; negative is protective. */
  contribution: number;
  /** The bucket this value fell in. Null bound = unbounded; intervals are (lower, upper]. */
  lowerB: number | null;
  upperB: number | null;
  /** True when the value was missing and the model's "no data" weight was used. */
  isNan: boolean;
}

export type WatchUnit = 'percent' | 'days' | 'usd' | 'gallons' | 'ratio2';

export interface WatchFeatureMeta {
  key: string;
  label: string;
  unit: WatchUnit;
  help: string;
  noun: string;
}

/** The weights that produced a score, band cut-points included — the desk never hardcodes them. */
export interface WatchModel {
  modelVersion: string;
  intercept: number;
  baseScore: number;
  baseOdds: number;
  pdo: number;
  bandHighBelow: number;
  bandElevatedBelow: number;
  bandWatchBelow: number;
}

export interface WatchHistoryPoint {
  scoringDate: string;
  creditScore: number;
  pdScore: number;
  band: WatchBand;
}

export interface WatchCarrierDetail {
  score: WatchScoreRow | null;
  contributions: WatchContribution[];
  history: WatchHistoryPoint[];
  /** Label, unit and plain-English help for the eight features, in model order. */
  featureMeta: WatchFeatureMeta[];
  model: WatchModel | null;
}

export interface WatchRun {
  id: string;
  scoringDate: string;
  modelVersion: string;
  trigger: string;
  scoredCount: number | null;
  skippedCount: number | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface WatchQueueFilter {
  limit?: number;
  offset?: number;
  band?: WatchBand;
  movement?: WatchMovement;
  search?: string;
  scoringDate?: string;
}

/**
 * Coerce a wire value to a number.
 *
 * Postgres emits `numeric` as a JSON number through `to_jsonb`, but node-postgres hands very large
 * or high-precision values back as strings. Rendering "NaN" on a credit desk is worse than showing
 * nothing, so anything that will not parse becomes null and the caller renders an em dash.
 */
export function watchNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function listWatchScores(
  filter: WatchQueueFilter = {},
  signal?: AbortSignal,
): Promise<WatchQueueResult> {
  const query: Record<string, string | number> = {};
  if (filter.limit !== undefined) query.limit = filter.limit;
  if (filter.offset !== undefined) query.offset = filter.offset;
  if (filter.band) query.band = filter.band;
  if (filter.movement) query.movement = filter.movement;
  if (filter.search) query.search = filter.search;
  if (filter.scoringDate) query.scoringDate = filter.scoringDate;

  const data = await request('GET', '/verification/watch/scores', {
    query,
    ...(signal ? { signal } : {}),
  });
  return data as WatchQueueResult;
}

export async function getWatchCarrier(
  carrierId: string,
  signal?: AbortSignal,
): Promise<WatchCarrierDetail> {
  const data = await request('GET', `/verification/watch/scores/${encodeURIComponent(carrierId)}`, {
    ...(signal ? { signal } : {}),
  });
  return data as WatchCarrierDetail;
}

export async function listWatchRuns(signal?: AbortSignal): Promise<{ runs: WatchRun[] }> {
  const data = await request('GET', '/verification/watch/runs', {
    ...(signal ? { signal } : {}),
  });
  return data as { runs: WatchRun[] };
}

/** The run is QUEUED, not finished — poll `lastRun` for completion. */
export interface WatchRunQueued {
  queued: boolean;
  jobId: string;
}

/**
 * Ask for a re-score. Returns as soon as the job is on the queue.
 *
 * A full run takes about a minute against the warehouse, so this deliberately does not wait for it;
 * the desk watches `lastRun.finishedAt` instead.
 */
export async function runWatchScoring(
  body: { scoringDate?: string } = {},
): Promise<WatchRunQueued> {
  return (await request('POST', '/verification/watch/run', { body })) as WatchRunQueued;
}

export interface CarrierInvoice {
  invoiceId: string;
  invoiceDate: string | null;
  dueDate: string | null;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  status: string | null;
  paymentCount: number;
  lastPaymentDate: string | null;
}

export interface CarrierInvoiceContext {
  invoices: CarrierInvoice[];
  openCount: number;
  openAmount: number;
}

/**
 * Open invoices for a carrier — a LIVE warehouse read, on its own route.
 *
 * Every other Watch read comes from our snapshot table. This one does not, which is why it is
 * fetched separately: if the warehouse is slow the panel fails alone and the score still renders.
 */
export async function getCarrierInvoices(
  carrierId: string,
  signal?: AbortSignal,
): Promise<CarrierInvoiceContext> {
  return (await request(
    'GET',
    `/verification/watch/scores/${encodeURIComponent(carrierId)}/invoices`,
    { ...(signal ? { signal } : {}) },
  )) as CarrierInvoiceContext;
}
