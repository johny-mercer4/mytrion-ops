import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireTurnSlot,
  activeTurnCount,
  maxConcurrentTurns,
  releaseTurnSlot,
  resetTurnConcurrencyForTests,
  waitingTurnCount,
} from '../src/turnConcurrency.js';

afterEach(() => resetTurnConcurrencyForTests());

describe('global turn concurrency', () => {
  it('caps active work and transfers released slots in FIFO order', async () => {
    const limit = maxConcurrentTurns();
    await Promise.all(Array.from({ length: limit }, () => acquireTurnSlot()));
    expect(activeTurnCount()).toBe(limit);

    const order: number[] = [];
    const first = acquireTurnSlot().then(() => order.push(1));
    const second = acquireTurnSlot().then(() => order.push(2));
    await Promise.resolve();
    expect(waitingTurnCount()).toBe(2);

    releaseTurnSlot();
    await first;
    expect(order).toEqual([1]);
    expect(activeTurnCount()).toBe(limit);

    releaseTurnSlot();
    await second;
    expect(order).toEqual([1, 2]);

    for (let index = 0; index < limit; index += 1) releaseTurnSlot();
    expect(activeTurnCount()).toBe(0);
    expect(waitingTurnCount()).toBe(0);
  });
});
