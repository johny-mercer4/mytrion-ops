import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const RING_MAX = 2048;
const SAMPLE_INTERVAL_MS = 15_000;
const startedAt = new Date().toISOString();

export type CounterName =
  | 'tg_429_total'
  | 'tg_send_fail_total'
  | 'tg_poll_fail_total'
  | 'provider_rate_limited_total'
  | 'provider_error_result_total'
  | 'provider_stream_throw_total'
  | 'provider_all_limited_total'
  | 'backend_error_total'
  | 'turns_total'
  | 'turn_errors_total'
  | 'write_replayed_total'
  | 'write_continue_nudge_total'
  | 'write_retry_refused_total'
  | 'vision_turns_total'
  | 'idempotency_conflict_total'
  | 'operation_unknown_total'
  | 'stale_fence_total';

const COUNTER_NAMES: CounterName[] = [
  'tg_429_total',
  'tg_send_fail_total',
  'tg_poll_fail_total',
  'provider_rate_limited_total',
  'provider_error_result_total',
  'provider_stream_throw_total',
  'provider_all_limited_total',
  'backend_error_total',
  'turns_total',
  'turn_errors_total',
  'write_replayed_total',
  'write_continue_nudge_total',
  'write_retry_refused_total',
  'vision_turns_total',
  'idempotency_conflict_total',
  'operation_unknown_total',
  'stale_fence_total',
];

type HistogramName =
  | 'turn_total_ms'
  | 'queue_wait_ms'
  | 'exec_ms'
  | 'send_ms';

interface Gauges {
  active_turns: number;
  queued_turns: number;
  active_vision: number;
  active_subprocesses: number;
  rss_mb: number;
  heap_used_mb: number;
  rss_growth_mb: number;
  event_loop_lag_p95_ms: number;
  event_loop_lag_max_ms: number;
}

export interface TurnAggregateRow {
  waitMs: number;
  execMs: number;
  totalMs?: number | undefined;
  isError: boolean;
}

interface HistogramSummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface MetricsSnapshot {
  ts: string;
  startedAt: string;
  uptimeSec: number;
  pid: number;
  gauges: Gauges;
  counters: Record<CounterName, number>;
  backendErrorsByStatus: Record<string, number>;
  histograms: Record<HistogramName, HistogramSummary>;
}

const counters = Object.fromEntries(
  COUNTER_NAMES.map((name) => [name, 0]),
) as Record<CounterName, number>;
const backendErrorsByStatus: Record<string, number> = {};
const histograms: Record<HistogramName, number[]> = {
  turn_total_ms: [],
  queue_wait_ms: [],
  exec_ms: [],
  send_ms: [],
};
const gauges: Gauges = {
  active_turns: 0,
  queued_turns: 0,
  active_vision: 0,
  active_subprocesses: 0,
  rss_mb: 0,
  heap_used_mb: 0,
  rss_growth_mb: 0,
  event_loop_lag_p95_ms: 0,
  event_loop_lag_max_ms: 0,
};

let initialRssMb = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
let loopDelay: IntervalHistogram | null = null;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(
        sorted.length - 1,
        Math.floor((Math.max(0, Math.min(100, p)) / 100) * sorted.length),
      )
    ] ?? 0
  );
}

function observe(name: HistogramName, value: number): void {
  if (!Number.isFinite(value)) return;
  const ring = histograms[name];
  ring.push(Math.max(0, value));
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function summarize(values: number[]): HistogramSummary {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: percentile(values, 100),
  };
}

export function incrementCounter(
  name: CounterName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function noteBackendError(status: number, code?: string): void {
  incrementCounter('backend_error_total');
  const statusKey = String(status);
  backendErrorsByStatus[statusKey] =
    (backendErrorsByStatus[statusKey] ?? 0) + 1;
  if (code === 'SUPPORT_BOT_IDEMPOTENCY_CONFLICT') {
    incrementCounter('idempotency_conflict_total');
  } else if (code === 'SUPPORT_BOT_OPERATION_OUTCOME_UNKNOWN') {
    incrementCounter('operation_unknown_total');
  } else if (code === 'SUPPORT_BOT_STALE_FENCE') {
    incrementCounter('stale_fence_total');
  }
}

export function subprocessStarted(): () => void {
  gauges.active_subprocesses++;
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    gauges.active_subprocesses = Math.max(
      0,
      gauges.active_subprocesses - 1,
    );
  };
}

export function visionStarted(): () => void {
  incrementCounter('vision_turns_total');
  gauges.active_vision++;
  const settleSubprocess = subprocessStarted();
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    gauges.active_vision = Math.max(0, gauges.active_vision - 1);
    settleSubprocess();
  };
}

export interface MetricTurnStats {
  durationMs: number;
  isError: boolean;
  queueWaitMs?: number | undefined;
  totalMs?: number | undefined;
  sendMs?: number | undefined;
}

export interface TurnLifecycle {
  readonly enqueuedAt: number;
  started(): number;
  wrapStats<T extends MetricTurnStats>(
    callback?: ((stats: T) => void) | undefined,
  ): (stats: T) => void;
  wrapReply<T extends (text: string) => Promise<void>>(reply: T): T;
  settle(error?: unknown): void;
}

