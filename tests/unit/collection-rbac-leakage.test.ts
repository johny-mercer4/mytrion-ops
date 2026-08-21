/**
 * Collection snapshot isolation — the CLAUDE.md rule 9 gate for tables that have no tenant_id.
 *
 * The finder-owned rows are UNIQUE on carrier (or carrier+period). A rival tenant that holds
 * the `collection` department must still see nothing. The assertion is the repo short-circuit,
 * not a SQL `tenant_id` bind — there is no such column, same as maintenance_cases.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { canReadCollectionSnapshot } from '../../src/repos/collectionAccess.js';
import { arrayReportRepo, buildArrayListQuery, buildArrayWhere } from '../../src/repos/arrayReportRepo.js';
import { collectionActivityRepo } from '../../src/repos/collectionActivityRepo.js';
import { collectionCaseRepo, buildCaseListQuery, buildCaseWhere } from '../../src/repos/collectionCaseRepo.js';
import { collectionPlacementRepo } from '../../src/repos/collectionPlacementRepo.js';
import { collectionPlanRepo } from '../../src/repos/collectionPlanRepo.js';
import { collectionWorklistRepo } from '../../src/repos/collectionWorklistRepo.js';
import { normalizePagination } from '../../src/repos/util.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['collection'],
    allDepartmentAccess: false,
    requestId: 'req_1',
    ...over,
  } as TenantContext;
}

const OTHER = 'rival-tenant';

describe('octane-only snapshot gate', () => {
  it('admits the default tenant and refuses every other', () => {
    expect(canReadCollectionSnapshot(ctxOf())).toBe(true);
    expect(canReadCollectionSnapshot(ctxOf({ tenantId: OTHER }))).toBe(false);
    expect(canReadCollectionSnapshot(ctxOf({ tenantId: OTHER, role: 'admin', allDepartmentAccess: true }))).toBe(
      false,
    );
  });

  it('list/detail return empty for a rival tenant without reading the book', async () => {
    const rival = ctxOf({ tenantId: OTHER });
    await expect(collectionCaseRepo.list(rival)).resolves.toEqual({
      items: [],
      total: 0,
      aggregates: { open: 0, closed: 0, remainingDebt: '0', byStage: {} },
    });
    await expect(collectionCaseRepo.findById(rival, 'cc_1')).resolves.toBeUndefined();
    await expect(collectionCaseRepo.listInvoices(rival, 'cc_1')).resolves.toEqual({ items: [], total: 0 });
    await expect(arrayReportRepo.list(rival)).resolves.toEqual({
      items: [],
      total: 0,
      aggregates: { total: 0, needsDob: 0, withAgency: 0 },
    });
    await expect(arrayReportRepo.findById(rival, 'ar_1')).resolves.toBeUndefined();
    await expect(arrayReportRepo.facets(rival)).resolves.toEqual({
      periods: [],
      accountStatuses: [],
      agencies: [],
    });
  });
});

/**
 * The desk tables added in 0129 have no tenant_id either, so every new read has to short-circuit
 * on the SAME gate. Written as a table rather than five near-identical `it`s: the point is that
 * NONE of them is missing the check, and a list is what makes an omission visible.
 */
describe('desk tables are behind the same gate', () => {
  const rival = ctxOf({ tenantId: OTHER });

  it('returns nothing for a rival tenant, on every desk read', async () => {
    await expect(collectionActivityRepo.listByCase(rival, 'cc_1')).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(collectionActivityRepo.lastContactByCase(rival, ['cc_1'])).resolves.toEqual(new Map());
    await expect(collectionPlanRepo.listPromises(rival, 'cc_1')).resolves.toEqual([]);
    await expect(collectionPlanRepo.openPromisesByCase(rival, ['cc_1'])).resolves.toEqual(new Map());
    await expect(collectionPlanRepo.activePlan(rival, 'cc_1')).resolves.toBeNull();
    await expect(collectionPlanRepo.planProgressByCase(rival, ['cc_1'])).resolves.toEqual(new Map());
    await expect(collectionWorklistRepo.deskInfoByCase(rival, ['cc_1'])).resolves.toEqual(new Map());
  });

  it('the worklist and the placement queue are empty for a rival tenant', async () => {
    await expect(collectionWorklistRepo.worklist(rival)).resolves.toMatchObject({
      items: [],
      total: 0,
      scanTruncated: false,
    });
    await expect(collectionWorklistRepo.recovery(rival)).resolves.toEqual({
      recoveredMtd: '0',
      openCases: 0,
      remainingDebt: '0',
      agencyPlaced: 0,
    });
    await expect(collectionPlacementRepo.queue(rival)).resolves.toMatchObject({ items: [], total: 0 });
    await expect(collectionPlacementRepo.latestForCarrier(rival, '5104821')).resolves.toBeNull();
  });

  it('an empty id list never reaches Postgres, even for the default tenant', async () => {
    const octane = ctxOf();
    await expect(collectionActivityRepo.lastContactByCase(octane, [])).resolves.toEqual(new Map());
    await expect(collectionPlanRepo.openPromisesByCase(octane, [])).resolves.toEqual(new Map());
    await expect(collectionPlanRepo.planProgressByCase(octane, [])).resolves.toEqual(new Map());
    await expect(collectionWorklistRepo.deskInfoByCase(octane, [])).resolves.toEqual(new Map());
  });
});

describe('list query shape', () => {
  it('cases list binds search and never a second tenant id', () => {
    const { sql, params } = buildCaseListQuery({
      search: 'kaiser',
      status: 'open',
      offset: 50,
    }).toSQL();
    expect(sql.toLowerCase()).toContain('limit');
    expect(sql.toLowerCase()).toContain('offset');
    expect(params).toContain('open');
    expect(params).toContain('%kaiser%');
    expect(params).not.toContain(OTHER);
  });

  it('array list is always limited and stably ordered', () => {
    const { sql, params } = buildArrayListQuery({ limit: 50, offset: 100, reportPeriod: 'Aug 2026' }).toSQL();
    expect(sql.toLowerCase()).toContain('limit');
    expect(sql.toLowerCase()).toContain('offset');
    expect(params).toContain(50);
    expect(params).toContain(100);
    expect(params).toContain('Aug 2026');
  });

  it('array agency=none is a NULL check, not a string match on "none"', () => {
    expect(buildArrayWhere({ agency: 'none' })).toBeDefined();
    const { sql, params } = buildArrayListQuery({ agency: 'none' }).toSQL();
    expect(sql.toLowerCase()).toContain('is null');
    expect(params).not.toContain('none');
  });

  it('case where is undefined when no filters are set — the page is the whole book, still capped', () => {
    expect(buildCaseWhere({})).toBeUndefined();
    const { sql, params } = buildCaseListQuery({}).toSQL();
    expect(sql.toLowerCase()).toContain('limit');
    expect(params).toContain(50);
  });
});

describe('pagination clamp', () => {
  it('caps array pages at 100 and cases at 500', () => {
    expect(normalizePagination({ limit: 9258 }, 100)).toEqual({ limit: 100, offset: 0 });
    expect(normalizePagination({ limit: 0, offset: -4 }, 500)).toEqual({ limit: 1, offset: 0 });
    expect(normalizePagination({ limit: 50, offset: 20 }, 100)).toEqual({ limit: 50, offset: 20 });
  });
});
