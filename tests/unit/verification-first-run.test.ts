import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { decideFirstRunAction, nextFirstRunStep } from '../../src/modules/verification/firstRunDecision.js';
import { driveFirstRun, type FirstRunPorts } from '../../src/modules/verification/firstRunTrigger.js';
import type { FirstRunPersisted } from '../../src/modules/verification/firstRunDecision.js';

const idle: FirstRunPersisted = { status: 'idle', step: null, inboxId: null, error: null };

function ports(overrides: Partial<FirstRunPorts> = {}): FirstRunPorts {
  return {
    insertPayloadPatch: vi.fn(async () => ({ id: 11 })),
    insertRunStage: vi.fn(async () => ({ id: 22 })),
    getInboxUpdate: vi.fn(async () => ({ status: 'pending', error: null })),
    waitForInboxSettled: vi.fn(async () => ({ status: 'applied' as const })),
    ...overrides,
  };
}

describe('first-run decision', () => {
  it('no-ops when completed or in-flight pending', () => {
    expect(
      decideFirstRunAction({
        state: { status: 'completed', step: 'fmcsa', inboxId: 9, error: null },
        inboxStatus: 'applied',
      }),
    ).toEqual({ type: 'noop', reason: 'completed' });
    expect(
      decideFirstRunAction({
        state: { status: 'in_flight', step: 'patch', inboxId: 1, error: null },
        inboxStatus: 'pending',
      }),
    ).toEqual({ type: 'noop', reason: 'in_flight_pending' });
  });

  it('stops on inbox error and does not enqueue the next stage', () => {
    expect(
      decideFirstRunAction({
        state: { status: 'in_flight', step: 'blacklist', inboxId: 3, error: null },
        inboxStatus: 'error',
        inboxError: 'owned by admin',
      }),
    ).toEqual({ type: 'record_error', error: 'owned by admin' });
  });

  it('advances only after applied', () => {
    expect(nextFirstRunStep('patch')).toBe('stop_factor_pre');
    expect(
      decideFirstRunAction({
        state: { status: 'in_flight', step: 'patch', inboxId: 1, error: null },
        inboxStatus: 'applied',
      }),
    ).toEqual({ type: 'enqueue', step: 'stop_factor_pre' });
    expect(
      decideFirstRunAction({
        state: { status: 'in_flight', step: 'fmcsa', inboxId: 4, error: null },
        inboxStatus: 'applied',
      }),
    ).toEqual({ type: 'complete' });
  });
});

describe('driveFirstRun sequence', () => {
  it('enqueues patch then stages one at a time after each applied', async () => {
    const stageIds: string[] = [];
    const saved: FirstRunPersisted[] = [];
    const testPorts = ports({
      insertPayloadPatch: vi.fn(async () => ({ id: 1 })),
      insertRunStage: vi.fn(async (input) => {
        stageIds.push(input.stageId);
        return { id: stageIds.length + 1 };
      }),
      getInboxUpdate: vi.fn(async () => ({ status: 'applied', error: null })),
      waitForInboxSettled: vi.fn(async () => ({ status: 'applied' as const })),
    });

    const result = await driveFirstRun({
      requestId: 'req-1',
      agent: 'system',
      patch: { dot_number: '1234567', state: 'TX' },
      state: idle,
      wait: true,
      save: async (next) => {
        saved.push(next);
      },
      ports: testPorts,
    });

    expect(result.status).toBe('completed');
    expect(testPorts.insertPayloadPatch).toHaveBeenCalledTimes(1);
    expect(stageIds).toEqual(['stop_factor_pre', 'blacklist', 'fmcsa']);
    expect(saved.some((row) => row.step === 'stop_factor_pre' && row.status === 'in_flight')).toBe(true);
    expect(saved[saved.length - 1]?.status).toBe('completed');
  });

  it('does not enqueue the next stage while the current inbox row is pending', async () => {
    const testPorts = ports({
      insertPayloadPatch: vi.fn(async () => ({ id: 7 })),
      getInboxUpdate: vi.fn(async () => ({ status: 'pending', error: null })),
      waitForInboxSettled: vi.fn(async () => ({
        status: 'timeout' as const,
        error: 'inbox row 7 not applied (timeout)',
      })),
    });

    const result = await driveFirstRun({
      requestId: 'req-1',
      agent: 'system',
      patch: { dot_number: '1234567' },
      state: idle,
      wait: true,
      save: async () => undefined,
      ports: testPorts,
    });

    expect(result.status).toBe('in_flight');
    expect(result.reason).toBe('poll_timeout');
    expect(testPorts.insertRunStage).not.toHaveBeenCalled();
  });

  it('second call no-ops when already completed', async () => {
    const testPorts = ports();
    const result = await driveFirstRun({
      requestId: 'req-1',
      agent: 'system',
      patch: { dot_number: '1' },
      state: { status: 'completed', step: 'fmcsa', inboxId: 9, error: null },
      wait: true,
      save: async () => {
        throw new Error('should not persist');
      },
      ports: testPorts,
    });
    expect(result.status).toBe('completed');
    expect(testPorts.insertPayloadPatch).not.toHaveBeenCalled();
    expect(testPorts.insertRunStage).not.toHaveBeenCalled();
  });

  it('second call no-ops while the current inbox row is still pending', async () => {
    const testPorts = ports({
      getInboxUpdate: vi.fn(async () => ({ status: 'pending', error: null })),
    });
    const result = await driveFirstRun({
      requestId: 'req-1',
      agent: 'system',
      patch: { dot_number: '1' },
      state: { status: 'in_flight', step: 'blacklist', inboxId: 3, error: null },
      wait: false,
      save: async () => {
        throw new Error('should not persist');
      },
      ports: testPorts,
    });
    expect(result.status).toBe('in_flight');
    expect(testPorts.insertPayloadPatch).not.toHaveBeenCalled();
    expect(testPorts.insertRunStage).not.toHaveBeenCalled();
  });

  it('records inbox error and stops', async () => {
    const saved: FirstRunPersisted[] = [];
    const result = await driveFirstRun({
      requestId: 'req-1',
      agent: 'system',
      patch: { dot_number: '1' },
      state: { status: 'in_flight', step: 'fmcsa', inboxId: 4, error: null },
      wait: true,
      save: async (next) => {
        saved.push(next);
      },
      ports: ports({
        getInboxUpdate: vi.fn(async () => ({ status: 'error', error: 'request is owned by admin' })),
      }),
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('request is owned by admin');
    expect(saved[0]?.status).toBe('error');
  });

  it('never claims a case and never POSTs /api/v1/requests', () => {
    const trigger = readFileSync(new URL('../../src/modules/verification/firstRunTrigger.ts', import.meta.url), 'utf8');
    const decision = readFileSync(new URL('../../src/modules/verification/firstRunDecision.ts', import.meta.url), 'utf8');
    expect(trigger).not.toContain('claimManualReview');
    expect(trigger).not.toContain('/api/v1/requests');
    expect(decision).not.toContain('claimManualReview');
    expect(decision).not.toContain('/api/v1/requests');
  });
});
