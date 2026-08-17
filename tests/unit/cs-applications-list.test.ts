/**
 * Pure logic tests for applicationsListQuery.ts — the server-side port of the removed client-side
 * applicationsFilters.ts (see that file's former test, applicationsFilters.test.ts, for the cases
 * ported here) plus the new pagination/facet/tiebreaker behavior that only makes sense server-side.
 */
import { describe, expect, it } from 'vitest';
import type { RawApplicationRow } from '../../src/integrations/csApplicationsQuery.js';
import {
  agentNameOf,
  compareRows,
  computeFacets,
  LOVES_PENDING,
  lovesStatusOf,
  matchesFilters,
  matchesSearch,
  matchesTab,
  NOT_ASSIGNED,
  paginate,
  queryApplications,
  type ApplicationsQueryParams,
} from '../../src/modules/customerService/applicationsListQuery.js';

function mkRow(overrides: Partial<RawApplicationRow> = {}): RawApplicationRow {
  return {
    id: 'r1',
    Application_ID: null,
    Name: null,
    First_Name: null,
    Last_Name: null,
    Type_of_Business: null,
    Stage: null,
    WEX_Status: null,
    emc: null,
    DOT: null,
    Phone: null,
    Email: null,
    Address: null,
    City: null,
    State: null,
    Zip_Code: null,
    Credit_Score: null,
    Number_of_Trucks: null,
    Cards_Requested: null,
    Date_Filled: null,
    Customer_Service_Notes: null,
    Billing_Cycle: null,
    Email_to_TA: null,
    TA_EFS_Added: null,
    Limits_Added: null,
    Mobile_Driver_App: null,
    Chain_Policy: null,
    Verified: null,
    Carrier_ID: null,
    _dealOwner: null,
    Payment_Type_Billing: null,
    Loves_Verification: null,
    ...overrides,
  };
}

function baseParams(overrides: Partial<ApplicationsQueryParams> = {}): ApplicationsQueryParams {
  return {
    tab: 'apps',
    search: '',
    sortKey: 'date',
    sortDir: 'desc',
    dateFrom: '',
    dateTo: '',
    stage: '',
    biz: '',
    agent: '',
    wex: [],
    loves: '',
    page: 1,
    perPage: 200,
    ...overrides,
  };
}

describe('matchesTab', () => {
  it('apps = no Carrier_ID, clients = has one', () => {
    const withCarrier = mkRow({ Carrier_ID: '5000001' });
    const without = mkRow({ Carrier_ID: null });
    expect(matchesTab(withCarrier, 'clients')).toBe(true);
    expect(matchesTab(withCarrier, 'apps')).toBe(false);
    expect(matchesTab(without, 'apps')).toBe(true);
    expect(matchesTab(without, 'clients')).toBe(false);
  });
});

describe('agentNameOf', () => {
  it('falls back to the "not assigned" sentinel when there is no matched deal', () => {
    expect(agentNameOf(mkRow({ _dealOwner: null }))).toBe(NOT_ASSIGNED);
  });

  it('falls back when the owner name is blank/whitespace', () => {
    expect(agentNameOf(mkRow({ _dealOwner: { id: '1', name: '   ' } }))).toBe(NOT_ASSIGNED);
  });

  it('uses the resolved owner name', () => {
    expect(agentNameOf(mkRow({ _dealOwner: { id: '1', name: 'Islombek Mamurov' } }))).toBe('Islombek Mamurov');
  });
});

describe('lovesStatusOf', () => {
  it('falls back to the Pending sentinel when blank', () => {
    expect(lovesStatusOf(mkRow({ Loves_Verification: null }))).toBe(LOVES_PENDING);
    expect(lovesStatusOf(mkRow({ Loves_Verification: '' }))).toBe(LOVES_PENDING);
  });

  it('uses the real value when set', () => {
    expect(lovesStatusOf(mkRow({ Loves_Verification: 'Approved' }))).toBe('Approved');
    expect(lovesStatusOf(mkRow({ Loves_Verification: 'Declined' }))).toBe('Declined');
  });
});

describe('matchesSearch', () => {
  it('empty search matches everything', () => {
    expect(matchesSearch(mkRow(), '')).toBe(true);
  });

  it('matches company name case-insensitively as a substring', () => {
    expect(matchesSearch(mkRow({ Name: 'Star22logistics llc' }), 'star22')).toBe(true);
    expect(matchesSearch(mkRow({ Name: 'Star22logistics llc' }), 'bravo')).toBe(false);
  });

  it('matches Carrier_ID as a substring', () => {
    expect(matchesSearch(mkRow({ Carrier_ID: '5001234' }), '1234')).toBe(true);
  });

  it('matches Application_ID exactly on digits', () => {
    expect(matchesSearch(mkRow({ Application_ID: 901986 }), '901986')).toBe(true);
    expect(matchesSearch(mkRow({ Application_ID: 901986 }), '901987')).toBe(false);
  });

  it('matches phone across formatting — digits compared on both sides', () => {
    const row = mkRow({ Phone: '(702) 989-4445' });
    expect(matchesSearch(row, '7029894445')).toBe(true);
    expect(matchesSearch(row, '702-989-4445')).toBe(true);
    expect(matchesSearch(row, '9894445')).toBe(true);
  });
});

