import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const RING_MAX = 2048;
const SAMPLE_INTERVAL_MS = 15_000;
const startedAt = new Date().toISOString();

export type CounterName =
  | 'turns_total'
  | 'turn_errors_total'
  | 'turn_rejected_total'
  | 'openai_429_total'
  | 'openai_error_total'
  | 'tg_429_total'
  | 'tg_send_fail_total'
  | 'tg_poll_fail_total'
  | 'backend_error_total'
  | 'tool_unknown_total'
  | 'tool_invalid_args_total'
  | 'vision_turns_total';

const COUNTERS: CounterName[] = [
  'turns_total',
  'turn_errors_total',
  'turn_rejected_total',
  'openai_429_total',
  'openai_error_total',
  'tg_429_total',
  'tg_send_fail_total',
  'tg_poll_fail_total',
  'backend_error_total',
  'tool_unknown_total',
  'tool_invalid_args_total',
  'vision_turns_total',
];

type HistogramName = 'turn_total_ms' | 'queue_wait_ms' | 'exec_ms' | 'send_ms';

interface HistogramSummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

interface Gauges {
  active_turns: number;
  queued_turns: number;
  active_vision: number;
  rss_mb: number;
  heap_used_mb: number;
  rss_growth_mb: number;
  event_loop_lag_p95_ms: number;
  event_loop_lag_max_ms: number;
}

export interface MetricsSnapshot {
  ts: string;
  startedAt: string;
  uptimeSec: number;
  pid: number;
  gauges: Gauges;
  counters: Record<CounterName, number>;
  histograms: Record<HistogramName, HistogramSummary>;
}

export interface MetricTurnStats {
  durationMs: number;
  isError: boolean;
  queueWaitMs?: number;
  totalMs?: number;
  sendMs?: number;
}

export interface TurnLifecycle {
  started(): number;
  wrapStats<T extends MetricTurnStats>(
    callback?: (stats: T) => void,
  ): (stats: T) => void;
  wrapReply<T extends (text: string) => Promise<void>>(reply: T): T;
  settle(error?: unknown): void;
}

const counters = Object.fromEntries(
  COUNTERS.map((name) => [name, 0]),
) as Record<CounterName, number>;
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
  rss_mb: 0,
  heap_used_mb: 0,
  rss_growth_mb: 0,
  event_loop_lag_p95_ms: 0,
  event_loop_lag_max_ms: 0,
};

let initialRssMb = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
let loopDelay: IntervalHistogram | null = null;

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor((Math.max(0, Math.min(100, p)) / 100) * sorted.length),
  );
  return sorted[index] ?? 0;
}

function observe(name: HistogramName, value: number): void {
  if (!Number.isFinite(value)) return;
  const ring = histograms[name];
  ring.push(Math.max(0, value));
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function summarize(values: readonly number[]): HistogramSummary {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: percentile(values, 100),
  };
}

export function incrementCounter(name: CounterName, amount = 1): void {
  counters[name] += amount;
}

export function visionStarted(): () => void {
  incrementCounter('vision_turns_total');
  gauges.active_vision += 1;
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    gauges.active_vision = Math.max(0, gauges.active_vision - 1);
  };
}

export function turnEnqueued(now = Date.now()): TurnLifecycle {
  gauges.queued_turns += 1;
  let startedAt: number | null = null;
  let queueWaitMs = 0;
  let sendMs = 0;
  let sawStats = false;
  let statsErrored = false;
  let settled = false;

  return {
    started(): number {
      if (startedAt !== null) return queueWaitMs;
      startedAt = Date.now();
      queueWaitMs = Math.max(0, startedAt - now);
      gauges.queued_turns = Math.max(0, gauges.queued_turns - 1);
      gauges.active_turns += 1;
      observe('queue_wait_ms', queueWaitMs);
      return queueWaitMs;
    },
    wrapStats<T extends MetricTurnStats>(
      callback?: (stats: T) => void,
    ): (stats: T) => void {
      return (stats: T): void => {
        sawStats = true;
        statsErrored = stats.isError;
        observe('exec_ms', stats.durationMs);
        callback?.({
          ...stats,
          queueWaitMs,
          totalMs: Math.max(0, Date.now() - now),
          sendMs,
        });
      };
    },
    wrapReply<T extends (text: string) => Promise<void>>(reply: T): T {
      return (async (text: string) => {
        const before = Date.now();
        try {
          await reply(text);
        } finally {
          const duration = Math.max(0, Date.now() - before);
          sendMs += duration;
          observe('send_ms', duration);
        }
      }) as T;
    },
    settle(error?: unknown): void {
      if (settled) return;
      settled = true;
      if (startedAt === null) {
        gauges.queued_turns = Math.max(0, gauges.queued_turns - 1);
      } else {
        gauges.active_turns = Math.max(0, gauges.active_turns - 1);
      }
      incrementCounter('turns_total');
      if (error !== undefined || !sawStats || statsErrored) {
        incrementCounter('turn_errors_total');
      }
      observe('turn_total_ms', Math.max(0, Date.now() - now));
    },
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
    gauges.event_loop_lag_p95_ms = Number(loopDelay.percentile(95)) / 1_000_000;
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
    histograms: {
      turn_total_ms: summarize(histograms.turn_total_ms),
      queue_wait_ms: summarize(histograms.queue_wait_ms),
      exec_ms: summarize(histograms.exec_ms),
      send_ms: summarize(histograms.send_ms),
    },
  };
}

export function resetMetricsForTests(): void {
  if (sampler) clearInterval(sampler);
  sampler = null;
  loopDelay?.disable();
  loopDelay = null;
  initialRssMb = 0;
  for (const name of COUNTERS) counters[name] = 0;
  for (const values of Object.values(histograms)) values.length = 0;
  Object.assign(gauges, {
    active_turns: 0,
    queued_turns: 0,
    active_vision: 0,
    rss_mb: 0,
    heap_used_mb: 0,
    rss_growth_mb: 0,
    event_loop_lag_p95_ms: 0,
    event_loop_lag_max_ms: 0,
  });
}
