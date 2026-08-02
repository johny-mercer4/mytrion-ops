import { describe, expect, it } from 'vitest';
import { ProviderBusyError, ProviderGuard } from '../../src/lib/providerGuard.js';

describe('ProviderGuard', () => {
  it('bounds concurrent Zoho work and releases queued calls', async () => {
    const guard = new ProviderGuard();
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const calls = Array.from({ length: 6 }, (_, index) =>
      guard.run('zoho_crm', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return index;
      }),
    );

    await Promise.resolve();
    expect(peak).toBe(4);
    while (releases.length) {
      releases.shift()?.();
      await Promise.resolve();
    }
    await expect(Promise.all(calls)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('opens a circuit after repeated provider failures', async () => {
    const guard = new ProviderGuard();
    for (let index = 0; index < 5; index += 1) {
      await expect(guard.run('server_crm', async () => {
        throw new Error('upstream failed');
      })).rejects.toThrow('upstream failed');
    }
    let called = false;
    await expect(guard.run('server_crm', async () => {
      called = true;
      return 'unexpected';
    })).rejects.toBeInstanceOf(ProviderBusyError);
    expect(called).toBe(false);
  });
});
