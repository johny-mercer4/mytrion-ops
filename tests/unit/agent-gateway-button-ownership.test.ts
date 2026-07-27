import { describe, expect, it } from 'vitest';
import {
  consumeButtonTap,
  noteButtonOwner,
} from '../../apps/agent-gateway/src/buttonOwnership.js';

describe('agent-gateway button ownership', () => {
  it('scopes identical Telegram message ids by chat', () => {
    noteButtonOwner(-1001, 42, 11, 1_000);
    noteButtonOwner(-1002, 42, 22, 1_000);

    expect(consumeButtonTap(-1001, 42, 11, 2_000)).toBe('allowed');
    expect(consumeButtonTap(-1002, 42, 22, 2_000)).toBe('allowed');
  });

  it('is single-use and rejects a replay', () => {
    noteButtonOwner(-1003, 43, 33, 1_000);
    expect(consumeButtonTap(-1003, 43, 33, 2_000)).toBe('allowed');
    expect(consumeButtonTap(-1003, 43, 33, 2_001)).toBe('unavailable');
  });

  it('rejects a different user without consuming the rightful owner action', () => {
    noteButtonOwner(-1004, 44, 44, 1_000);
    expect(consumeButtonTap(-1004, 44, 45, 2_000)).toBe('foreign');
    expect(consumeButtonTap(-1004, 44, 44, 2_001)).toBe('allowed');
  });

  it('fails closed for unknown and expired buttons', () => {
    expect(consumeButtonTap(-1005, 45, 55, 2_000)).toBe('unavailable');
    noteButtonOwner(-1005, 46, 55, 1_000);
    expect(consumeButtonTap(-1005, 46, 55, 1_000 + 10 * 60_000 + 1)).toBe(
      'unavailable',
    );
  });
});
