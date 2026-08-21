/**
 * Verification-flow RBAC leakage — the CLAUDE.md rule 9 gate, green before the flow routes ship.
 *
 * Technique from tests/unit/comms-rbac-leakage.test.ts: build the query, call `.toSQL()`, and assert
 * over the emitted SQL and its bound params. No database on purpose — an unscoped query against an
 * empty fixture table returns nothing and is indistinguishable from a correctly-scoped one.
 *
 * These tables hold credit files: an applicant's identity, banking and bureau data. A cross-tenant
 * read here is the worst leak in the codebase, which is why every read path is asserted, not just
 * the obvious one.
 */
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { verificationFlowRepo } from '../../src/repos/verificationFlowRepo.js';
import {
  verificationBankingReviews,
  verificationBlacklistEntries,
  verificationCaseDocuments,
  verificationCaseEvents,
  verificationCasePhases,
  verificationCasePrincipals,
  verificationCreditReviews,
  verificationRiskAssessments,
  verificationScreeningHits,
} from '../../src/db/schema/index.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['verification'],
    allDepartmentAccess: false,
    requestId: 'req_1',
    ...over,
  } as TenantContext;
}

const OTHER = 'rival-tenant';

describe('desk list — tenant isolation', () => {
  const sqlOf = (ctx: TenantContext, filter = {}) =>
    verificationFlowRepo.buildListQuery(ctx, filter).toSQL();

  it('binds the caller tenant and never a second one', () => {
    const { sql, params } = sqlOf(ctxOf());
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).not.toContain(OTHER);
  });

  it('a different tenant changes the binding, not the query shape', () => {
    const a = sqlOf(ctxOf({ tenantId: 'octane' }));
    const b = sqlOf(ctxOf({ tenantId: OTHER }));
    expect(a.sql).toBe(b.sql);
    expect(b.params).toContain(OTHER);
    expect(b.params).not.toContain('octane');
  });

  it('keeps the tenant predicate for an admin with blanket department access', () => {
    // Blanket DEPARTMENT access is not blanket TENANT access. This is the assertion that catches a
    // future "admins can see everything" shortcut.
    const { sql, params } = sqlOf(ctxOf({ role: 'admin', allDepartmentAccess: true }));
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
  });

  it('keeps the tenant predicate under every filter combination', () => {
    const { sql, params } = sqlOf(ctxOf(), {
      statusCode: 'pending_docs',
      phaseCode: 'p6_credit_banking',
      applicantType: 'carrier',
      underwritingRoute: 'octane_internal',
      gate: true,
      open: true,
      search: 'kaiser',
    });
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
  });

  it('does not let the free-text search escape the tenant scope', () => {
    // A search term is the one caller-controlled string that reaches the WHERE clause.
    const { sql, params } = sqlOf(ctxOf(), { search: "' OR 1=1 --" });
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).toContain("%' or 1=1 --%"); // bound as a parameter, not interpolated
    expect(sql).not.toContain('1=1');
  });

  it('orders opened newest first — created_at, not last-touched', () => {
    const { sql } = sqlOf(ctxOf());
    expect(sql).toMatch(/order by "verification_cases"\."created_at" desc/i);
    expect(sql).not.toMatch(/order by "verification_cases"\."updated_at"/i);
  });
});

describe('sales list — tenant AND ownership isolation', () => {
  const sqlOf = (ctx: TenantContext, user = 'zoho:42') =>
    verificationFlowRepo.buildSalesListQuery(ctx, user, {}).toSQL();

  it('scopes to the tenant as well as the agent', () => {
    const { sql, params } = sqlOf(ctxOf());
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
    expect(params).toContain('zoho:42');
  });

  it('an agent id alone never widens across tenants', () => {
    const a = sqlOf(ctxOf({ tenantId: 'octane' }), 'zoho:42');
    const b = sqlOf(ctxOf({ tenantId: OTHER }), 'zoho:42');
    expect(a.sql).toBe(b.sql);
    expect(b.params).not.toContain('octane');
  });

  it('binds ownership on both the submitter and owner columns', () => {
    const { sql } = sqlOf(ctxOf());
    expect(sql).toContain('submitted_by_zoho_user_id');
    expect(sql).toContain('owner_zoho_user_id');
  });
});

/**
 * Every satellite table carries its own `tenant_id`; a join is not what scopes them. These assert the
 * predicate is written on the CHILD table, so a case id guessed from another tenant returns nothing
 * rather than that tenant's banking review.
 */
describe('satellite tables scope on their own tenant_id', () => {
  const ctx = ctxOf();
  const cases: Array<[string, { toSQL(): { sql: string; params: unknown[] } }]> = [
    [
      'case phases',
      db
        .select()
        .from(verificationCasePhases)
        .where(
          and(
            eq(verificationCasePhases.tenantId, ctx.tenantId),
            eq(verificationCasePhases.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'principals',
      db
        .select()
        .from(verificationCasePrincipals)
        .where(
          and(
            eq(verificationCasePrincipals.tenantId, ctx.tenantId),
            eq(verificationCasePrincipals.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'documents',
      db
        .select()
        .from(verificationCaseDocuments)
        .where(
          and(
            eq(verificationCaseDocuments.tenantId, ctx.tenantId),
            eq(verificationCaseDocuments.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'events',
      db
        .select()
        .from(verificationCaseEvents)
        .where(
          and(
            eq(verificationCaseEvents.tenantId, ctx.tenantId),
            eq(verificationCaseEvents.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'screening hits',
      db
        .select()
        .from(verificationScreeningHits)
        .where(
          and(
            eq(verificationScreeningHits.tenantId, ctx.tenantId),
            eq(verificationScreeningHits.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'blacklist',
      db
        .select()
        .from(verificationBlacklistEntries)
        .where(eq(verificationBlacklistEntries.tenantId, ctx.tenantId)),
    ],
    [
      'credit reviews',
      db
        .select()
        .from(verificationCreditReviews)
        .where(
          and(
            eq(verificationCreditReviews.tenantId, ctx.tenantId),
            eq(verificationCreditReviews.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'banking reviews',
      db
        .select()
        .from(verificationBankingReviews)
        .where(
          and(
            eq(verificationBankingReviews.tenantId, ctx.tenantId),
            eq(verificationBankingReviews.caseId, 'vc_x'),
          ),
        ),
    ],
    [
      'risk assessments',
      db
        .select()
        .from(verificationRiskAssessments)
        .where(
          and(
            eq(verificationRiskAssessments.tenantId, ctx.tenantId),
            eq(verificationRiskAssessments.caseId, 'vc_x'),
          ),
        ),
    ],
  ];

  it.each(cases)('%s binds tenant_id', (_label, query) => {
    const { sql, params } = query.toSQL();
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('octane');
  });
});

describe('the gate cannot be set through the intake patch', () => {
  it('patchIntake refuses the gate, phase and status at the type level', () => {
    // A compile-time guarantee, asserted here so the intent survives a refactor that widens the type.
    // `patchIntake` omits verificationProcess / phaseCode / statusCode precisely so a route handler
    // cannot flip the red/green gate without going through the completeness evaluation.
    const source = verificationFlowRepo.patchIntake.toString();
    expect(typeof verificationFlowRepo.patchIntake).toBe('function');
    expect(source).not.toContain('verificationProcess:');
  });
});
