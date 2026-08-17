/**
 * auditSessionEvent — the collapse rule behind the Logins view.
 *
 * These pin the behaviour that made `auth.act_as` readable again: the same `ok` fact, restated by
 * every request a session makes, becomes ONE row per window; a `denied` outcome never collapses;
 * and a cold in-process key still defers to the table before writing, so a restart cannot reopen
 * the flood. The audit writer and the repo are mocked — no DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));
vi.mock('../../src/repos/auditRepo.js', () => ({
  auditRepo: { existsSince: vi.fn(async () => false), insert: vi.fn(), list: vi.fn(), count: vi.fn() },
}));

import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { auditRepo } from '../../src/repos/auditRepo.js';
import {
  auditSessionEvent,
  resetSessionEventCache,
} from '../../src/modules/audit/sessionEvents.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const write = vi.mocked(auditFromContext);
const repo = vi.mocked(auditRepo);

let seq = 0;
/** Unique principal per case so one test's throttle key cannot silence the next. */
function ctx(over: Partial<TenantContext> = {}): TenantContext {
  seq += 1;
  return {
    tenantId: 'octane',
    userId: `zoho:u${seq}`,
    audience: 'internal',
    role: 'admin',
    scopes: [],
    departments: [],
    allDepartmentAccess: true,
    requestId: `r${seq}`,
    ...over,
  } as TenantContext;
}

beforeEach(() => {
  resetSessionEventCache();
  write.mockReset().mockResolvedValue(undefined);
  repo.existsSince.mockReset().mockResolvedValue(false);
});

describe('auditSessionEvent', () => {
  it('writes the first ok row and collapses the repeats', async () => {
    const c = ctx();
    const first = await auditSessionEvent(c, { action: 'auth.act_as', status: 'ok' });
    const second = await auditSessionEvent(c, { action: 'auth.act_as', status: 'ok' });
    const third = await auditSessionEvent(c, { action: 'auth.act_as', status: 'ok' });

    expect([first, second, third]).toEqual([true, false, false]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('never collapses a denied outcome — every refusal is its own event', async () => {
    const c = ctx();
    await auditSessionEvent(c, { action: 'auth.act_as', status: 'denied' });
    await auditSessionEvent(c, { action: 'auth.act_as', status: 'denied' });

    expect(write).toHaveBeenCalledTimes(2);
    expect(repo.existsSince).not.toHaveBeenCalled(); // denied must not even pay for the lookback
  });

  it('keys the collapse on the resource, so two Mytrions both log', async () => {
    const c = ctx();
    const sales = await auditSessionEvent(c, {
      action: 'mytrion.access',
      status: 'ok',
      resourceId: 'sales',
    });
    const hr = await auditSessionEvent(c, {
      action: 'mytrion.access',
      status: 'ok',
      resourceId: 'hr',
    });
    const salesAgain = await auditSessionEvent(c, {
      action: 'mytrion.access',
      status: 'ok',
      resourceId: 'sales',
    });

    expect([sales, hr, salesAgain]).toEqual([true, true, false]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('keys the collapse on the actor, so a second user still logs', async () => {
    await auditSessionEvent(ctx(), { action: 'auth.act_as', status: 'ok' });
    await auditSessionEvent(ctx(), { action: 'auth.act_as', status: 'ok' });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('defers to the table on a cold key — a restart does not reopen the flood', async () => {
    // Simulates a fresh process: the in-memory gate is empty, but the row is already in the table.
    repo.existsSince.mockResolvedValue(true);
    const wrote = await auditSessionEvent(ctx(), { action: 'auth.act_as', status: 'ok' });

    expect(wrote).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(repo.existsSince).toHaveBeenCalledTimes(1);
  });

  it('writes rather than drops when the lookback query fails', async () => {
    // The lookback is an optimisation, not the gate: a duplicate row is recoverable, a silently
    // dropped audit row is not.
    repo.existsSince.mockRejectedValue(new Error('connection reset'));
    const wrote = await auditSessionEvent(ctx(), { action: 'auth.act_as', status: 'ok' });

    expect(wrote).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('passes the resource and detail through to the audit row', async () => {
    await auditSessionEvent(ctx({ userId: 'zoho:42' }), {
      action: 'mytrion.access',
      status: 'ok',
      resourceType: 'mytrion',
      resourceId: 'sales',
      detail: { mytrion: 'sales', granted: true },
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:42' }),
      expect.objectContaining({
        action: 'mytrion.access',
        status: 'ok',
        resourceType: 'mytrion',
        resourceId: 'sales',
        detail: { mytrion: 'sales', granted: true },
      }),
    );
  });

  it('lets the window expire', async () => {
    const c = ctx();
    await auditSessionEvent(c, { action: 'auth.act_as', status: 'ok', windowMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const again = await auditSessionEvent(c, { action: 'auth.act_as', status: 'ok', windowMs: 1 });

    expect(again).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
