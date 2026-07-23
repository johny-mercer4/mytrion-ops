/**
 * requireMytrionWrite — Billing write gate for read-only Mytrion grants.
 */
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { RBACError } from '../../src/lib/errors.js';
import { requireMytrionWrite } from '../../src/routes/v1/helpers.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function req(ctx: TenantContext): FastifyRequest {
  return { ctx, headers: {}, log: { warn: () => undefined } } as unknown as FastifyRequest;
}

function base(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:u1',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['billing'],
    allDepartmentAccess: false,
    sessionVerified: true,
    requestId: 't',
    mytrionAccessModes: { billing: 'full' },
    ...over,
  };
}

describe('requireMytrionWrite', () => {
  it('allows full Billing access', () => {
    expect(() => requireMytrionWrite(req(base()), 'billing', 'Billing')).not.toThrow();
  });

  it('allows all-department admins even when mode says read', () => {
    expect(() =>
      requireMytrionWrite(
        req(base({ allDepartmentAccess: true, mytrionAccessModes: { billing: 'read' } })),
        'billing',
        'Billing',
      ),
    ).not.toThrow();
  });

  it('403s when Billing mode is read-only', () => {
    expect(() =>
      requireMytrionWrite(req(base({ mytrionAccessModes: { billing: 'read' } })), 'billing', 'Billing'),
    ).toThrow(RBACError);
  });
});
