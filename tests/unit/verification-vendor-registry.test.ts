/**
 * Step 0 vendor registry — dispatcher contract, not live vendor wiring.
 *
 * Billable placements (iSoftPull, Plaid, Highway) are not registered. Descriptors in this
 * file are test doubles so every `reason` and the never-throws belt can be proven.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';
import type {
  FreeVendorDescriptor,
  MeteredVendorDescriptor,
  VendorDescriptor,
  VendorResult,
} from '../../src/integrations/vendors/types.js';
import type { SpendAuthorisation } from '../../src/integrations/vendors/spend.js';

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

const warn = vi.fn();
vi.mock('../../src/lib/logger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/logger.js')>();
  const stub = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
  return { ...mod, logger: stub as unknown as typeof mod.logger };
});

const { runVendor } = await import('../../src/integrations/vendors/runVendor.js');
const { getVendor, registeredVendorIds, VENDOR_REGISTRY } = await import(
  '../../src/integrations/vendors/registry.js'
);
const { authoriseSpend, isIssuedSpend, listSpendAttempts, resetSpendAttempts } = await import(
  '../../src/integrations/vendors/spend.js'
);

function ctx(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:u1',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['verification'],
    allDepartmentAccess: false,
    sessionVerified: true,
    requestId: 't',
    ...over,
  };
}

function free(
  over: Partial<FreeVendorDescriptor<{ q: string }, string>> &
    Pick<FreeVendorDescriptor<{ q: string }, string>, 'id'>,
): FreeVendorDescriptor<{ q: string }, string> {
  return {
    cost: 'free',
    killSwitch: () => false,
    configured: () => ({ ok: true }),
    call: async ({ q }) => q.toUpperCase(),
    ...over,
  };
}

function metered(
  over: Partial<MeteredVendorDescriptor<{ q: string }, string>> &
    Pick<MeteredVendorDescriptor<{ q: string }, string>, 'id'>,
): MeteredVendorDescriptor<{ q: string }, string> {
  return {
    cost: 'metered',
    auditAction: 'verification.vendor.test',
    killSwitch: () => false,
    configured: () => ({ ok: true }),
    call: async ({ q }) => q.toUpperCase(),
    ...over,
  };
}

/** Runtime belt: invoke the implementation without a spend token. */
function runWithoutSpend(
  descriptor: VendorDescriptor<{ q: string }, string>,
  args: { q: string } = { q: 'x' },
): Promise<VendorResult<string>> {
  return (runVendor as (
    d: VendorDescriptor<{ q: string }, string>,
    i: { ctx: TenantContext; args: { q: string } },
  ) => Promise<VendorResult<string>>)(descriptor, { ctx: ctx(), args });
}

afterEach(() => {
  resetSpendAttempts();
  warn.mockClear();
});

describe('registry placements', () => {
  it('registers no vendors in Step 0 — billable ones stay out', () => {
    expect(VENDOR_REGISTRY).toEqual({});
    expect(registeredVendorIds()).toEqual([]);
    expect(getVendor('isoftpull')).toBeUndefined();
    expect(getVendor('plaid')).toBeUndefined();
    expect(getVendor('highway')).toBeUndefined();
  });
});