describe('matchesFilters', () => {
  const rows = [
    mkRow({ id: '1', Name: 'Acme Hauling', Stage: 'Adjudication', Type_of_Business: 'LLC', _dealOwner: { id: 'a', name: 'Jane' }, WEX_Status: 'Decisioned', Date_Filled: '2026-08-01' }),
    mkRow({ id: '2', Name: 'Bravo Freight', Stage: 'Application', Type_of_Business: 'Corporation', _dealOwner: null, WEX_Status: 'Pending Decision', Date_Filled: '2026-08-15' }),
  ];

  it('filters by an exact stage match', () => {
    expect(rows.filter((r) => matchesFilters(r, { ...baseParams(), stage: 'Application' })).map((r) => r.id)).toEqual(['2']);
  });

  it('filters by business type', () => {
    expect(rows.filter((r) => matchesFilters(r, { ...baseParams(), biz: 'LLC' })).map((r) => r.id)).toEqual(['1']);
  });

  it('filters by agent, including the "not assigned" sentinel', () => {
    expect(rows.filter((r) => matchesFilters(r, { ...baseParams(), agent: NOT_ASSIGNED })).map((r) => r.id)).toEqual(['2']);
  });

  it('WEX status filter is multi-select — any selected status matches', () => {
    const f = { ...baseParams(), wex: ['Decisioned', 'Pending Decision'] };
    expect(rows.filter((r) => matchesFilters(r, f)).map((r) => r.id).sort()).toEqual(['1', '2']);
    expect(rows.filter((r) => matchesFilters(r, { ...baseParams(), wex: ['Decisioned'] })).map((r) => r.id)).toEqual(['1']);
  });

  it('date range is inclusive on both ends', () => {
    const f = { ...baseParams(), dateFrom: '2026-08-01', dateTo: '2026-08-01' };
    expect(rows.filter((r) => matchesFilters(r, f)).map((r) => r.id)).toEqual(['1']);
  });

  it('excludes rows with no date on file once a date filter is active', () => {
    const withBlank = [...rows, mkRow({ id: '3', Date_Filled: null })];
    const f = { ...baseParams(), dateFrom: '2026-01-01' };
    expect(withBlank.filter((r) => matchesFilters(r, f)).map((r) => r.id)).not.toContain('3');
  });

  it('combines multiple active filters with AND', () => {
    const f = { ...baseParams(), biz: 'LLC', stage: 'Application' };
    expect(rows.filter((r) => matchesFilters(r, f))).toHaveLength(0);
  });

  it('returns every row when no filter is active', () => {
    expect(rows.filter((r) => matchesFilters(r, baseParams()))).toHaveLength(2);
  });

  it("Love's status filter matches the Pending sentinel for a blank field, and the real value otherwise", () => {
    const pending = mkRow({ id: 'p', Loves_Verification: null });
    const approved = mkRow({ id: 'a', Loves_Verification: 'Approved' });
    const declined = mkRow({ id: 'd', Loves_Verification: 'Declined' });
    const all = [pending, approved, declined];
    expect(all.filter((r) => matchesFilters(r, { ...baseParams(), loves: LOVES_PENDING })).map((r) => r.id)).toEqual(['p']);
    expect(all.filter((r) => matchesFilters(r, { ...baseParams(), loves: 'Approved' })).map((r) => r.id)).toEqual(['a']);
    expect(all.filter((r) => matchesFilters(r, baseParams()))).toHaveLength(3); // no loves filter active
  });
});

describe('computeFacets', () => {
  it('dedupes, drops empties, and sorts', () => {
    const rows = [mkRow({ Stage: 'B' }), mkRow({ Stage: 'A' }), mkRow({ Stage: 'A' }), mkRow({ Stage: null })];
    expect(computeFacets(rows).stage).toEqual(['A', 'B']);
  });

  it('agent facet includes the "not assigned" sentinel when relevant rows have no deal owner', () => {
    const rows = [mkRow({ _dealOwner: { id: '1', name: 'Jane' } }), mkRow({ _dealOwner: null })];
    expect(computeFacets(rows).agent).toEqual(['Jane', NOT_ASSIGNED]);
  });

  it("loves facet is always the field's fixed vocabulary, not derived from the data — legacy junk values ('0', 'FALSE', 'Not Approved') must never appear as options", () => {
    const rows = [mkRow({ Loves_Verification: '0' }), mkRow({ Loves_Verification: 'Not Approved' })];
    expect(computeFacets(rows).loves).toEqual(['Approved', 'Declined', LOVES_PENDING]);
    expect(computeFacets([]).loves).toEqual(['Approved', 'Declined', LOVES_PENDING]); // even with zero rows
  });
});

