import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTests,
  incrementCounter,
  metricsSnapshot,
  noteBackendError,
  percentile,
  subprocessStarted,
  turnAggregates,
  turnEnqueued,
  visionStarted,
} from '../../apps/agent-gateway/src/metrics.js';

describe('agent-gateway metrics', () => {
  beforeEach(() => {
    _resetForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetForTests();
  });

  it('matches the stress-harness nearest-rank percentile behavior', () => {
    expect(percentile([40, 10, 30, 20], 50)).toBe(30);
    expect(percentile([40, 10, 30, 20], 95)).toBe(40);
    expect(percentile([], 95)).toBe(0);
  });

  it('tracks queue, active, reply, stats and settlement lifecycle', async () => {
    const lifecycle = turnEnqueued();
    expect(metricsSnapshot().gauges.queued_turns).toBe(1);

    vi.advanceTimersByTime(25);
    expect(lifecycle.started()).toBe(25);
    expect(metricsSnapshot().gauges).toMatchObject({
      queued_turns: 0,
      active_turns: 1,
    });

    let observed:
      | {
          durationMs: number;
          isError: boolean;
          marker: string;
          queueWaitMs?: number;
          totalMs?: number;
          sendMs?: number;
        }
      | undefined;
    const stats = lifecycle.wrapStats<{
      durationMs: number;
      isError: boolean;
      marker: string;
      queueWaitMs?: number;
      totalMs?: number;
      sendMs?: number;
    }>((value) => {
      observed = value;
    });
    const reply = lifecycle.wrapReply(async (_text: string) => {
      await vi.advanceTimersByTimeAsync(7);
    });
    await reply('ok');
    vi.advanceTimersByTime(18);
    stats({ durationMs: 30, isError: false, marker: 'preserved' });
    lifecycle.settle();

    expect(observed).toMatchObject({
      marker: 'preserved',
      queueWaitMs: 25,
      totalMs: 50,
      sendMs: 7,
    });
    const snapshot = metricsSnapshot();
    expect(snapshot.gauges.active_turns).toBe(0);
    expect(snapshot.counters.turns_total).toBe(1);
    expect(snapshot.counters.turn_errors_total).toBe(0);
    expect(snapshot.histograms.turn_total_ms.max).toBe(50);
    expect(snapshot.histograms.send_ms.max).toBe(7);
  });

  it('classifies settle-without-stats as an errored turn', () => {
    const lifecycle = turnEnqueued();
    lifecycle.started();
    lifecycle.settle(new Error('boom'));
    lifecycle.settle(new Error('ignored duplicate settle'));

    expect(metricsSnapshot().counters).toMatchObject({
      turns_total: 1,
      turn_errors_total: 1,
    });
  });

  it('evicts old histogram samples at the ring bound', () => {
    for (let i = 0; i < 2055; i++) {
      const lifecycle = turnEnqueued();
      lifecycle.started();
      vi.advanceTimersByTime(1);
      lifecycle.settle();
    }
    expect(metricsSnapshot().histograms.turn_total_ms.count).toBe(2048);
  });

  it('keeps old monitor rows out of new total/wait aggregates', () => {
    const aggregates = turnAggregates([
      { waitMs: 9999, execMs: 5, isError: false },
      { waitMs: 10, execMs: 20, totalMs: 35, isError: false },
      { waitMs: 30, execMs: 40, totalMs: 80, isError: true },
    ]);
    expect(aggregates).toMatchObject({
      count: 2,
      waitP50Ms: 30,
      waitP95Ms: 30,
      totalP50Ms: 80,
      totalP95Ms: 80,
      errorRatePct: 50,
    });
  });

  it('returns immutable snapshots and balanced subprocess gauges', () => {
    incrementCounter('tg_429_total');
    const settleMain = subprocessStarted();
    const settleVision = visionStarted();
    const first = metricsSnapshot();
    first.counters.tg_429_total = 999;
    first.gauges.active_subprocesses = 999;

    expect(metricsSnapshot().counters.tg_429_total).toBe(1);
    expect(metricsSnapshot().gauges).toMatchObject({
      active_subprocesses: 2,
      active_vision: 1,
    });
    settleVision();
    settleMain();
    expect(metricsSnapshot().gauges).toMatchObject({
      active_subprocesses: 0,
      active_vision: 0,
    });
  });

  it('classifies backend safety errors without losing status totals', () => {
    noteBackendError(409, 'SUPPORT_BOT_IDEMPOTENCY_CONFLICT');
    noteBackendError(409, 'SUPPORT_BOT_OPERATION_OUTCOME_UNKNOWN');
    noteBackendError(409, 'SUPPORT_BOT_STALE_FENCE');
    noteBackendError(0, 'BACKEND_TRANSPORT_ERROR');

    const snapshot = metricsSnapshot();
    expect(snapshot.counters).toMatchObject({
      backend_error_total: 4,
      idempotency_conflict_total: 1,
      operation_unknown_total: 1,
      stale_fence_total: 1,
    });
    expect(snapshot.backendErrorsByStatus).toEqual({
      '0': 1,
      '409': 3,
    });
  });
});