describe('reason branches', () => {
  it('killed wins over a missing env and a null call', async () => {
    const result = await runVendor(
      free({
        id: 'killed-vendor',
        killSwitch: () => true,
        configured: () => ({ ok: false, missing: 'SOME_ENV' }),
        call: null,
      }),
      { ctx: ctx(), args: { q: 'x' } },
    );
    expect(result).toEqual({
      available: false,
      error: 'killed-vendor kill switch is on',
      reason: 'killed',
      data: null,
    });
  });

  it('not_configured names the missing env', async () => {
    const result = await runVendor(
      free({
        id: 'unconfigured',
        configured: () => ({ ok: false, missing: 'SOCRATA_BASE_URL' }),
        call: null,
      }),
      { ctx: ctx(), args: { q: 'x' } },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('not_configured');
    expect(result.error).toContain('SOCRATA_BASE_URL');
  });

  it('not_implemented when call is null', async () => {
    const result = await runVendor(free({ id: 'unwired', call: null }), {
      ctx: ctx(),
      args: { q: 'x' },
    });
    expect(result).toEqual({
      available: false,
      error: 'unwired is not implemented',
      reason: 'not_implemented',
      data: null,
    });
  });

  it('unauthorised_spend at runtime when a metered call is reached without spend', async () => {
    const result = await runWithoutSpend(metered({ id: 'paid' }));
    expect(result).toEqual({
      available: false,
      error: 'metered vendor requires SpendAuthorisation',
      reason: 'unauthorised_spend',
      data: null,
    });
    expect(listSpendAttempts()).toEqual([]);
  });

  it('timeout when call throws TimeoutError (fetchWithTimeout / AbortSignal.timeout)', async () => {
    const result = await runVendor(
      free({
        id: 'slow',
        call: async () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          throw err;
        },
      }),
      { ctx: ctx(), args: { q: 'x' } },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(result.data).toBeNull();
  });

  it('remote_error when call throws', async () => {
    const result = await runVendor(
      free({
        id: 'broken',
        call: async () => {
          throw new Error('upstream 502');
        },
      }),
      { ctx: ctx(), args: { q: 'x' } },
    );
    expect(result).toEqual({
      available: false,
      error: 'upstream 502',
      reason: 'remote_error',
      data: null,
    });
  });
});

describe('never-throws', () => {
  it('swallows a thrown configured()', async () => {
    const result = await runVendor(
      free({
        id: 'cfg-throw',
        configured: () => {
          throw new Error('configured exploded');
        },
      }),
      { ctx: ctx(), args: { q: 'x' } },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('remote_error');
    expect(result.error).toBe('configured exploded');
  });

  it('swallows a thrown killSwitch()', async () => {
    const result = await runVendor(
      free({
        id: 'kill-throw',
        killSwitch: () => {
          throw new Error('kill exploded');
        },
      }),
      { ctx: ctx(), args: { q: 'x' } },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('remote_error');
  });

  it('swallows a thrown URL/arg builder inside call', async () => {
    const result = await runVendor(
      free({
        id: 'url-throw',
        call: async ({ q }) => {
          encodeURIComponent(q);
          throw new URIError('URI malformed');
        },
      }),
      { ctx: ctx(), args: { q: '\uD800' } },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('remote_error');
    expect(result.error).toMatch(/URI malformed/);
  });

  it('swallows bad args that make call throw', async () => {
    const result = await runVendor(
      free({
        id: 'bad-args',
        call: async ({ q }) => q.toUpperCase(),
      }),
      { ctx: ctx(), args: { q: null as unknown as string } },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('remote_error');
  });
});

describe('free path', () => {
  it('does not require spend and is an available success', async () => {
    const result = await runVendor(free({ id: 'census' }), { ctx: ctx(), args: { q: 'dot' } });
    expect(result).toEqual({ available: true, error: null, reason: null, data: 'DOT' });
    expect(listSpendAttempts()).toEqual([]);
  });

  it('never treats available: false as an empty success', async () => {
    const result = await runVendor(free({ id: 'empty-fail', call: null }), {
      ctx: ctx(),
      args: { q: 'x' },
    });
    expect(result.available).toBe(false);
    expect(result.reason).not.toBeNull();
    expect(result.data).toBeNull();
  });
});

describe('metered hook (types + runtime belt, no registered vendors)', () => {
  it('runs a metered test double only with an issued spend token', async () => {
    const spend = await authoriseSpend({
      ctx: ctx(),
      caseId: 'case-1',
      vendorId: 'paid',
      reason: 'unit test',
    });
    expect(spend).not.toBeNull();
    expect(isIssuedSpend(spend)).toBe(true);

    const result = await runVendor(metered({ id: 'paid' }), {
      ctx: ctx(),
      args: { q: 'dot' },
      spend: spend as SpendAuthorisation,
    });
    expect(result).toEqual({ available: true, error: null, reason: null, data: 'DOT' });
    expect(listSpendAttempts()).toEqual([
      { id: 'attempt-1', vendorId: 'paid', caseId: 'case-1', status: 'ok' },
    ]);
  });

  it('rejects a forged spend token at runtime', async () => {
    const forged = { vendorId: 'paid', caseId: 'case-1' } as SpendAuthorisation;
    expect(isIssuedSpend(forged)).toBe(false);
    const result = await runVendor(metered({ id: 'paid' }), {
      ctx: ctx(),
      args: { q: 'x' },
      spend: forged,
    });
    expect(result.reason).toBe('unauthorised_spend');
  });

  it('refuses a caller without verification access — no ceiling, just the grant gate', async () => {
    const spend = await authoriseSpend({
      ctx: ctx({ departments: ['sales'] }),
      caseId: 'case-1',
      vendorId: 'paid',
      reason: 'unit test',
    });
    expect(spend).toBeNull();
  });
});

describe('logging', () => {
  it('warns with vendorId and reason, never args', async () => {
    await runVendor(free({ id: 'secret-vendor', call: null }), {
      ctx: ctx(),
      args: { q: 'api-key-should-not-appear' },
    });
    expect(warn).toHaveBeenCalledWith(
      { vendorId: 'secret-vendor', reason: 'not_implemented' },
      'verification vendor unavailable',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('api-key-should-not-appear');
  });
});

/**
 * Compile gate: a metered descriptor without `spend` is a type error.
 * `@ts-expect-error` fails `pnpm typecheck` if the overload ever starts accepting this call.
 */
function _compileGateMeteredNeedsSpend(
  desc: MeteredVendorDescriptor<{ q: string }, string>,
  caller: TenantContext,
): void {
  // @ts-expect-error metered vendor requires SpendAuthorisation
  void runVendor(desc, { ctx: caller, args: { q: 'x' } });
}

void _compileGateMeteredNeedsSpend;
