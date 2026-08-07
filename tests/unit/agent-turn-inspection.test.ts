import { describe, expect, it, vi } from 'vitest';
import type { SSEStream } from '../../src/modules/chat/streaming.js';
import { createTurnTraceEmitter } from '../../src/modules/agents/turnInspection.js';
import { makeContext } from '../fixtures/seed.js';

function stream(): { sse: SSEStream; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  return {
    send,
    sse: { send, comment: vi.fn(), close: vi.fn() },
  };
}

describe('admin Turn Inspector trace boundary', () => {
  it('emits structured runtime diagnostics for an administrator', () => {
    const { sse, send } = stream();
    const emit = createTurnTraceEmitter(
      makeContext({ role: 'admin', allDepartmentAccess: true }),
      sse,
      'run-1',
    );
    emit?.({ stage: 'route', status: 'complete', label: 'Routed', model: 'gpt-test' });
    expect(send).toHaveBeenCalledWith('trace', expect.objectContaining({ runId: 'run-1', model: 'gpt-test' }));
  });

  it('does not expose diagnostic events to an ordinary scoped worker', () => {
    const { sse, send } = stream();
    const emit = createTurnTraceEmitter(
      makeContext({ role: 'worker', departments: ['sales'], allDepartmentAccess: false }),
      sse,
      'run-2',
    );
    expect(emit).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
