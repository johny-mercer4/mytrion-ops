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
  it('caps active work and transfers released slots in carrier-fair order', async () => {
    const limit = maxConcurrentTurns();
    const activeCarriers = Array.from({ length: limit }, (_, index) => `carrier-${index}`);
    await Promise.all(activeCarriers.map((carrierId) => acquireTurnSlot(carrierId)));
    expect(activeTurnCount()).toBe(limit);

    const order: string[] = [];
    const noisyFirst = acquireTurnSlot('carrier-0').then(() => order.push('noisy-1'));
    const noisySecond = acquireTurnSlot('carrier-0').then(() => order.push('noisy-2'));
    const quiet = acquireTurnSlot('quiet').then(() => order.push('quiet'));
    await Promise.resolve();
    expect(waitingTurnCount()).toBe(3);

    releaseTurnSlot('carrier-2');
    await noisyFirst;
    expect(order).toEqual(['noisy-1']);
    expect(activeTurnCount()).toBe(limit);

    releaseTurnSlot('carrier-3');
    await quiet;
    expect(order).toEqual(['noisy-1', 'quiet']);

    releaseTurnSlot('carrier-0');
    await noisySecond;
    expect(order).toEqual(['noisy-1', 'quiet', 'noisy-2']);

    expect(waitingTurnCount()).toBe(0);
  });

  it('removes a stale request from the waiting queue', async () => {
    const limit = maxConcurrentTurns();
    const carriers = Array.from({ length: limit }, (_, index) => `carrier-${index}`);
    await Promise.all(carriers.map((carrierId) => acquireTurnSlot(carrierId)));
    await expect(acquireTurnSlot('waiting', Date.now() + 5)).rejects.toMatchObject({
      kind: 'stale',
    });
    expect(waitingTurnCount()).toBe(0);
    carriers.forEach((carrierId) => releaseTurnSlot(carrierId));
  });
});
