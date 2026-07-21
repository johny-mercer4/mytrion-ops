/**
 * Carrier-ownership gate — `assertCarrierOwned` must resolve ownership through the SAME DWH
 * roster arms that feed the Clients tab (id-suffix first, name fallback, mutually exclusive),
 * never through servercrm's full-id by-agent lookup (the divergence that 403'd the Clients
 * modal for every non-admin). Also covers the probe SQL shape, the 60s result cache, and the
 * DWH-outage-is-502-not-RBAC contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: vi.fn(async () => []),
  getDwhPool: vi.fn(),
  closeDwhPool: vi.fn(async () => undefined),
}));
// The gate must never fall back to servercrm — mock it to prove no call escapes.
const serverCrmGet = vi.fn();
vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrmGet: (...args: unknown[]) => serverCrmGet(...args),
  serverCrmPost: vi.fn(),
}));

import { AppError, RBACError, ToolError } from '../../src/lib/errors.js';
import { dwhQuery } from '../../src/integrations/dwh.js';
import { isCarrierOwned } from '../../src/integrations/dwhClientRoster.js';
import {
  assertCarrierOwned,
  clearCarrierOwnershipCache,
} from '../../src/modules/tools/serverCrmScope.js';
import { listTouchpoints } from '../../src/modules/touchpoints/catalog/index.js';
import { makeContext } from '../fixtures/seed.js';

const query = vi.mocked(dwhQuery);

// 19-digit Zoho id — the DWH arm matches on the LAST 12 digits only.
const FRANK_ID = '6227679000000676062';
const FRANK_SUFFIX = '000000676062';

const frank = () =>
  makeContext({
    role: 'worker',
    userId: `zoho:${FRANK_ID}`,
    userName: 'Frank Harrison',
    departments: ['sales'],
    allDepartmentAccess: false,
    sessionVerified: true,
  });

beforeEach(() => {
  clearCarrierOwnershipCache();
  query.mockReset();
  query.mockResolvedValue([]);
  serverCrmGet.mockReset();
});

describe('assertCarrierOwned — DWH roster authority', () => {
  it('allows an owned carrier via the roster arms (id-suffix first, name fallback)', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    await expect(assertCarrierOwned(frank(), '5815958')).resolves.toBeUndefined();

    expect(serverCrmGet).not.toHaveBeenCalled();
    const [sql, binds] = query.mock.calls.at(-1) as [string, string[]];
    expect(sql).toContain('id_owned');
    expect(sql).toContain('name_owned');
    expect(sql).toContain('where not exists (select 1 from id_owned)');
    expect(sql).toContain(`lpad(right(c.agent_zoho_user_id::text, 12), 12, '0')`);
    expect(sql).toContain('carrier_id::text = $3');
    expect(sql).toContain('limit 1');
    expect(binds).toEqual([FRANK_SUFFIX, 'Frank Harrison', '5815958']);
  });

  it('DENIES a carrier outside the roster with the client-list message', async () => {
    query.mockResolvedValue([]);
    await expect(assertCarrierOwned(frank(), '5794015')).rejects.toThrow(
      /Carrier 5794015 is not in your client list/,
    );
    await expect(
      assertCarrierOwned(makeContext({ ...ctxOverrides(), userName: 'Frank Harrison' }), '5794015'),
    ).rejects.toBeInstanceOf(RBACError);
  });

  it('name-only principals (zoho-name:) use the single name arm — previously a hard error', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    const ctx = makeContext({
      role: 'worker',
      userId: 'zoho-name:Frank Harrison',
      userName: 'Frank Harrison',
      departments: ['sales'],
      allDepartmentAccess: false,
    });
    await expect(assertCarrierOwned(ctx, '5815958')).resolves.toBeUndefined();
    const [sql, binds] = query.mock.calls.at(-1) as [string, string[]];
    expect(sql).not.toContain('id_owned');
    expect(sql).toContain('lower(c.agent) = lower($1)');
    expect(binds).toEqual(['Frank Harrison', '5815958']);
  });

  it('id-only sessions (no userName) use the single id arm', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    const ctx = makeContext({
      role: 'worker',
      userId: `zoho:${FRANK_ID}`,
      departments: ['sales'],
      allDepartmentAccess: false,
    });
    await expect(assertCarrierOwned(ctx, '5815958')).resolves.toBeUndefined();
    const [sql, binds] = query.mock.calls.at(-1) as [string, string[]];
    expect(sql).not.toContain('name_owned');
    expect(sql).not.toContain('lower(c.agent)');
    expect(binds).toEqual([FRANK_SUFFIX, '5815958']);
  });

  it('act-as contexts are gated as the TARGET (target id + directory-verified name)', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    const actedAs = makeContext({
      role: 'worker',
      userId: 'zoho:6227679000000112233',
      userName: 'Daniel Brown',
      departments: ['sales'],
      allDepartmentAccess: false,
      sessionVerified: true,
    });
    await expect(assertCarrierOwned(actedAs, '5900001')).resolves.toBeUndefined();
    const [, binds] = query.mock.calls.at(-1) as [string, string[]];
    expect(binds).toEqual(['000000112233', 'Daniel Brown', '5900001']);
  });

  it('admins and bypassRbac skip without any lookup', async () => {
    await expect(assertCarrierOwned(makeContext({ allDepartmentAccess: true }), '1')).resolves.toBeUndefined();
    await expect(
      assertCarrierOwned(makeContext({ role: 'worker', allDepartmentAccess: false, bypassRbac: true }), '1'),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
    expect(serverCrmGet).not.toHaveBeenCalled();
  });

  it('fails closed with ToolError when the request carries no usable identity', async () => {
    const ctx = makeContext({ role: 'worker', userId: 'user-1', allDepartmentAccess: false });
    await expect(assertCarrierOwned(ctx, '5815958')).rejects.toBeInstanceOf(ToolError);
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a DWH failure as 502 DWH_ERROR — never as an RBAC denial — and does not cache it', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const err = await assertCarrierOwned(frank(), '5815958').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).not.toBeInstanceOf(RBACError);
    expect((err as AppError).statusCode).toBe(502);
    expect((err as AppError).code).toBe('DWH_ERROR');

    query.mockResolvedValue([{ ok: 1 }]);
    await expect(assertCarrierOwned(frank(), '5815958')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2); // the failure was not cached
  });
});

describe('assertCarrierOwned — result cache', () => {
  it('caches per (owner, carrier) for the TTL: repeat = 1 query, new carrier = 2', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    await assertCarrierOwned(frank(), '5815958');
    await assertCarrierOwned(frank(), '5815958');
    expect(query).toHaveBeenCalledTimes(1);
    await assertCarrierOwned(frank(), '5789315');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent checks into one probe (modal fires cards + transactions together)', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    await Promise.all([
      assertCarrierOwned(frank(), '5815958'),
      assertCarrierOwned(frank(), '5815958'),
      assertCarrierOwned(frank(), '5815958'),
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('caches NEGATIVE results (denial retries must not hammer the DWH)', async () => {
    query.mockResolvedValue([]);
    await expect(assertCarrierOwned(frank(), '5794015')).rejects.toBeInstanceOf(RBACError);
    await expect(assertCarrierOwned(frank(), '5794015')).rejects.toBeInstanceOf(RBACError);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('clearCarrierOwnershipCache forces a fresh probe', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    await assertCarrierOwned(frank(), '5815958');
    clearCarrierOwnershipCache();
    await assertCarrierOwned(frank(), '5815958');
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('isCarrierOwned — probe primitive', () => {
  it('resolves false without querying when neither identity arm is supplied', async () => {
    await expect(isCarrierOwned('no-digits-here', undefined, '5815958')).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('billing touchpoints stay outside the carrier gate', () => {
  it('no billing.* touchpoint declares carrierParam (whole-book views must not be owner-scoped)', () => {
    const billing = listTouchpoints().filter((tp) => tp.key.startsWith('billing.'));
    expect(billing.length).toBeGreaterThan(0);
    for (const tp of billing) {
      expect(tp.carrierParam, `${tp.key} must not be owner-scoped`).toBeUndefined();
    }
  });
});

function ctxOverrides() {
  return {
    role: 'worker' as const,
    userId: `zoho:${FRANK_ID}`,
    departments: ['sales'],
    allDepartmentAccess: false,
  };
}
