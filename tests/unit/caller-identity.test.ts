import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import { RBACError } from '../../src/lib/errors.js';
import {
  buildCallerContext,
  hasCustomerMarkers,
  type CallerIdentityBody,
} from '../../src/routes/v1/callerIdentity.js';
import { contextFromClaims, systemContext } from '../../src/modules/auth/authService.js';
import { resolveActAsTarget } from '../../src/modules/auth/actAsDirectory.js';
import type { WorkerIdentity } from '../../src/modules/auth/jwt.js';
import type { Role, TenantContext } from '../../src/types/tenantContext.js';
import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { toolRegistry } from '../../src/modules/tools/index.js';

// The act-as directory is a CRM lookup — stubbed here; its resolution logic is what the
// impersonation tests exercise. Audit writes are silenced (no DB in unit tests).
vi.mock('../../src/modules/auth/actAsDirectory.js', () => ({
  resolveActAsTarget: vi.fn(),
  clearActAsDirectory: vi.fn(),
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, auditFromContext: vi.fn().mockResolvedValue(undefined) };
});
// contextFromClaims resolves a worker's grant from the DB (mytrionAccessService). Mock it with the
// DB-free legacy derivation so the caller-identity path is deterministic offline; the resolver's
// own logic is covered by tests/unit/mytrion-access.test.ts.
vi.mock('../../src/modules/access/mytrionAccessService.js', async () => {
  const dept = await import('../../src/lib/department.js');
  const { MYTRION_IDS, MYTRION_DEPARTMENT } = await import('../../src/lib/mytrions.js');
  return {
    mytrionAccessService: {
      resolveWorkerAccess: vi.fn(
        async (input: { profileName?: string | null; zohoRole?: string | null; userName?: string | null }) => {
          const envAdmin = dept.resolveAllDepartmentAccess({
            profile: input.profileName ?? null,
            role: input.zohoRole ?? null,
            userName: input.userName ?? null,
          });
          if (envAdmin) {
            return { accessibleMytrions: [...MYTRION_IDS], homeMytrion: null, allDepartmentAccess: true, departments: [] };
          }
          const departments = dept.deriveWorkerDepartments(input.profileName ?? null, input.zohoRole ?? null);
          const set = new Set(departments);
          const accessible = MYTRION_IDS.filter((id) => set.has(MYTRION_DEPARTMENT[id]));
          return {
            accessibleMytrions: accessible,
            homeMytrion: accessible.length === 1 ? (accessible[0] ?? null) : null,
            allDepartmentAccess: false,
            departments,
          };
        },
      ),
      invalidateUser: vi.fn(),
      invalidateAll: vi.fn(),
    },
  };
});

const actAsTarget = vi.mocked(resolveActAsTarget);

/** Minimal request double: only ctx/headers/log are read by the caller-identity path. */
function fakeRequest(): FastifyRequest {
  const req = {
    ctx: systemContext('req-test'),
    headers: {},
    log: { warn: vi.fn(), info: vi.fn() },
  };
  // Test double: the identity builders only touch ctx/headers/log, so a full Fastify
  // request is unnecessary — the cast documents exactly that.
  return req as unknown as FastifyRequest;
}

/** Request whose ctx is a VERIFIED Zoho-worker session (as authenticate → contextFromClaims sets). */
async function sessionRequest(worker: WorkerIdentity, role: Role = 'admin'): Promise<FastifyRequest> {
  const ctx = await contextFromClaims(
    { userId: `zoho:${worker.zohoUserId}`, tenantId: DEFAULT_TENANT_ID, audience: 'internal', role, worker },
    'req-test',
  );
  return { ctx, headers: {}, log: { warn: vi.fn(), info: vi.fn() } } as unknown as FastifyRequest;
}

