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
import { commsCatalogRepo } from '../../src/repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../src/repos/commsDepartmentRepo.js';
import { commsAnalyticsRepo } from '../../src/repos/commsAnalyticsRepo.js';
import { commsEscalationRepo } from '../../src/repos/commsEscalationRepo.js';
import { commsSettingsRepo } from '../../src/repos/commsSettingsRepo.js';
import { commsTicketEventRepo } from '../../src/repos/commsTicketEventRepo.js';
import { commsTicketRepo, encodeTicketCursor } from '../../src/repos/commsTicketRepo.js';
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

// =============================================================================================
// The reads added on top of the thread substrate: the catalog, the settings row, the department
// config, the ticket list/detail and the ticket journal. Same offline .toSQL() discipline — an
// unfiltered read of any of these looks identical to a correct one against an empty fixture DB.
// =============================================================================================

/** toSQL() params are `unknown[]`; department/tenant leakage is only ever a bound STRING. */
const strings = (params: unknown[]): string[] =>
  params.filter((p): p is string => typeof p === 'string');

const OTHER_TENANT = 'other-tenant';

describe('commsCatalogRepo.buildListQuery — tenant-bound, department-silent', () => {
  it('binds the caller tenant and never a second one', () => {
    const { sql, params } = commsCatalogRepo.buildListQuery(ctxOf()).toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it('a different tenant is a different BINDING, not a widened query', () => {
    const a = commsCatalogRepo.buildListQuery(ctxOf({ tenantId: 'octane' })).toSQL();
    const b = commsCatalogRepo.buildListQuery(ctxOf({ tenantId: OTHER_TENANT })).toSQL();
    expect(a.sql).toBe(b.sql);
    expect(b.params).toContain(OTHER_TENANT);
    expect(b.params).not.toContain('octane');
  });

  it('the tenant predicate survives a blanket-access caller', () => {
    const { sql, params } = commsCatalogRepo
      .buildListQuery(ctxOf({ role: 'admin', allDepartmentAccess: true, bypassRbac: true }))
      .toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
  });

  it('binds NO department at all unless one is asked for — the catalog is tenant-global config', () => {
    // The catalog is not department-scoped data; the important property is the inverse of the thread
    // filter's — a caller's department grant must not silently narrow OR widen the picker.
    const { params } = commsCatalogRepo
      .buildListQuery(ctxOf({ departments: ['sales', 'billing'] }))
      .toSQL();
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('a targetDepartment filter binds exactly that one department and no other', () => {
    const { params } = commsCatalogRepo
      .buildListQuery(ctxOf(), { targetDepartment: 'customer-service' })
      .toSQL();
    expect(params).toContain('customer-service');
    for (const dept of KNOWN_DEPARTMENTS.filter((d) => d !== 'customer-service')) {
      expect(params).not.toContain(dept);
    }
  });

  it('defaults to active rows and never emits an empty IN () that could unfilter the kind', () => {
    const { sql, params } = commsCatalogRepo
      .buildListQuery(ctxOf(), { kind: 'escalation_reason' })
      .toSQL();
    expect(params).toContain('escalation_reason');
    expect(params).toContain(true);
    expect(sql).not.toContain('in ()');
  });
});

describe('commsSettingsRepo.buildGetQuery — one row, one tenant', () => {
  it('binds the caller tenant and nothing else', () => {
    const { sql, params } = commsSettingsRepo.buildGetQuery(ctxOf()).toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(strings(params)).toEqual(['octane']);
  });

  it('cannot be steered to another tenant by role or department', () => {
    const admin = commsSettingsRepo
      .buildGetQuery(ctxOf({ role: 'admin', allDepartmentAccess: true, departments: [] }))
      .toSQL();
    expect(strings(admin.params)).toEqual(['octane']);
    const other = commsSettingsRepo.buildGetQuery(ctxOf({ tenantId: OTHER_TENANT })).toSQL();
    expect(other.params).not.toContain('octane');
  });
});

describe('commsDepartmentRepo.buildListQuery — tenant-bound routing config', () => {
  it('binds the caller tenant and never a second one', () => {
    const { sql, params } = commsDepartmentRepo.buildListQuery(ctxOf()).toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it("does not bind the caller's own departments — the config list is not the grant", () => {
    // A department-scoped filter here would be wrong in the dangerous direction too: the create path
    // validates a TARGET queue the caller may not hold.
    const { params } = commsDepartmentRepo
      .buildListQuery(ctxOf({ departments: ['sales'] }))
      .toSQL();
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('acceptsTicketsOnly narrows on a boolean, adding no department binding', () => {
    const { params } = commsDepartmentRepo
      .buildListQuery(ctxOf(), { acceptsTicketsOnly: true })
      .toSQL();
    expect(params).toContain(true);
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });
});

describe('commsTicketRepo.buildListQuery — the thread reader filter IS the ticket filter', () => {
  const listSql = (ctx: TenantContext, opts = {}) =>
    commsTicketRepo.buildListQuery(ctx, opts).toSQL();

  it('binds the caller tenant and never a second one', () => {
    const { sql, params } = listSql(ctxOf());
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it('a different tenant produces the same SQL with a different binding', () => {
    const a = listSql(ctxOf({ tenantId: 'octane' }));
    const b = listSql(ctxOf({ tenantId: OTHER_TENANT }));
    expect(a.sql).toBe(b.sql);
    expect(b.params).not.toContain('octane');
  });

  it('CARRIES THE THREAD READER FILTER — both arms, not a ticket-shaped reimplementation', () => {
    const { sql, params } = listSql(ctxOf({ departments: ['customer-service'] }));
    // Participant arm (correlated EXISTS over thread members, worker-keyed, excluding leavers)…
    expect(sql).toContain('exists');
    expect(params).toContain('worker');
    expect(params).toContain('left');
    expect(params).toContain('42');
    // …ORed with the department arm.
    expect(sql).toContain(' or ');
    expect(params).toContain('department');
    expect(params).toContain('customer-service');
  });

  it('AN EMPTY DEPARTMENT GRANT COLLAPSES THE DEPARTMENT ARM TO FALSE, not to "no filter"', () => {
    const { sql, params } = listSql(ctxOf({ departments: [] }));
    expect(sql).toContain('false');
    expect(sql).toContain('exists'); // own tickets still reachable
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('no foreign department is ever bound, for any single-department grant', () => {
    for (const dept of KNOWN_DEPARTMENTS) {
      const { params } = listSql(ctxOf({ departments: [dept] }));
      for (const other of KNOWN_DEPARTMENTS.filter((d) => d !== dept)) {
        expect(strings(params), `ctx held only "${dept}" but bound "${other}"`).not.toContain(other);
      }
    }
  });

  it('a targetDepartment option NARROWS inside the grant — it never replaces the reader filter', () => {
    const { sql, params } = listSql(ctxOf({ departments: ['sales'] }), {
      targetDepartment: 'customer-service',
    });
    // The queue filter is additive; the reader arms are still there, so asking for another
    // department's queue returns nothing rather than that department's tickets.
    expect(sql).toContain('exists');
    expect(params).toContain('sales');
    expect(params).toContain('customer-service');
  });

  it('the reader member LEFT JOIN is keyed on the caller, and is `false` for a non-worker', () => {
    const worker = listSql(ctxOf());
    expect(worker.sql).toContain('left join');
    expect(worker.params).toContain('42');

    const customer = listSql(
      ctxOf({ audience: 'customer', userId: 'client:cu_9', role: 'viewer', departments: [] }),
    );
    // Shape preserved (same columns) but the join can never match, so no readSeq is borrowed from
    // someone else's member row.
    expect(customer.sql).toContain('left join');
    expect(customer.sql).toContain('false');
    expect(customer.params).not.toContain('cu_9');
  });

  it('A KEYSET CURSOR BINDS A ROW COMPARISON, NEVER AN OFFSET', () => {
    const createdAt = new Date('2026-07-30T10:11:12.000Z');
    const cursor = encodeTicketCursor({ createdAt, id: 'mtk_page2' });
    const { sql, params } = listSql(ctxOf(), { cursor });
    // Row comparison over (created_at, id) — matches the composite ORDER BY.
    expect(sql).toContain(') < (');
    expect(sql).toContain('created_at');
    expect(params).toContain(createdAt.toISOString());
    expect(params).toContain('mtk_page2');
    // An OFFSET page would re-show or skip rows the moment a ticket is filed.
    expect(sql.toLowerCase()).not.toContain('offset');
  });

  it('a garbage cursor is dropped rather than injected or 500ing', () => {
    const { sql, params } = listSql(ctxOf(), { cursor: 'not-a-cursor' });
    expect(sql).not.toContain(') < (');
    expect(params).toContain('octane');
  });

  it('a search term is parameterised and its LIKE metacharacters escaped', () => {
    const { params } = listSql(ctxOf(), { search: '100%_x' });
    expect(params).toContain('%100\\%\\_x%');
  });

  it('the limit is clamped and never taken raw from the caller', () => {
    expect(listSql(ctxOf(), { limit: 100_000 }).params).toContain(100);
    expect(listSql(ctxOf(), { limit: -5 }).params).toContain(1);
  });
});

describe('commsTicketRepo.buildFindQuery — the detail read cannot be looser than the list', () => {
  it('binds tenant + id AND the same reader filter', () => {
    const { sql, params } = commsTicketRepo.buildFindQuery(ctxOf(), 'mtk_1').toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).toContain('mtk_1');
    // The IDOR guard: an id alone is not authorization.
    expect(sql).toContain('exists');
    expect(params).toContain('42');
    expect(params).toContain('worker');
    expect(params).toContain('left');
  });

  it('a department-less caller gets the collapsed-to-false arm here too', () => {
    const { sql, params } = commsTicketRepo
      .buildFindQuery(ctxOf({ departments: [] }), 'mtk_1')
      .toSQL();
    expect(sql).toContain('false');
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('never binds a foreign tenant even when the id is guessed correctly', () => {
    const { params } = commsTicketRepo
      .buildFindQuery(ctxOf({ tenantId: OTHER_TENANT }), 'mtk_1')
      .toSQL();
    expect(params).toContain(OTHER_TENANT);
    expect(params).not.toContain('octane');
  });
});

describe('commsTicketEventRepo.buildListQuery — the journal is tenant + ticket scoped', () => {
  it('binds the caller tenant and the one ticket', () => {
    const { sql, params } = commsTicketEventRepo.buildListQuery(ctxOf(), 'mtk_1').toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).toContain('mtk_1');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it('binds no department — authorization is the caller\'s ticket read, not a second filter', () => {
    // Documented contract on the repo ("Authorization is the caller's job"): the route must have
    // already resolved the ticket through buildFindQuery. This asserts the journal does not *pretend*
    // to filter, which would be the more dangerous half-measure.
    const { params } = commsTicketEventRepo
      .buildListQuery(ctxOf({ departments: ['sales'] }), 'mtk_1')
      .toSQL();
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('clamps the limit at both ends', () => {
    expect(commsTicketEventRepo.buildListQuery(ctxOf(), 'mtk_1', 10_000).toSQL().params).toContain(
      500,
    );
    expect(commsTicketEventRepo.buildListQuery(ctxOf(), 'mtk_1', 0).toSQL().params).toContain(1);
  });
});

describe('commsEscalationRepo — escalations are gated by the SAME thread filter', () => {
  it('the list binds the tenant and carries the thread reader filter', () => {
    const { sql, params } = commsEscalationRepo.buildListQuery(ctxOf()).toSQL();
    expect(sql).toContain('"tenant_id"');
    // The join onto threads is what makes commsThreadReaderFilter applicable at all — without it the
    // escalation table would be read with no gate whatsoever.
    expect(sql).toContain('"mytrion_threads"');
    expect(sql).toContain('exists');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it('an escalation is participants-only, so an empty department grant still yields the participant arm', () => {
    // Escalation threads are visibility='participants' for life, so the department arm can never match
    // one. This asserts the query still binds the ACTOR — otherwise a caller with no departments would
    // fall through to an unfiltered read.
    const { sql, params } = commsEscalationRepo.buildListQuery(ctxOf({ departments: [] })).toSQL();
    expect(sql).toContain('false');
    expect(params).toContain('42');
    expect(params).toContain('octane');
  });

  it('a non-worker identity cannot participate, so the participant arm collapses to false', () => {
    const { sql } = commsEscalationRepo
      .buildListQuery(ctxOf({ audience: 'customer', userId: 'client:cu_1', departments: [] }))
      .toSQL();
    expect(sql).toContain('false');
  });

  it('a different tenant produces the same shape with a different binding', () => {
    const a = commsEscalationRepo.buildListQuery(ctxOf()).toSQL();
    const b = commsEscalationRepo.buildListQuery(ctxOf({ tenantId: OTHER_TENANT })).toSQL();
    expect(a.sql).toBe(b.sql);
    expect(b.params).toContain(OTHER_TENANT);
    expect(b.params).not.toContain('octane');
  });

  it('scope filters narrow inside the gate — the reader filter is still present with them', () => {
    const { sql, params } = commsEscalationRepo
      .buildListQuery(ctxOf(), { currentAssigneeZohoUserId: '88', status: ['pending'] })
      .toSQL();
    expect(sql).toContain('exists');
    expect(params).toContain('88');
    expect(params).toContain('pending');
    expect(params).toContain('octane');
  });

  it('the hop chain is tenant + escalation scoped and binds no department', () => {
    const { sql, params } = commsEscalationRepo.buildHopsQuery(ctxOf(), 'mesc_1').toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).toContain('mesc_1');
    // Same contract as the ticket journal: authorization is the caller's readable escalation load, and
    // this query must not pretend to filter on something it does not.
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('clamps the list limit at both ends', () => {
    expect(commsEscalationRepo.buildListQuery(ctxOf(), { limit: 10_000 }).toSQL().params).toContain(200);
    expect(commsEscalationRepo.buildListQuery(ctxOf(), { limit: 0 }).toSQL().params).toContain(1);
  });
});

describe('commsAnalyticsRepo.buildScalarQuery — the dashboard counts what the queue can see', () => {
  // Every analytics query shares this builder's baseWhere + join, so the gate proven here holds for
  // all of them: an unfiltered dashboard would leak counts of tickets the agent may never open.
  const analyticsSql = (ctx: TenantContext, filter = {}) =>
    commsAnalyticsRepo.buildScalarQuery(ctx, filter).toSQL();

  it('binds the caller tenant and never a second one', () => {
    const { sql, params } = analyticsSql(ctxOf());
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it('CARRIES THE THREAD READER FILTER — both arms, the same gate as the ticket list', () => {
    const { sql, params } = analyticsSql(ctxOf({ departments: ['customer-service'] }));
    expect(sql).toContain('exists');
    expect(params).toContain('worker');
    expect(params).toContain('left');
    expect(params).toContain('42');
    expect(sql).toContain(' or ');
    expect(params).toContain('customer-service');
  });

  it('an empty department grant collapses the department arm to false, not to "no filter"', () => {
    const { sql, params } = analyticsSql(ctxOf({ departments: [] }));
    expect(sql).toContain('false');
    expect(sql).toContain('exists'); // own tickets still counted
    for (const dept of KNOWN_DEPARTMENTS) expect(params).not.toContain(dept);
  });

  it('a department filter NARROWS inside the grant — it never replaces the reader filter', () => {
    const { sql, params } = analyticsSql(ctxOf({ departments: ['sales'] }), {
      department: 'customer-service',
    });
    expect(sql).toContain('exists');
    expect(params).toContain('sales');
    expect(params).toContain('customer-service');
  });

  it('a different tenant produces the same SQL with a different binding', () => {
    const a = analyticsSql(ctxOf({ tenantId: 'octane' }));
    const b = analyticsSql(ctxOf({ tenantId: OTHER_TENANT }));
    expect(a.sql).toBe(b.sql);
    expect(b.params).not.toContain('octane');
  });
});

describe('commsDepartmentRepo.buildPoolQuery — the pool is tenant-scoped', () => {
  it('binds the caller tenant, never a foreign one', () => {
    const { sql, params } = commsDepartmentRepo.buildPoolQuery(ctxOf()).toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER_TENANT);
  });

  it('binds only the departments explicitly asked for — the caller grant must not narrow it', () => {
    // The pool is admin config, not caller-scoped data: an admin editing the c-level pool holds no
    // 'c-level' department, and filtering by their grant would hide the rows they came to edit.
    const { params } = commsDepartmentRepo
      .buildPoolQuery(ctxOf({ departments: ['sales'] }), { departments: ['c-level'] })
      .toSQL();
    expect(params).toContain('c-level');
    expect(params).not.toContain('sales');
  });

  it('activeOnly is opt-in, so an admin can see deactivated seats', () => {
    expect(commsDepartmentRepo.buildPoolQuery(ctxOf()).toSQL().params).not.toContain(true);
    expect(
      commsDepartmentRepo.buildPoolQuery(ctxOf(), { activeOnly: true }).toSQL().params,
    ).toContain(true);
  });
});
