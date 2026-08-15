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
  /** Human labels for the eight features, from the model definition rather than the client. */
  featureLabels: Record<string, string>;
  features: string[];
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

export interface WatchRunResult {
  scoringDate: string;
  scored: number;
  skipped: number;
  durationMs: number;
  unmatchedFeatures: Record<string, number>;
}

/** Admin-only on the server — a full run queries the warehouse for several seconds. */
export async function runWatchScoring(
  body: { scoringDate?: string; carrierId?: string } = {},
): Promise<WatchRunResult> {
  const data = await request('POST', '/verification/watch/run', { body });
  return data as WatchRunResult;
}