const strictFlag = env.FF_CUSTOMER_SCOPE_STRICT;
const deptStrictFlag = env.FF_WORKER_DEPT_STRICT;
afterEach(() => {
  env.FF_CUSTOMER_SCOPE_STRICT = strictFlag;
  env.FF_WORKER_DEPT_STRICT = deptStrictFlag;
  actAsTarget.mockReset();
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
  it('merges department_scope + honors admin profile markers', async () => {
    const ctx = await buildCallerContext(fakeRequest(), {
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

  it('non-admin worker keeps only their departments', async () => {
    const ctx = await buildCallerContext(fakeRequest(), {
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
  it('all-access worker: hostile body identity cannot change the verified identity or scope', async () => {
    const req = await sessionRequest({ zohoUserId: '555', userName: 'Alice', profile: 'Administrator', zohoRole: 'CEO' });
    const ctx = await buildCallerContext(req, {
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

  it('non-admin worker: body cannot self-escalate, but the department VIEW is honored', async () => {
    const req = await sessionRequest({ zohoUserId: '42', userName: 'Bob', profile: 'Sales Rep', zohoRole: 'Agent' });
    const ctx = await buildCallerContext(req, {
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
    // View is intersected with the DB-resolved grant (Sales Rep ⇒ ['sales']); 'billing' is NOT
    // granted, so the attempt to view it is dropped — a worker can narrow but never widen.
    expect(ctx.departments).toEqual(['sales']);
  });

  it('non-admin worker with no department view gets their full DB-resolved grant', async () => {
    const req = await sessionRequest({ zohoUserId: '42', profile: 'Sales Rep' });
    const ctx = await buildCallerContext(req, {});
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.departments).toEqual(['sales']); // the grant (no view ⇒ full grant)
  });

  it('session wins over customer markers: carrier_id in the body does NOT downgrade to customer', async () => {
    const req = await sessionRequest({ zohoUserId: '42', profile: 'Sales Rep' });
    const ctx = await buildCallerContext(req, {
      carrier_id: 999,
      department_scope: ['sales'],
    });
    expect(ctx.audience).toBe('internal');
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.departments).toEqual(['sales']);
  });
});

describe('worker role derivation (contextFromClaims re-derives; claims.role never trusted)', () => {
  const claims = (worker: WorkerIdentity, role: Role) => ({
    userId: `zoho:${worker.zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal' as const,
    role,
    worker,
  });

  it('admin-marker profile ⇒ admin with full scopes', async () => {
    const ctx = await contextFromClaims(claims({ zohoUserId: '1', profile: 'Administrator' }, 'worker'), 'r');
    expect(ctx.role).toBe('admin');
    expect(ctx.scopes).toEqual(['*']);
    expect(ctx.allDepartmentAccess).toBe(true);
  });

  it('non-admin profile ⇒ worker with read scopes, even from a STALE pre-fix admin token', async () => {
    const ctx = await contextFromClaims(claims({ zohoUserId: '42', profile: 'Sales Rep', zohoRole: 'Sales Agent' }, 'admin'), 'r');
    expect(ctx.role).toBe('worker'); // stale role:'admin' claim ignored — re-derived from profile
    expect(ctx.scopes).toContain('servercrm:read');
    expect(ctx.scopes).toContain('zoho_crm:read');
    expect(ctx.scopes).not.toContain('*');
    expect(ctx.allDepartmentAccess).toBe(false);
  });

  it('worker role is denied non-read tools by the registry write gate', async () => {
    const ctx = await contextFromClaims(claims({ zohoUserId: '42', profile: 'Sales Rep' }, 'admin'), 'r');
    const workerCtx = { ...ctx, departments: ['sales'] };
    const writeTools = toolRegistry.all().filter((t) => t.riskClass !== 'read');
    expect(writeTools.length).toBeGreaterThan(0);
    for (const tool of writeTools) {
      expect(toolRegistry.checkAccess(tool, workerCtx).ok).toBe(false);
    }
  });
});

describe('view-as for NON-admins (targeted, DB-granted impersonation)', () => {
  /** A verified non-admin worker session carrying an explicit view-as grant + an act-as header. */
  function viewAsReq(viewAsUserIds: string[], actAsId: string): FastifyRequest {
    const ctx: TenantContext = {
      tenantId: DEFAULT_TENANT_ID,
      userId: 'zoho:42',
      audience: 'internal',
      role: 'worker',
      scopes: [],
      departments: ['sales'],
      allDepartmentAccess: false,
      sessionVerified: true,
      profiles: ['Sales Rep'],
      viewAsUserIds,
      requestId: 'r',
    };
    return {
      ctx,
      headers: { 'x-act-as-zoho-user-id': actAsId },
      log: { warn: vi.fn(), info: vi.fn() },
    } as unknown as FastifyRequest;
  }

  it('a granted non-admin may view-as the specific target (runs AS them, audited impersonator)', async () => {
    actAsTarget.mockResolvedValue({ zohoUserId: '777', name: 'Rep Riley', email: null, profile: 'Sales Rep', role: 'Sales Agent',
      isOnline: false,
    });
    const ctx = await buildCallerContext(viewAsReq(['777'], '777'), {});
    expect(ctx.userId).toBe('zoho:777');
    expect(ctx.impersonatorUserId).toBe('zoho:42');
    expect(ctx.role).toBe('worker');
  });

  it('a non-admin WITHOUT the grant cannot view-as (the header is ignored — runs as self)', async () => {
    const ctx = await buildCallerContext(viewAsReq([], '777'), {});
    expect(ctx.userId).toBe('zoho:42'); // stayed themselves
    expect(ctx.impersonatorUserId).toBeUndefined();
  });

  it('a non-admin can NEVER view-as an all-access (admin) target — escalation blocked', async () => {
    actAsTarget.mockResolvedValue({ zohoUserId: '999', name: 'Boss', email: null, profile: 'Administrator', role: 'CEO',
      isOnline: false,
    });
    await expect(buildCallerContext(viewAsReq(['999'], '999'), {})).rejects.toThrow();
  });
});

describe('act-as impersonation is verified server-side (CRM directory, not headers)', () => {
  const admin = { zohoUserId: '1', userName: 'Admin Ann', profile: 'Administrator' };

  it('ignores spoofed x-act-as identity headers; authority comes from the CRM record', async () => {
    actAsTarget.mockResolvedValue({
      zohoUserId: '777',
      name: 'Rep Riley',
      email: null,
      profile: 'Sales Agent',
      role: 'Sales Agent',
      isOnline: false,
    });
    const req = await sessionRequest(admin);
    req.headers = {
      'x-act-as-zoho-user-id': '777',
      'x-act-as-profile': 'Administrator', // spoof — must be ignored
      'x-act-as-role': 'CEO', // spoof
      'x-act-as-user-name': 'Fake Name', // spoof
    };
    const ctx = await buildCallerContext(req, { department_scope: ['sales'] });
    expect(actAsTarget).toHaveBeenCalledWith('777');
    expect(ctx.userId).toBe('zoho:777');
    expect(ctx.userName).toBe('Rep Riley'); // CRM name, not the header
    expect(ctx.profiles).toEqual(['Sales Agent']); // CRM profile, not 'Administrator'
    expect(ctx.allDepartmentAccess).toBe(false); // spoofed headers minted no authority
    expect(ctx.role).toBe('worker'); // impersonation runs with the TARGET's authority
    expect(ctx.scopes).not.toContain('*');
    expect(ctx.departments).toEqual(['sales']);
    expect(ctx.impersonatorUserId).toBe('zoho:1');
  });

  it('acting as an admin-profile target keeps admin authority (verified, not asserted)', async () => {
    actAsTarget.mockResolvedValue({
      zohoUserId: '888',
      name: 'Manager Mo',
      email: null,
      profile: 'Administrator',
      role: 'Manager',
      isOnline: false,
    });
    const req = await sessionRequest(admin);
    req.headers = { 'x-act-as-zoho-user-id': '888' };
    const ctx = await buildCallerContext(req, {});
    expect(ctx.allDepartmentAccess).toBe(true);
    expect(ctx.role).toBe('admin');
  });

  it('rejects an unknown/inactive target (fail closed)', async () => {
    actAsTarget.mockResolvedValue(null);
    const req = await sessionRequest(admin);
    req.headers = { 'x-act-as-zoho-user-id': 'ghost' };
    await expect(buildCallerContext(req, {})).rejects.toThrow(RBACError);
  });

  it('non-admin sessions cannot act-as: the header is ignored entirely', async () => {
    const req = await sessionRequest({ zohoUserId: '42', userName: 'Bob', profile: 'Sales Rep' });
    req.headers = { 'x-act-as-zoho-user-id': '777' };
    const ctx = await buildCallerContext(req, {});
    expect(actAsTarget).not.toHaveBeenCalled();
    expect(ctx.userId).toBe('zoho:42');
    expect(ctx.impersonatorUserId).toBeUndefined();
  });
});

describe('verified worker department view is bounded by the DB-resolved grant', () => {
  it('intersects the body view with the grant — ungranted departments are dropped', async () => {
    const req = await sessionRequest({ zohoUserId: '42', profile: 'Sales Agent', zohoRole: 'Sales Agent' });
    const ctx = await buildCallerContext(req, { department_scope: ['sales', 'finance'] });
    expect(ctx.departments).toEqual(['sales']); // 'finance' is not in the grant
  });

  it('no body view ⇒ the full grant', async () => {
    const req = await sessionRequest({ zohoUserId: '42', profile: 'Customer Service Agent' });
    const ctx = await buildCallerContext(req, {});
    expect(ctx.departments).toEqual(['customer-service']);
  });

  it('a view of only an ungranted department yields nothing (narrow, never widen)', async () => {
    const req = await sessionRequest({ zohoUserId: '42', profile: 'Sales Agent' });
    const ctx = await buildCallerContext(req, { department_scope: ['finance'] });
    // Sales Agent is granted ['sales']; a view of only 'finance' intersects to [] — they get no
    // department access for this request (they cannot widen to finance).
    expect(ctx.departments).toEqual([]);
  });
});

describe('customer context — FF_CUSTOMER_SCOPE_STRICT on (the default)', () => {
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

  it('locks the context down: customer audience, viewer role, company tag only', async () => {
    env.FF_CUSTOMER_SCOPE_STRICT = true;
    const req = fakeRequest();
    const ctx = await buildCallerContext(req, hostileCustomer);
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

  it('customer context reaches knowledge.search but no internal tools and no agents', async () => {
    env.FF_CUSTOMER_SCOPE_STRICT = true;
    const ctx = await buildCallerContext(fakeRequest(), hostileCustomer);
    const allowed = toolRegistry.listForContext(ctx).map((t) => t.name);
    expect(allowed).toEqual(['knowledge.search']);
    expect(toolRegistry.checkAccess(toolRegistry.get('zoho_crm.query')!, ctx).ok).toBe(false);
    expect(agentRegistry.listForContext(ctx)).toEqual([]);
  });
});

describe('customer context — legacy mode (flag off) warns but preserves behavior', () => {
  it('still honors the legacy merge and logs a security warning', async () => {
    env.FF_CUSTOMER_SCOPE_STRICT = false;
    const req = fakeRequest();
    const ctx = await buildCallerContext(req, {
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

  it('plain customer (no escalation fields) does not warn', async () => {
    env.FF_CUSTOMER_SCOPE_STRICT = false;
    const req = fakeRequest();
    const ctx = await buildCallerContext(req, { carrier_id: 100, chat_id: 5, company_name: 'Acme' });
    expect(ctx.departments).toEqual(['100']);
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(req.log.warn).not.toHaveBeenCalled();
  });
});