describe('compareRows', () => {
  it('sorts appId numerically, not lexicographically — different digit lengths would rank wrong as strings', () => {
    const a = mkRow({ id: 'a', Application_ID: 500000005 });
    const b = mkRow({ id: 'b', Application_ID: 90000123 });
    expect(compareRows(b, a, 'appId', 'asc')).toBeLessThan(0); // 90000123 < 500000005
  });

  it('sorts carrierId numerically when both parse', () => {
    const a = mkRow({ id: 'a', Carrier_ID: '500000005' });
    const b = mkRow({ id: 'b', Carrier_ID: '90000123' });
    expect(compareRows(b, a, 'carrierId', 'asc')).toBeLessThan(0);
  });

  it('sorts by Date Filled chronologically', () => {
    const jan27 = mkRow({ id: 'jan27', Date_Filled: '2027-01-15' });
    const mar26 = mkRow({ id: 'mar26', Date_Filled: '2026-03-01' });
    expect(compareRows(mar26, jan27, 'date', 'asc')).toBeLessThan(0);
  });

  it('sinks rows with no value to the bottom regardless of direction', () => {
    const has = mkRow({ id: 'has', Carrier_ID: '5000001' });
    const none = mkRow({ id: 'none', Carrier_ID: null });
    expect(compareRows(has, none, 'carrierId', 'asc')).toBeLessThan(0);
    expect(compareRows(has, none, 'carrierId', 'desc')).toBeLessThan(0);
  });

  it('desc reverses the asc order', () => {
    const a = mkRow({ id: 'a', Application_ID: 1 });
    const b = mkRow({ id: 'b', Application_ID: 2 });
    expect(compareRows(a, b, 'appId', 'asc')).toBeLessThan(0);
    expect(compareRows(a, b, 'appId', 'desc')).toBeGreaterThan(0);
  });

  it('breaks a tie on the sort key deterministically by id', () => {
    const a = mkRow({ id: 'b-row', Application_ID: 5 });
    const b = mkRow({ id: 'a-row', Application_ID: 5 });
    // Same Application_ID on both — id is the tiebreaker, independent of sortDir on the primary key.
    expect(compareRows(a, b, 'appId', 'asc')).toBeGreaterThan(0);
    expect(compareRows(b, a, 'appId', 'asc')).toBeLessThan(0);
  });
});

describe('paginate', () => {
  const rows = Array.from({ length: 5 }, (_, i) => mkRow({ id: String(i) }));

  it('slices the requested page', () => {
    const res = paginate(rows, 1, 2);
    expect(res.rows.map((r) => r.id)).toEqual(['0', '1']);
    expect(res.total).toBe(5);
    expect(res.moreRecords).toBe(true);
  });

  it('reports no more records on the exact last page', () => {
    const res = paginate(rows, 3, 2);
    expect(res.rows.map((r) => r.id)).toEqual(['4']);
    expect(res.moreRecords).toBe(false);
  });

  it('returns empty with no more records past the end', () => {
    const res = paginate(rows, 10, 2);
    expect(res.rows).toEqual([]);
    expect(res.moreRecords).toBe(false);
  });
});

describe('queryApplications', () => {
  const rows = [
    mkRow({ id: '1', Name: 'Acme Hauling', Carrier_ID: null, Stage: 'Adjudication', Application_ID: 100 }),
    mkRow({ id: '2', Name: 'Acme Trucking', Carrier_ID: null, Stage: 'Application', Application_ID: 200 }),
    mkRow({ id: '3', Name: 'Bravo Freight', Carrier_ID: null, Stage: 'Adjudication', Application_ID: 300 }),
  ];

  it('facets reflect the search-filtered set, BEFORE field filters are applied', () => {
    // Both 'acme' rows are in the apps tab; stage filter narrows the RESULT to one, but the facet
    // list should still show both stage values present after search — picking a Stage must not
    // make the other option vanish from that same dropdown.
    const res = queryApplications(rows, { ...baseParams(), tab: 'apps', search: 'acme', stage: 'Adjudication' });
    expect(res.facets.stage.sort()).toEqual(['Adjudication', 'Application']);
    expect(res.rows.map((r) => r.id)).toEqual(['1']);
  });

  it('composes tab + search + filter + sort + paginate', () => {
    const withOneClient = [...rows, mkRow({ id: '4', Carrier_ID: '5000001', Application_ID: 50 })];
    const res = queryApplications(withOneClient, {
      ...baseParams(),
      tab: 'apps',
      search: '',
      sortKey: 'appId',
      sortDir: 'asc',
      perPage: 1,
      page: 2,
    });
    // apps tab excludes row 4 (has a Carrier_ID); sorted by appId asc -> [1 (100), 2 (200), 3 (300)];
    // page 2 of size 1 -> [2].
    expect(res.rows.map((r) => r.id)).toEqual(['2']);
    expect(res.total).toBe(3);
    expect(res.moreRecords).toBe(true);
  });
});
