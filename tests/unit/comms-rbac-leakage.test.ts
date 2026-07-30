/**
 * Comms RBAC leakage — the CLAUDE.md rule 9 gate, which must be green before any comms route ships.
 *
 * Technique borrowed from tests/unit/agent-rbac-leakage.test.ts: build the query, call .toSQL(), and
 * assert over the emitted SQL and bound params. No database, so it runs everywhere and cannot be
 * fooled by an empty fixture table — an unfiltered query returns nothing on an empty DB and looks
 * identical to a correctly-scoped one.
 */
import { describe, expect, it } from 'vitest';
import { actorZohoUserIdOf, commsThreadRepo } from '../../src/repos/commsThreadRepo.js';
import { KNOWN_DEPARTMENTS } from '../../src/lib/department.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'req_1',
    ...over,
  } as TenantContext;
}

const sqlOf = (ctx: TenantContext, opts = {}) => commsThreadRepo.buildListQuery(ctx, opts).toSQL();

describe('comms RBAC — tenant isolation', () => {
  it('every read binds the caller tenant and never a second one', () => {
    const { sql, params } = sqlOf(ctxOf());
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain('other-tenant');
  });

  it('a different tenant produces a different bound value, never a widened query', () => {
    const a = sqlOf(ctxOf({ tenantId: 'octane' }));
    const b = sqlOf(ctxOf({ tenantId: 'other-tenant' }));
    expect(a.sql).toBe(b.sql); // same shape…
    expect(a.params).toContain('octane'); // …different binding
    expect(b.params).toContain('other-tenant');
    expect(b.params).not.toContain('octane');
  });

  it('the tenant predicate is present even for a blanket-access caller', () => {
    const { sql, params } = sqlOf(ctxOf({ role: 'admin', allDepartmentAccess: true }));
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
  });
});

describe('comms RBAC — department isolation', () => {
  it('no foreign department string is ever bound', () => {
    for (const dept of KNOWN_DEPARTMENTS) {
      const { params } = sqlOf(ctxOf({ departments: [dept] }));
      const foreign = KNOWN_DEPARTMENTS.filter((d) => d !== dept);
      for (const other of foreign) {
        expect(params, `ctx held only "${dept}" but bound "${other}"`).not.toContain(other);
      }
    }
  });

  it('binds exactly the departments the caller holds, no more', () => {
    const { params } = sqlOf(ctxOf({ departments: ['sales', 'billing'] }));
    expect(params).toContain('sales');
    expect(params).toContain('billing');
    expect(params).not.toContain('customer-service');
  });

  it('AN EMPTY DEPARTMENT GRANT COLLAPSES THE DEPARTMENT ARM TO FALSE, not to "no filter"', () => {
    // The classic all-rows leak is an empty IN () that silently becomes unfiltered. Assert the arm
    // is a literal false and that no department value is bound at all.
    const { sql, params } = sqlOf(ctxOf({ departments: [] }));
    expect(sql).toContain('false');
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('a department-less worker still reaches their own threads through the participant arm', () => {
    const { sql, params } = sqlOf(ctxOf({ departments: [] }));
    expect(sql).toContain('exists');
    expect(params).toContain('42'); // their own zoho user id
  });
});

describe('comms RBAC — participant scoping ("I see what I raised")', () => {
  it("binds the caller's own zoho id and never another user's", () => {
    const { params } = sqlOf(ctxOf({ userId: 'zoho:42' }));
    expect(params).toContain('42');
    expect(params).not.toContain('77');
  });

  it('scopes the membership arm to worker rows, so a carrier id can never match a worker', () => {
    const { params } = sqlOf(ctxOf());
    expect(params).toContain('worker');
  });

  it('excludes members who left, so leaving a thread actually removes access', () => {
    const { params } = sqlOf(ctxOf());
    expect(params).toContain('left');
  });

  it('participatingOnly NARROWS and is ANDed on top of the reader filter', () => {
    const base = sqlOf(ctxOf());
    const narrowed = sqlOf(ctxOf(), { participatingOnly: true });
    // Strictly more restrictive: the narrowed SQL contains the base filter's arms plus another.
    expect(narrowed.sql.length).toBeGreaterThan(base.sql.length);
    expect(narrowed.sql).toContain(' and ');
  });
});

describe('comms RBAC — identities that hold no comms access', () => {
  it('a customer session gets no participant arm (it is keyed on worker ids)', () => {
    const ctx = ctxOf({
      audience: 'customer',
      userId: 'client:cu_9',
      role: 'viewer',
      departments: [],
    });
    expect(actorZohoUserIdOf(ctx)).toBeNull();
    const { sql, params } = sqlOf(ctx);
    // Both arms false ⇒ no rows, and crucially no department value is bound for a customer.
    expect(sql).toContain('false');
    expect(params).not.toContain('cu_9');
  });

  it('a system / API-key identity has no own thread access', () => {
    const ctx = ctxOf({ userId: 'system', departments: [] });
    expect(actorZohoUserIdOf(ctx)).toBeNull();
    expect(sqlOf(ctx).sql).toContain('false');
  });

  it('a blank zoho id is not an actor — it must not match every unlinked employee', () => {
    expect(actorZohoUserIdOf(ctxOf({ userId: 'zoho:' }))).toBeNull();
  });
});

describe('comms RBAC — DMs break the "admins see everything" precedent, deliberately', () => {
  it("a blanket-access caller's filter excludes dm threads", () => {
    const { sql, params } = sqlOf(ctxOf({ role: 'admin', allDepartmentAccess: true }));
    expect(sql).toContain('<>'); // kind <> 'dm'
    expect(params).toContain('dm');
  });

  it('but an admin still reaches their OWN dms via the participant arm', () => {
    // A bare `kind <> 'dm'` would lock an admin out of their own chat; the arm must be an OR.
    const { sql, params } = sqlOf(ctxOf({ role: 'admin', allDepartmentAccess: true }));
    expect(sql).toContain('exists');
    expect(sql).toContain(' or ');
    expect(params).toContain('42');
  });

  it('bypassRbac is treated as blanket access, and is still dm-excluded', () => {
    const { sql, params } = sqlOf(ctxOf({ bypassRbac: true }));
    expect(params).toContain('dm');
    expect(sql).toContain('<>');
  });
});

describe('comms RBAC — the gate is shared between REST and the WebSocket', () => {
  it('the single-thread lookup applies the same filter as the list', () => {
    const list = sqlOf(ctxOf());
    const one = commsThreadRepo.buildFindQuery(ctxOf(), 'mth_x').toSQL();
    // Same arms, so a socket subscribe and a REST read cannot diverge on who may see a thread.
    expect(one.sql).toContain('exists');
    expect(one.params).toContain('octane');
    expect(one.params).toContain('42');
    expect(one.params).toContain('mth_x');
    expect(list.sql).toContain('exists');
  });
});
