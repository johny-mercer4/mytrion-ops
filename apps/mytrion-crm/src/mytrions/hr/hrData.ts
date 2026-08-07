/**
 * HR's data layer: cached reads + one place that knows what an edit invalidates.
 *
 * WHY THE DIRECTORY IS FETCHED WHOLE. The tab used to issue a request per keystroke and per filter
 * change — every one of them a 500-row query whose rows still carried the full Zoho `raw_fields` bag.
 * The directory is a few hundred people, so it is fetched ONCE into the shared SWR store and the
 * search, the status chips and the two dropdowns all filter that array in memory: typing costs nothing,
 * switching filters is instant, and re-entering the tab paints from cache while it revalidates.
 *
 * `DIRECTORY_WINDOW` is the backend's per-request maximum. If the directory ever outgrows it, the
 * component falls back to asking the server (see `useHrEmployeeSearch`) rather than quietly searching
 * only the rows it happens to hold.
 *
 * Cache keys are namespaced `hr:*`, so `invalidateHr*` can never disturb another module's entries —
 * the store is shared with Sales and Manager (`_shared/swrCache.ts`).
 */
import { useMemo } from 'react';
import {
  getHrOrgStructure,
  listHrDepartments,
  listHrDesignations,
  listHrEmployees,
  type HrDepartmentDto,
  type HrEmployeeDto,
  type HrOrgStructureDto,
} from '../../api/hr';
import { invalidateSwrCache, useCachedLoad, type CachedLoad } from '../_shared/swrCache';

/** The backend caps a page at 500 rows; asking for more is a validation error, not more data. */
export const DIRECTORY_WINDOW = 500;

const KEY_EMPLOYEES = 'hr:employees:all';
const KEY_DEPARTMENTS = 'hr:departments:all';
const KEY_DESIGNATIONS = 'hr:designations';
const KEY_ORG = 'hr:org';

/** People change during the day; a minute of staleness with a background revalidate is right. */
const STALE_DIRECTORY = 60_000;
/** Departments and the designation picklist change a few times a year. */
const STALE_META = 5 * 60_000;

export interface HrDirectory {
  items: HrEmployeeDto[];
  /** Total rows in the tenant — larger than `items.length` only if the directory outgrew the window. */
  total: number;
}

/**
 * The whole employee directory, cached. Every filter in the UI is applied to this one array.
 *
 * Terminated people are included: the tab has a Terminated chip, and fetching per-status would mean a
 * round trip every time someone flips it.
 */
export function useHrDirectory(): CachedLoad<HrDirectory> {
  return useCachedLoad<HrDirectory>(
    KEY_EMPLOYEES,
    async () => {
      const res = await listHrEmployees({ limit: DIRECTORY_WINDOW });
      return { items: res.items, total: res.total };
    },
    { staleMs: STALE_DIRECTORY },
  );
}

/**
 * Server-side search — the escape hatch for a directory larger than one window.
 *
 * `enabled` is false in the normal case, so this hook costs nothing at all; it only starts fetching if
 * the caller has established that local filtering would be incomplete.
 */
export function useHrEmployeeSearch(q: string, enabled: boolean): CachedLoad<HrDirectory> {
  const term = q.trim();
  return useCachedLoad<HrDirectory>(
    `hr:employees:q:${term.toLowerCase()}`,
    async () => {
      const res = await listHrEmployees({
        ...(term ? { q: term } : {}),
        limit: DIRECTORY_WINDOW,
      });
      return { items: res.items, total: res.total };
    },
    { enabled, staleMs: STALE_DIRECTORY },
  );
}

export function useHrDepartments(): CachedLoad<{ items: HrDepartmentDto[]; total: number }> {
  return useCachedLoad(
    KEY_DEPARTMENTS,
    async () => {
      const res = await listHrDepartments({ limit: DIRECTORY_WINDOW });
      return { items: res.items, total: res.total };
    },
    { staleMs: STALE_META },
  );
}

export function useHrDesignations(): CachedLoad<string[]> {
  return useCachedLoad(KEY_DESIGNATIONS, () => listHrDesignations(), { staleMs: STALE_META });
}

