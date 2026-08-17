/**
 * requireHrManage — the HR directory WRITE gate (create/edit/delete employees & departments, org moves).
 *
 * The point of this file is that it is fail-CLOSED, unlike the generic `requireMytrionWrite`: an HR
 * grant with no mode, or with `read`, is a look-only directory user, not a manager. Only an admin or an
 * EXPLICIT `hr: full` may write. This mirrors the client's `canManageHr`, so a hidden button and a 403
 * never disagree.
 */
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { RBACError } from '../../src/lib/errors.js';
import { requireHrManage } from '../../src/routes/v1/hrAccess.js';
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
    departments: ['hr'],
    allDepartmentAccess: false,
    sessionVerified: true,
    requestId: 't',
    mytrionAccessModes: { hr: 'read' },
    ...over,
  };
}

describe('requireHrManage', () => {
  it('allows an explicit HR Manager (hr: full)', () => {
    expect(() =>
      requireHrManage(req(base({ mytrionAccessModes: { hr: 'full' } }))),
    ).not.toThrow();
  });

  it('allows all-department admins even when their HR mode says read', () => {
    expect(() =>
      requireHrManage(req(base({ allDepartmentAccess: true, mytrionAccessModes: { hr: 'read' } }))),
    ).not.toThrow();
  });

  it('403s a plain HR directory user (hr: read)', () => {
    expect(() => requireHrManage(req(base()))).toThrow(RBACError);
  });

  it('403s when HR has no mode at all — fail-closed, NOT the requireMytrionWrite default', () => {
    // This is the case that separates requireHrManage from requireMytrionWrite: an absent mode must
    // deny, because a bare HR grant is directory-only. requireMytrionWrite would ALLOW this.
    expect(() => requireHrManage(req(base({ mytrionAccessModes: {} })))).toThrow(RBACError);
  });

  it('403s a caller without HR access at all (requireHrInternal fails first)', () => {
    expect(() =>
      requireHrManage(req(base({ departments: [], mytrionAccessModes: { hr: 'full' } }))),
    ).toThrow(RBACError);
  });
});
