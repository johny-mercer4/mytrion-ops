import { describe, expect, it } from 'vitest';
import { processInOrderByKey } from '../src/ingressOrder.js';

describe('Telegram ingress ordering', () => {
  it('preserves source order for one user despite different async latency', async () => {
    const completed: number[] = [];
    const delays = new Map([
      [1, 20],
      [2, 1],
      [3, 0],
    ]);

    await processInOrderByKey(
      [
        { id: 1, lane: 'chat:user-a' },
        { id: 2, lane: 'chat:user-a' },
        { id: 3, lane: 'chat:user-a' },
      ],
      (item) => item.lane,
      async (item) => {
        await new Promise((resolve) =>
          setTimeout(resolve, delays.get(item.id) ?? 0),
        );
        completed.push(item.id);
      },
    );

    expect(completed).toEqual([1, 2, 3]);
  });

  it('still starts different users concurrently', async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const running = processInOrderByKey(
      [
        { lane: 'chat:user-a' },
        { lane: 'chat:user-b' },
      ],
      (item) => item.lane,
      async (item) => {
        started.push(item.lane);
        if (item.lane === 'chat:user-a') await firstBlocked;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['chat:user-a', 'chat:user-b']);
    releaseFirst?.();
    await running;
  });
});
