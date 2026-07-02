import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import {
  buildCallerContext,
  hasCustomerMarkers,
  type CallerIdentityBody,
} from '../../src/routes/v1/callerIdentity.js';
import { contextFromClaims, systemContext } from '../../src/modules/auth/authService.js';
import type { WorkerIdentity } from '../../src/modules/auth/jwt.js';
import type { Role } from '../../src/types/tenantContext.js';
import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { toolRegistry } from '../../src/modules/tools/index.js';

/** Minimal request double: only ctx/headers/log are read by the caller-identity path. */
function fakeRequest(): FastifyRequest {
  const req = {
    ctx: systemContext('req-test'),
    headers: {},
    log: { warn: vi.fn() },
  };
  // Test double: the identity builders only touch ctx/headers/log, so a full Fastify
  // request is unnecessary — the cast documents exactly that.
  return req as unknown as FastifyRequest;
}

/** Request whose ctx is a VERIFIED Zoho-worker session (as authenticate → contextFromClaims sets). */
function sessionRequest(worker: WorkerIdentity, role: Role = 'admin'): FastifyRequest {
  const ctx = contextFromClaims(
    { userId: `zoho:${worker.zohoUserId}`, tenantId: DEFAULT_TENANT_ID, audience: 'internal', role, worker },
    'req-test',
  );
  return { ctx, headers: {}, log: { warn: vi.fn() } } as unknown as FastifyRequest;
}

const strictFlag = env.FF_CUSTOMER_SCOPE_STRICT;
afterEach(() => {
  env.FF_CUSTOMER_SCOPE_STRICT = strictFlag;
});

describe('hasCustomerMarkers', () => {
  it('detects carrier_id / application_id / chat_id; worker fields alone do not qualify', () => {
    expect(hasCustomerMarkers({ carrier_id: 5758544 })).toBe(true);
    expect(hasCustomerMarkers({ application_id: 'APP-1' })).toBe(true);
    expect(hasCustomerMarkers({ chat_id: 42 })).toBe(true);
    expect(hasCustomerMarkers({ zoho_user_id: '1', user_name: 'Alice' })).toBe(false);
  });
});

describe('worker context (unchanged trusted-frontend behavior)', () => {
  it('merges department_scope + honors admin profile markers', () => {
    const ctx = buildCallerContext(fakeRequest(), {
      zoho_user_id: '123',
      user_name: 'Alice Doe',
      department_scope: ['Sales', ' billing '],
      profile: 'Administrator',
    });
    expect(ctx.audience).toBe('internal');
    expect(ctx.userId).toBe('zoho:123');
    expect(ctx.departments).toEqual(['sales', 'billing']);
    expect(ctx.allDepartmentAccess).toBe(true);
    expect(ctx.userName).toBe('Alice Doe');
  });

  it('non-admin worker keeps only their departments', () => {
    const ctx = buildCallerContext(fakeRequest(), {
      zoho_user_id: '9',
      user_name: 'Bob',
      department_scope: 'collection',
      profile: 'Standard',
    });
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(ctx.departments).toEqual(['collection']);
  });
});

