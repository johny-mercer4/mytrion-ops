/**
 * The sort/filter UI state helpers that remain in applicationsFilters.ts once the actual
 * sort/filter/facet computation moved server-side (2026-08-13) — see
 * tests/unit/cs-applications-list.test.ts (backend repo) for those cases now.
 */
import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  applicationsQueryKey,
  emptyFilters,
  filtersToParams,
} from './applicationsFilters';

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

describe('filtersToParams', () => {
  it('carries every filter field through plus the sort key/dir', () => {
    const f = { ...emptyFilters(), company: 'acme', stage: 'Application' };
    const params = filtersToParams(f, 'appId', 'asc');
    expect(params).toMatchObject({ sortKey: 'appId', sortDir: 'asc', company: 'acme', stage: 'Application' });
  });

  it('sorts the wex Set into an array — insertion order must not change the output', () => {
    const a = filtersToParams({ ...emptyFilters(), wex: new Set(['B', 'A']) }, 'date', 'desc');
    const b = filtersToParams({ ...emptyFilters(), wex: new Set(['A', 'B']) }, 'date', 'desc');
    expect(a.wex).toEqual(['A', 'B']);
    expect(b.wex).toEqual(['A', 'B']);
  });
});

describe('applicationsQueryKey', () => {
  it('is stable for identical params regardless of how the wex Set was built', () => {
    const p1 = filtersToParams({ ...emptyFilters(), wex: new Set(['B', 'A']) }, 'date', 'desc');
    const p2 = filtersToParams({ ...emptyFilters(), wex: new Set(['A', 'B']) }, 'date', 'desc');
    expect(applicationsQueryKey(p1)).toBe(applicationsQueryKey(p2));
  });

  it('differs when any field differs', () => {
    const p1 = filtersToParams(emptyFilters(), 'date', 'desc');
    const p2 = filtersToParams(emptyFilters(), 'date', 'asc');
    expect(applicationsQueryKey(p1)).not.toBe(applicationsQueryKey(p2));
  });
});
