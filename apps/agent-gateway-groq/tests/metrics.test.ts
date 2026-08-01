import { afterEach, describe, expect, it } from 'vitest';
import {
  incrementCounter,
  metricsSnapshot,
  resetMetricsForTests,
  turnEnqueued,
} from '../src/metrics.js';

afterEach(() => resetMetricsForTests());

describe('runtime metrics', () => {
  it('tracks queue, execution, send, error, and provider counters', async () => {
    const lifecycle = turnEnqueued(Date.now() - 5);
    expect(metricsSnapshot().gauges.queued_turns).toBe(1);

    lifecycle.started();
    const reply = lifecycle.wrapReply(async (_text: string) => undefined);
    const stats = lifecycle.wrapStats(() => undefined);
    await reply('ok');
    stats({ durationMs: 12, isError: false });
    lifecycle.settle();
    incrementCounter('openai_429_total');
    incrementCounter('ambient_engagement_total');
    incrementCounter('greeting_fast_path_total');
    incrementCounter('message_burst_total');
    incrementCounter('message_burst_messages_total', 4);

    const snapshot = metricsSnapshot();
    expect(snapshot.gauges.active_turns).toBe(0);
    expect(snapshot.gauges.queued_turns).toBe(0);
    expect(snapshot.counters.turns_total).toBe(1);
    expect(snapshot.counters.turn_errors_total).toBe(0);
    expect(snapshot.counters.openai_429_total).toBe(1);
    expect(snapshot.counters.ambient_engagement_total).toBe(1);
    expect(snapshot.counters.greeting_fast_path_total).toBe(1);
    expect(snapshot.counters.message_burst_total).toBe(1);
    expect(snapshot.counters.message_burst_messages_total).toBe(4);
    expect(snapshot.histograms.exec_ms.count).toBe(1);
    expect(snapshot.histograms.queue_wait_ms.count).toBe(1);
    expect(snapshot.histograms.send_ms.count).toBe(1);
  });

  it('counts a settled lifecycle without stats as an error', () => {
    const lifecycle = turnEnqueued();
    lifecycle.started();
    lifecycle.settle(new Error('failed'));
    expect(metricsSnapshot().counters.turn_errors_total).toBe(1);
  });
});
