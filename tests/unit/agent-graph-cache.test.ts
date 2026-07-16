import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import {
  agentGraphCacheSize,
  getCachedAgent,
  identitySignature,
  resetAgentGraphCache,
} from '../../src/modules/agents/graphCache.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const baseCtx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: 'octane',
  userId: 'zoho:1',
  audience: 'internal',
  role: 'worker',
  scopes: ['servercrm:read'],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'req_1',
  ...over,
});

beforeEach(() => {
  resetAgentGraphCache();
  env.FF_AGENT_GRAPH_CACHE = true;
});

describe('identitySignature', () => {
  it('ignores requestId (the ephemeral per-request field)', () => {
    expect(identitySignature(baseCtx({ requestId: 'A' }))).toBe(
      identitySignature(baseCtx({ requestId: 'B' })),
    );
  });

  it('ignores actingAgent (set per-child, not on the caller)', () => {
    expect(identitySignature(baseCtx({ actingAgent: 'sales' }))).toBe(identitySignature(baseCtx()));
  });

  it('is stable regardless of scope/department array order', () => {
    const a = identitySignature(baseCtx({ scopes: ['a', 'b'], departments: ['x', 'y'] }));
    const b = identitySignature(baseCtx({ scopes: ['b', 'a'], departments: ['y', 'x'] }));
    expect(a).toBe(b);
  });

  it('DIFFERS for a different user (no cross-user graph reuse)', () => {
    expect(identitySignature(baseCtx({ userId: 'zoho:1' }))).not.toBe(
      identitySignature(baseCtx({ userId: 'zoho:2' })),
    );
  });

  it('DIFFERS for a different department view', () => {
    expect(identitySignature(baseCtx({ departments: ['sales'] }))).not.toBe(
      identitySignature(baseCtx({ departments: ['billing'] })),
    );
  });

  it('DIFFERS for elevated authority (allDepartmentAccess / bypass / impersonation)', () => {
    const plain = identitySignature(baseCtx());
    expect(identitySignature(baseCtx({ allDepartmentAccess: true }))).not.toBe(plain);
    expect(identitySignature(baseCtx({ bypassRbac: true }))).not.toBe(plain);
    expect(identitySignature(baseCtx({ impersonatorUserId: 'admin1' }))).not.toBe(plain);
  });
});

describe('getCachedAgent', () => {
  it('builds once per key and reuses the same instance', async () => {
    const build = vi.fn(async () => ({ id: Math.random() }));
    const first = await getCachedAgent('k', build);
    const second = await getCachedAgent('k', build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('builds separately for different keys', async () => {
    const build = vi.fn(async () => ({ id: Math.random() }));
    const a = await getCachedAgent('a', build);
    const b = await getCachedAgent('b', build);
    expect(build).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);
  });

  it('shares one in-flight build across concurrent callers', async () => {
    const build = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: 1 }), 10)),
    );
    const [a, b] = await Promise.all([getCachedAgent('k', build), getCachedAgent('k', build)]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('does not cache a failed build (retries next time)', async () => {
    const build = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true });
    await expect(getCachedAgent('k', build)).rejects.toThrow('boom');
    await expect(getCachedAgent('k', build)).resolves.toEqual({ ok: true });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache entirely when the flag is off', async () => {
    env.FF_AGENT_GRAPH_CACHE = false;
    const build = vi.fn(async () => ({ id: Math.random() }));
    await getCachedAgent('k', build);
    await getCachedAgent('k', build);
    expect(build).toHaveBeenCalledTimes(2);
    expect(agentGraphCacheSize()).toBe(0);
  });

  it('resetAgentGraphCache forces a rebuild', async () => {
    const build = vi.fn(async () => ({ id: Math.random() }));
    await getCachedAgent('k', build);
    resetAgentGraphCache();
    await getCachedAgent('k', build);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
