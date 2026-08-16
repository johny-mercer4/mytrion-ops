import { describe, expect, it } from 'vitest';
import { afterHomeSnapshot, withHomeSnapshotGate } from './homeLoadGate';

describe('homeLoadGate', () => {
  it('holds later Home reads until the snapshot wave finishes', async () => {
    const order: string[] = [];
    let releaseSnap!: () => void;
    const snapBody = new Promise<void>((resolve) => {
      releaseSnap = resolve;
    });

    const snapshot = withHomeSnapshotGate(async () => {
      order.push('snap-start');
      await snapBody;
      order.push('snap-end');
      return 'snap';
    });
    const later = afterHomeSnapshot(async () => {
      order.push('later');
      return 'ann';
    });

    await Promise.resolve();
    expect(order).toEqual(['snap-start']);

    releaseSnap();
    await expect(snapshot).resolves.toBe('snap');
    await expect(later).resolves.toBe('ann');
    expect(order).toEqual(['snap-start', 'snap-end', 'later']);
  });

  it('does not block a later read when no snapshot is in flight', async () => {
    await expect(afterHomeSnapshot(async () => 'ready')).resolves.toBe('ready');
  });
});
