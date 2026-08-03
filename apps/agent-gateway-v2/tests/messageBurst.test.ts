import { describe, expect, it } from 'vitest';
import { MessageBurstBuffer } from '../src/messageBurst.js';
import { messageCollectionQuietMs } from '../src/messageCollection.js';

describe('Telegram message burst aggregation', () => {
  it('preserves fragments from one user as one request', async () => {
    const flushed: number[][] = [];
    const buffer = new MessageBurstBuffer<number>({
      quietMs: 1_000,
      maxWaitMs: 5_000,
      onFlush: (items) => {
        flushed.push([...items]);
      },
    });

    buffer.push('chat:user-a', 1);
    buffer.push('chat:user-a', 2);
    buffer.push('chat:user-a', 3);
    await buffer.flush('chat:user-a');

    expect(flushed).toEqual([[1, 2, 3]]);
  });

  it('isolates different users in the same group', async () => {
    const flushed: string[][] = [];
    const buffer = new MessageBurstBuffer<string>({
      quietMs: 1_000,
      maxWaitMs: 5_000,
      onFlush: (items) => {
        flushed.push([...items]);
      },
    });

    buffer.push('chat:user-a', 'a1');
    buffer.push('chat:user-b', 'b1');
    buffer.push('chat:user-a', 'a2');
    await buffer.flush('chat:user-b');
    await buffer.flush('chat:user-a');

    expect(flushed).toEqual([['b1'], ['a1', 'a2']]);
  });

  it('flushes after the user stops typing', async () => {
    let resolveFlush: (() => void) | undefined;
    const flushed = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    const buffer = new MessageBurstBuffer<string>({
      quietMs: 5,
      maxWaitMs: 100,
      onFlush: () => resolveFlush?.(),
    });

    buffer.push('chat:user-a', 'hello');
    await flushed;

    expect(buffer.has('chat:user-a')).toBe(false);
  });

  it('can hold incomplete fragments longer than actionable bursts', async () => {
    const observedSizes: number[] = [];
    const buffer = new MessageBurstBuffer<string>({
      quietMs: 5,
      maxWaitMs: 100,
      quietMsFor: (items) => {
        observedSizes.push(items.length);
        return items.includes('action') ? 5 : 50;
      },
      onFlush: () => undefined,
    });

    buffer.push('chat:user-a', '333 Isomiddin');
    buffer.push('chat:user-a', 'action');
    await buffer.flush('chat:user-a');

    expect(observedSizes).toEqual([1, 2]);
  });
});

describe('Telegram intent-aware collection timing', () => {
  it('holds greetings and report leads for likely follow-up details', () => {
    expect(messageCollectionQuietMs(['Assalom aleykum'], 3_000)).toBe(10_000);
    expect(messageCollectionQuietMs(['Truck 040 ni statement kerak'], 3_000)).toBe(10_000);
  });

  it('keeps a multi-message request open after every new fragment', () => {
    expect(
      messageCollectionQuietMs(
        ['Truck 040 ni statement kerak', '05/03/2026-05/05/2026 kerak'],
        3_000,
      ),
    ).toBe(7_000);
  });

  it('does not delay an ordinary complete request beyond the configured quiet time', () => {
    expect(messageCollectionQuietMs(['check my balance'], 3_000)).toBe(3_000);
  });
});