describe('verified worker session is authoritative (Zoho OAuth) — body identity is ignored', () => {
  it('all-access worker: hostile body identity cannot change the verified identity or scope', () => {
    const req = sessionRequest({ zohoUserId: '555', userName: 'Alice', profile: 'Administrator', zohoRole: 'CEO' });
    const ctx = buildCallerContext(req, {
      // every spoof vector: a different id, a different name, a downgraded profile, a narrow scope
      zoho_user_id: '999',
      user_name: 'Evil Twin',
      profile: 'Standard',
      department_scope: ['finance'],
      allDepartments: false,
    });
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.userId).toBe('zoho:555'); // from the token, not body 999
    expect(ctx.userName).toBe('Alice'); // from the token, not 'Evil Twin'
    expect(ctx.profiles).toEqual(['Administrator']); // verified profile, not the body 'Standard'
    expect(ctx.allDepartmentAccess).toBe(true); // derived from the verified Administrator profile
  });

  it('non-admin worker: body cannot self-escalate, but the department VIEW is honored', () => {
    const req = sessionRequest({ zohoUserId: '42', userName: 'Bob', profile: 'Sales Rep', zohoRole: 'Agent' });
    const ctx = buildCallerContext(req, {
      zoho_user_id: '1',
      user_name: 'Mallory',
      profile: 'Administrator', // spoof attempt
      allDepartments: true, // spoof attempt
      department_scope: ['Sales', ' billing '],
    });
    expect(ctx.userId).toBe('zoho:42');
    expect(ctx.userName).toBe('Bob');
    expect(ctx.profiles).toEqual(['Sales Rep']); // NOT the body's 'Administrator'
    expect(ctx.allDepartmentAccess).toBe(false); // spoofed allDepartments/profile ignored
    expect(ctx.departments).toEqual(['sales', 'billing']); // view honored + normalized
  });

  it('non-admin worker with no department view falls back to the base (no departments)', () => {
    const ctx = buildCallerContext(sessionRequest({ zohoUserId: '42', profile: 'Sales Rep' }), {});
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.departments).toEqual([]);
  });

  it('session wins over customer markers: carrier_id in the body does NOT downgrade to customer', () => {
    const ctx = buildCallerContext(sessionRequest({ zohoUserId: '42', profile: 'Sales Rep' }), {
      carrier_id: 999,
      department_scope: ['sales'],
    });
    expect(ctx.audience).toBe('internal');
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.departments).toEqual(['sales']);
  });
});

describe('customer context — FF_CUSTOMER_SCOPE_STRICT on', () => {
  const hostileCustomer: CallerIdentityBody = {
    carrier_id: 5758544,
    chat_id: 777,
    company_name: 'Acme Transport',
    // hostile: every self-escalation vector the legacy path honored
    allDepartments: true,
    department_scope: ['finance', 'c-level'],
    departmentAccess: ['management'],
    profile: 'Administrator',
    role: 'CEO',
    user_name: 'Some Admin Name',
  };

  it('locks the context down: customer audience, viewer role, company tag only', () => {
    env.FF_CUSTOMER_SCOPE_STRICT = true;
    const req = fakeRequest();
    const ctx = buildCallerContext(req, hostileCustomer);
    expect(ctx.audience).toBe('customer');
    expect(ctx.role).toBe('viewer');
    expect(ctx.scopes).toEqual([]);
    expect(ctx.departments).toEqual(['5758544']);
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(ctx.bypassRbac).toBeUndefined();
    expect(ctx.profiles).toBeUndefined();
    expect(ctx.userId).toBe('customer:tg:777');
    expect(ctx.userName).toBe('Acme Transport');
    expect(req.log.warn).toHaveBeenCalled();
  });

  it('customer context reaches knowledge.search but no internal tools and no agents', () => {
    env.FF_CUSTOMER_SCOPE_STRICT = true;
    const ctx = buildCallerContext(fakeRequest(), hostileCustomer);
    const allowed = toolRegistry.listForContext(ctx).map((t) => t.name);
    expect(allowed).toEqual(['knowledge.search']);
    expect(toolRegistry.checkAccess(toolRegistry.get('zoho_crm.query')!, ctx).ok).toBe(false);
    expect(agentRegistry.listForContext(ctx)).toEqual([]);
  });
});

describe('customer context — legacy mode (flag off) warns but preserves behavior', () => {
  it('still honors the legacy merge and logs a security warning', () => {
    env.FF_CUSTOMER_SCOPE_STRICT = false;
    const req = fakeRequest();
    const ctx = buildCallerContext(req, {
      carrier_id: 100,
      chat_id: 5,
      allDepartments: true,
    });
    // Legacy (pre-fix) behavior: the self-asserted bypass is honored. The warning is the
    // migration signal for the Telegram shim.
    expect(ctx.allDepartmentAccess).toBe(true);
    expect(ctx.audience).toBe('internal');
    expect(req.log.warn).toHaveBeenCalledOnce();
  });

  it('plain customer (no escalation fields) does not warn', () => {
    env.FF_CUSTOMER_SCOPE_STRICT = false;
    const req = fakeRequest();
    const ctx = buildCallerContext(req, { carrier_id: 100, chat_id: 5, company_name: 'Acme' });
    expect(ctx.departments).toEqual(['100']);
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(req.log.warn).not.toHaveBeenCalled();
  });
});