export function useHrOrgStructure(): CachedLoad<HrOrgStructureDto> {
  return useCachedLoad(KEY_ORG, () => getHrOrgStructure(), { staleMs: STALE_DIRECTORY });
}

/**
 * What an employee edit invalidates.
 *
 * The org graph is included because an employee edit can move someone between departments, which
 * changes the canvas headcounts and edges. Leaving it out is how a stale org chart happens.
 */
export function invalidateHrEmployees(): void {
  invalidateSwrCache('hr:employees');
  invalidateSwrCache(KEY_DESIGNATIONS); // a new job title becomes a picklist entry
  invalidateSwrCache(KEY_ORG);
}

/** What a department edit invalidates — including the directory, which shows department names. */
export function invalidateHrDepartments(): void {
  invalidateSwrCache(KEY_DEPARTMENTS);
  invalidateSwrCache('hr:employees');
  invalidateSwrCache(KEY_ORG);
}

/**
 * Is this row an active employee?
 *
 * One predicate for the whole module. `status` is free text mirrored from Zoho's Employeestatus, so the
 * casing is not guaranteed — the backend's own ordering uses `lower(status) = 'active'`. Three call sites
 * had each rolled their own comparison (one exact, two lower-cased), which meant a row stored as
 * "active" counted toward a department's headcount but was excluded by the Active chip.
 */
export function isActiveStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'active';
}

export function isTerminatedStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'terminated';
}

/**
 * The directory's default order: Active first → department → name.
 *
 * Status leads the sort, not department. Ordering by department first scattered the terminated through
 * the whole directory — a leaver between two colleagues inside every department block — so the people
 * who still work here were never a contiguous run you could scan. Everyone who has left now lands after
 * everyone who has not, still grouped by department within each half.
 *
 * Pure and exported so the ordering can be asserted without mounting the tab: it is the kind of rule
 * that gets quietly inverted by a later edit and looks fine on a screenshot.
 */
export function sortDirectory(rows: readonly HrEmployeeDto[]): HrEmployeeDto[] {
  const name = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();
  const activeRank = (e: HrEmployeeDto): number => (isActiveStatus(e.status) ? 0 : 1);
  return [...rows].sort((a, b) => {
    // Unassigned sorts last within its half: '\uffff' is above every real department name.
    const aDepartment = a.department?.trim() || '\uffff';
    const bDepartment = b.department?.trim() || '\uffff';
    return (
      activeRank(a) - activeRank(b) ||
      aDepartment.localeCompare(bDepartment) ||
      name(a).localeCompare(name(b))
    );
  });
}

export interface HrEmployeeFilters {
  q: string;
  status: 'all' | 'Active' | 'Terminated';
  departmentId: string;
  designation: string;
}

/**
 * Apply the tab's filters in memory.
 *
 * Search matches the same columns the backend's ILIKE does (name, email, employee id) plus the
 * Telegram handle, so what a user can see on a card is also what they can search for.
 */
export function filterEmployees(
  items: readonly HrEmployeeDto[],
  filters: HrEmployeeFilters,
): HrEmployeeDto[] {
  const term = filters.q.trim().toLowerCase();
  return items.filter((e) => {
    if (filters.status === 'Active' && !isActiveStatus(e.status)) return false;
    if (filters.status === 'Terminated' && !isTerminatedStatus(e.status)) return false;
    if (filters.departmentId && e.departmentId !== filters.departmentId) return false;
    if (filters.designation && e.designation !== filters.designation) return false;
    if (!term) return true;
    const haystack = [
      e.firstName,
      e.lastName,
      `${e.firstName} ${e.lastName}`,
      e.email,
      e.employeeId,
      e.telegramUsername,
    ];
    return haystack.some((v) => (v ?? '').toLowerCase().includes(term));
  });
}

/** Memoized `filterEmployees` — the directory is re-filtered on every keystroke. */
export function useFilteredEmployees(
  items: readonly HrEmployeeDto[] | undefined,
  filters: HrEmployeeFilters,
): HrEmployeeDto[] {
  const { q, status, departmentId, designation } = filters;
  return useMemo(
    () => (items ? filterEmployees(items, { q, status, departmentId, designation }) : []),
    [items, q, status, departmentId, designation],
  );
}
