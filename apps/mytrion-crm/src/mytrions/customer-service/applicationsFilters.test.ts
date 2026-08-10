/**
 * QA feedback 2026-08-10: sort by Date Filled / Application ID / Carrier ID, filter by company
 * name / date range / stage / WEX status(es) / business type / agent. This is pure client-side
 * logic over the loaded page (see the header comment in applicationsFilters.ts for why there's no
 * server-side equivalent) — covering it here is cheaper and more precise than covering it through
 * the Applications panel's rendering.
 */
import { describe, expect, it } from 'vitest';
import type { Application } from './data';
import {
  activeFilterCount,
  distinctValues,
  emptyFilters,
  filterApplications,
  sortApplications,
} from './applicationsFilters';

function mkApp(overrides: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    appId: '',
    company: '',
    first: '',
    last: '',
    biz: '',
    stage: '',
    wex: '',
    mc: '',
    dot: '',
    phone: '',
    email: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    credit: null,
    trucks: 0,
    cards: 0,
    date: '',
    dateFilledRaw: '',
    agent: '',
    notes: '',
    cycle: '',
    pay: '',
    ta: 0,
    efs: 0,
    lmt: 0,
    mob: 0,
    chn: 0,
    verified: false,
    carrierId: '',
    ...overrides,
  };
}

describe('sortApplications', () => {
  it('sorts appId/carrierId numerically, not lexicographically — different digit lengths would rank wrong as strings', () => {
    const rows = [mkApp({ id: 'a', appId: '500000005' }), mkApp({ id: 'b', appId: '90000123' })];
    // '9...' > '5...' lexicographically, but 90000123 < 500000005 numerically.
    const asc = sortApplications(rows, 'appId', 'asc');
    expect(asc.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts by Date Filled chronologically, not by the display string', () => {
    const rows = [
      mkApp({ id: 'jan27', dateFilledRaw: '2027-01-15' }),
      mkApp({ id: 'mar26', dateFilledRaw: '2026-03-01' }),
    ];
    // 'Jan' < 'Mar' alphabetically, but Jan 2027 is chronologically AFTER Mar 2026.
    const asc = sortApplications(rows, 'date', 'asc');
    expect(asc.map((r) => r.id)).toEqual(['mar26', 'jan27']);
  });

  it('sinks rows with no value to the bottom regardless of direction', () => {
    const rows = [
      mkApp({ id: 'has', carrierId: '5000001' }),
      mkApp({ id: 'none', carrierId: '' }),
    ];
    expect(sortApplications(rows, 'carrierId', 'asc').map((r) => r.id)).toEqual(['has', 'none']);
    expect(sortApplications(rows, 'carrierId', 'desc').map((r) => r.id)).toEqual(['has', 'none']);
  });

  it('desc reverses the asc order', () => {
    const rows = [mkApp({ id: 'a', appId: '1' }), mkApp({ id: 'b', appId: '2' })];
    expect(sortApplications(rows, 'appId', 'desc').map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('filterApplications', () => {
  const rows = [
    mkApp({ id: '1', company: 'Acme Hauling', stage: 'Adjudication', biz: 'LLC', agent: 'Jane', wex: 'Decisioned', dateFilledRaw: '2026-08-01' }),
    mkApp({ id: '2', company: 'Bravo Freight', stage: 'Application', biz: 'Corporation', agent: 'not assigned', wex: 'Pending Decision', dateFilledRaw: '2026-08-15' }),
  ];

  it('matches company name case-insensitively as a substring', () => {
    expect(filterApplications(rows, { ...emptyFilters(), company: 'acme' }).map((r) => r.id)).toEqual(['1']);
  });

  it('filters by an exact stage match', () => {
    expect(filterApplications(rows, { ...emptyFilters(), stage: 'Application' }).map((r) => r.id)).toEqual(['2']);
  });

  it('filters by business type', () => {
    expect(filterApplications(rows, { ...emptyFilters(), biz: 'LLC' }).map((r) => r.id)).toEqual(['1']);
  });

  it('filters by agent, including the "not assigned" sentinel', () => {
    expect(filterApplications(rows, { ...emptyFilters(), agent: 'not assigned' }).map((r) => r.id)).toEqual(['2']);
  });

  it('WEX status filter is multi-select — any selected status matches', () => {
    const f = { ...emptyFilters(), wex: new Set(['Decisioned', 'Pending Decision']) };
    expect(filterApplications(rows, f).map((r) => r.id).sort()).toEqual(['1', '2']);
    expect(filterApplications(rows, { ...emptyFilters(), wex: new Set(['Decisioned']) }).map((r) => r.id)).toEqual(['1']);
  });

  it('date range is inclusive on both ends', () => {
    const f = { ...emptyFilters(), dateFrom: '2026-08-01', dateTo: '2026-08-01' };
    expect(filterApplications(rows, f).map((r) => r.id)).toEqual(['1']);
  });

  it('excludes rows with no date on file once a date filter is active', () => {
    const withBlank = [...rows, mkApp({ id: '3', dateFilledRaw: '' })];
    const f = { ...emptyFilters(), dateFrom: '2026-01-01' };
    expect(filterApplications(withBlank, f).map((r) => r.id)).not.toContain('3');
  });

  it('combines multiple active filters with AND', () => {
    const f = { ...emptyFilters(), biz: 'LLC', stage: 'Application' };
    expect(filterApplications(rows, f)).toHaveLength(0);
  });

  it('returns every row when no filter is active', () => {
    expect(filterApplications(rows, emptyFilters())).toHaveLength(2);
  });
});

describe('distinctValues', () => {
  it('dedupes, drops empties, and sorts', () => {
    const rows = [mkApp({ stage: 'B' }), mkApp({ stage: 'A' }), mkApp({ stage: 'A' }), mkApp({ stage: '' })];
    expect(distinctValues(rows, (a) => a.stage)).toEqual(['A', 'B']);
  });
});

describe('activeFilterCount', () => {
  it('is zero for the empty filter set', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
  });

  it('counts a from/to date pair as ONE filter, not two', () => {
    expect(activeFilterCount({ ...emptyFilters(), dateFrom: '2026-01-01', dateTo: '2026-02-01' })).toBe(1);
  });

  it('counts company + stage + a WEX selection as three', () => {
    const f = { ...emptyFilters(), company: 'acme', stage: 'Application', wex: new Set(['Decisioned']) };
    expect(activeFilterCount(f)).toBe(3);
  });
});
