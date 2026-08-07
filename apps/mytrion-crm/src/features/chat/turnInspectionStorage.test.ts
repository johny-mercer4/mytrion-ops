import { beforeEach, describe, expect, it } from 'vitest';
import { getTurnInspection, removeTurnInspection, setTurnInspection } from './turnInspectionStorage';
import type { TurnInspection } from './useChat';

const inspection: TurnInspection = {
  turnId: 'turn-1',
  runId: 'run-1',
  active: true,
  startedAt: '2026-08-06T10:00:00.000Z',
  model: 'gpt-test',
  steps: [{ stage: 'model', status: 'complete', label: 'Model completed' }],
};

describe('Turn Inspector persistence', () => {
  beforeEach(() => localStorage.clear());

  it('restores the last structured trace for a conversation as completed', () => {
    setTurnInspection('u1', 'c1', inspection);
    expect(getTurnInspection('u1', 'c1')).toMatchObject({
      turnId: 'turn-1', runId: 'run-1', model: 'gpt-test', active: false,
    });
  });

  it('isolates traces by user and conversation and removes deleted ones', () => {
    setTurnInspection('u1', 'c1', inspection);
    expect(getTurnInspection('u2', 'c1')).toBeNull();
    expect(getTurnInspection('u1', 'c2')).toBeNull();
    removeTurnInspection('u1', 'c1');
    expect(getTurnInspection('u1', 'c1')).toBeNull();
  });
});