export function turnEnqueued(now = Date.now()): TurnLifecycle {
  gauges.queued_turns++;
  let startedAtMs: number | null = null;
  let queueWaitMs = 0;
  let sendMs = 0;
  let sawStats = false;
  let statsErrored = false;
  let settled = false;

  return {
    enqueuedAt: now,
    started(): number {
      if (startedAtMs != null) return queueWaitMs;
      startedAtMs = Date.now();
      queueWaitMs = Math.max(0, startedAtMs - now);
      gauges.queued_turns = Math.max(0, gauges.queued_turns - 1);
      gauges.active_turns++;
      observe('queue_wait_ms', queueWaitMs);
      return queueWaitMs;
    },
    wrapStats<T extends MetricTurnStats>(
      callback?: ((stats: T) => void) | undefined,
    ): (stats: T) => void {
      return (stats: T): void => {
        sawStats = true;
        statsErrored = stats.isError;
        observe('exec_ms', stats.durationMs);
        const enriched = {
          ...stats,
          queueWaitMs,
          totalMs: Math.max(0, Date.now() - now),
          sendMs,
        } as T;
        callback?.(enriched);
      };
    },
    wrapReply<T extends (text: string) => Promise<void>>(reply: T): T {
      return (async (text: string) => {
        const before = Date.now();
        try {
          await reply(text);
        } finally {
          const elapsed = Math.max(0, Date.now() - before);
          sendMs += elapsed;
          observe('send_ms', elapsed);
        }
      }) as T;
    },
    settle(error?: unknown): void {
      if (settled) return;
      settled = true;
      if (startedAtMs == null) {
        gauges.queued_turns = Math.max(0, gauges.queued_turns - 1);
      } else {
        gauges.active_turns = Math.max(0, gauges.active_turns - 1);
      }
      incrementCounter('turns_total');
      if (error != null || !sawStats || statsErrored) {
        incrementCounter('turn_errors_total');
      }
      observe('turn_total_ms', Math.max(0, Date.now() - now));
    },
  };
}

export function turnAggregates(rows: TurnAggregateRow[]) {
  const current = rows.filter((row) => row.totalMs != null);
  const waits = current.map((row) => row.waitMs);
  const totals = current.map((row) => row.totalMs ?? 0);
  const execs = current.map((row) => row.execMs);
  return {
    count: current.length,
    waitP50Ms: percentile(waits, 50),
    waitP95Ms: percentile(waits, 95),
    totalP50Ms: percentile(totals, 50),
    totalP95Ms: percentile(totals, 95),
    execP50Ms: percentile(execs, 50),
    execP95Ms: percentile(execs, 95),
    errorRatePct:
      current.length > 0
        ? (100 * current.filter((row) => row.isError).length) /
          current.length
        : 0,
  };
}

function sampleProcess(): void {
  const memory = process.memoryUsage();
  const rssMb = memory.rss / 1024 / 1024;
  if (initialRssMb === 0) initialRssMb = rssMb;
  gauges.rss_mb = rssMb;
  gauges.heap_used_mb = memory.heapUsed / 1024 / 1024;
  gauges.rss_growth_mb = rssMb - initialRssMb;
  if (loopDelay) {
    gauges.event_loop_lag_p95_ms =
      Number(loopDelay.percentile(95)) / 1_000_000;
    gauges.event_loop_lag_max_ms = Number(loopDelay.max) / 1_000_000;
    loopDelay.reset();
  }
}

export function startSamplers(): void {
  if (sampler) return;
  loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  sampleProcess();
  sampler = setInterval(sampleProcess, SAMPLE_INTERVAL_MS);
  sampler.unref();
}

export function metricsSnapshot(): MetricsSnapshot {
  return {
    ts: new Date().toISOString(),
    startedAt,
    uptimeSec: process.uptime(),
    pid: process.pid,
    gauges: { ...gauges },
    counters: { ...counters },
    backendErrorsByStatus: { ...backendErrorsByStatus },
    histograms: {
      turn_total_ms: summarize(histograms.turn_total_ms),
      queue_wait_ms: summarize(histograms.queue_wait_ms),
      exec_ms: summarize(histograms.exec_ms),
      send_ms: summarize(histograms.send_ms),
    },
  };
}

/** Tests only: reset mutable state and stop samplers so Vitest has no leaked handles. */
export function _resetForTests(): void {
  if (sampler) clearInterval(sampler);
  sampler = null;
  loopDelay?.disable();
  loopDelay = null;
  initialRssMb = 0;
  for (const name of COUNTER_NAMES) counters[name] = 0;
  for (const key of Object.keys(backendErrorsByStatus)) {
    delete backendErrorsByStatus[key];
  }
  for (const values of Object.values(histograms)) values.length = 0;
  Object.assign(gauges, {
    active_turns: 0,
    queued_turns: 0,
    active_vision: 0,
    active_subprocesses: 0,
    rss_mb: 0,
    heap_used_mb: 0,
    rss_growth_mb: 0,
    event_loop_lag_p95_ms: 0,
    event_loop_lag_max_ms: 0,
  });
}
