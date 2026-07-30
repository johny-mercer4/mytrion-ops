import { beforeEach, describe, expect, it } from 'vitest';
import {
  QueryStreamError,
  WRITE_RISK_TOOLS,
} from '../../apps/agent-gateway/src/retrySafety.js';
import {
  _resetForTests,
  metricsSnapshot,
} from '../../apps/agent-gateway/src/metrics.js';

describe('agent-gateway retry safety', () => {
  beforeEach(() => _resetForTests());

  it('classifies every state-changing support-bot tool as non-replayable', () => {
    expect([...WRITE_RISK_TOOLS].sort()).toEqual(
      [
        'mcp__octane__octane_card_action',
        'mcp__octane__octane_card_info',
        'mcp__octane__octane_card_limits',
        'mcp__octane__octane_manual_code',
        'mcp__octane__octane_money_code',
        'mcp__octane__octane_override',
        'mcp__octane__octane_service_request',
      ].sort(),
    );
  });

  it('carries the write marker when a streamed query throws', () => {
    const error = new QueryStreamError(new Error('connection lost'), true);
    expect(error.message).toBe('connection lost');
    expect(error.usedWriteTool).toBe(true);
    expect(error.cause).toBeInstanceOf(Error);
    expect(
      metricsSnapshot().counters.provider_stream_throw_total,
    ).toBe(1);
  });
});
