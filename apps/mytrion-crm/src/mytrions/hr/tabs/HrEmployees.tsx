import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, UserCheck, UserMinus, Users } from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import { deleteHrEmployee, type HrEmployeeDto } from '../../../api/hr';
import { formatCachedAt } from '../../_shared/swrCache';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrEmployeeCard } from '../HrEmployeeCard';
import { HrEmployeeDetail } from '../HrEmployeeDetail';
import { HrEmployeeForm, type EmployeeFormMode } from '../HrEmployeeForm';
import {
  DIRECTORY_WINDOW,
  invalidateHrEmployees,
  isActiveStatus,
  useFilteredEmployees,
  useHrDepartments,
  useHrDesignations,
  useHrDirectory,
  useHrEmployeeSearch,
  type HrEmployeeFilters,
} from '../hrData';
import {
  HrEmpty,
  HrPageLoader,
  HrPageHead,
  HrSummaryTiles,
} from '../HrBits';

const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

/**
 * HR → Employees. Reads Mytrion's own `hr_employees` table (not live Zoho People).
 * Create / edit / delete: Mytrion Admin only.
 *
 * LOADING. The directory is fetched once into the shared SWR store (see `hrData.ts`) and every filter
 * runs in memory, so typing and switching filters cost no network at all and re-entering the tab paints
 * from cache. Two consequences shape the UI below:
 *
 *  - There is no debounce, because there is nothing to debounce.
 *  - `loading` is only true with an EMPTY cache. A revalidation shows the caption next to Refresh, never
 *    a skeleton over data that is already correct — which is also why the toolbar and the cards share
 *    one skeleton pass instead of the header rendering fake controls above shimmering cards.
 */
export function HrEmployees() {
  const user = useUserContext();
  const admin = isAdmin(user);

  const [q, setQ] = useState('');
  /**
   * A debounced copy of `q`, used ONLY by the server-search fallback.
   *
   * The in-memory path needs no debounce (it does no I/O), but the fallback keys its cache by the term —
   * so without this every keystroke minted a new key and fired a request.
   */
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);
  const [status, setStatus] = useState<HrEmployeeFilters['status']>('all');
  const [departmentId, setDepartmentId] = useState('');
  const [designation, setDesignation] = useState('');
  /** The employee whose detail modal is open — a card click, not an admin edit. */
  const [detail, setDetail] = useState<HrEmployeeDto | null>(null);
  const [formMode, setFormMode] = useState<EmployeeFormMode | null>(null);
  /** The row a delete is in flight for — dims that one card instead of yanking it out of the grid. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const directory = useHrDirectory();
  const departments = useHrDepartments();
  const designations = useHrDesignations();

  /**
   * The directory outgrew one page, so an in-memory search would only cover the rows we hold. Falling
   * back to the server keeps search honest; at today's ~213 employees this never engages.
   */
  const needsServerSearch =
    directory.data != null && directory.data.total > directory.data.items.length;
  const serverMode = needsServerSearch && debouncedQ.length > 0;
  const serverSearch = useHrEmployeeSearch(debouncedQ, serverMode);

  const source = serverMode ? serverSearch : directory;
  const filters: HrEmployeeFilters = { q, status, departmentId, designation };
  const filteredEmployees = useFilteredEmployees(
    source.data?.items,
    // A server search already applied the term; re-applying it locally would drop rows the server
    // matched on a column the local predicate does not check.
    serverMode ? { ...filters, q: '' } : filters,
  );
  const visible = useMemo(() => {
    const rows = [...filteredEmployees];
    const byName = (a: HrEmployeeDto, b: HrEmployeeDto): number =>
      displayName(a).localeCompare(displayName(b));
    const activeRank = (employee: HrEmployeeDto): number =>
      isActiveStatus(employee.status) ? 0 : 1;
    // Default directory order: department → Active first → name.
    rows.sort((a, b) => {
      const aDepartment = a.department?.trim() || '\uffff';
      const bDepartment = b.department?.trim() || '\uffff';
      return aDepartment.localeCompare(bDepartment) || activeRank(a) - activeRank(b) || byName(a, b);
    });
    return rows;
  }, [filteredEmployees]);

  const deptOptions = departments.data?.items ?? [];
  const designationOptions = designations.data ?? [];
  /** id → iconColor token — cards colour their department chip from this, not a fixed accent. */
  const deptColorById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const d of deptOptions) map.set(d.id, d.iconColor);
    return map;
  }, [deptOptions]);
  const total = directory.data?.total ?? 0;
  const filtered = visible.length;
  const isFiltered = Boolean(q.trim() || status !== 'all' || departmentId || designation);
  const directoryItems = directory.data?.items ?? [];
  const active = directoryItems.filter((employee) => isActiveStatus(employee.status)).length;
  const unassigned = directoryItems.filter((employee) => !employee.departmentId).length;

  /** One reload for the tab: the directory plus the two picklists that sit beside it. */
  const reloadAll = useCallback((): void => {
    directory.reload();
    departments.reload();
    designations.reload();
  }, [directory, departments, designations]);

  const onSaved = useCallback((): void => {
    setFormMode(null);
    invalidateHrEmployees();
  }, []);

  const onDelete = async (employee: HrEmployeeDto): Promise<void> => {
    if (!admin || deletingId) return;
    if (!window.confirm(`Delete ${displayName(employee)} from the HR directory?`)) return;
    setError('');
    setDeletingId(employee.id);
    try {
      await deleteHrEmployee(employee.id);
      invalidateHrEmployees();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * First paint with nothing cached: head + toolbar + grid render as skeletons together.
   *
   * Keyed on the DIRECTORY, never on the active source. Keying it on `source` meant that in server-search
   * mode each new term produced a cold key, `firstLoad` flipped true, and the whole toolbar — including
   * the focused search input — was replaced by a skeleton mid-typing. The results area shows the
   * in-flight state for a search; the chrome around it must stay mounted.
   */
  const firstLoad = directory.loading && !directory.data;
  /** A search whose results have not arrived yet: the grid waits, the toolbar does not. */
  const searching = serverMode && source.loading && !source.data;

  const cachedCaption = useMemo(() => formatCachedAt(source.cachedAt), [source.cachedAt]);

  return (
    <div className="hr-page">
      <HrPageHead
        tab="employees"
        actions={
          firstLoad ? null : (
            <>
              {/* ONE loader per surface: the Refresh icon spins, and the caption is text only. An
                  HrBusy ring here put a second spinner right next to the spinning icon. */}
              <span className="hr-cached">
                {source.revalidating ? 'Refreshing…' : cachedCaption ? `Updated ${cachedCaption}` : ''}
              </span>
              <button
                type="button"
                className="hr-btn"
                disabled={source.revalidating}
                onClick={reloadAll}
              >
                <RefreshCw size={14} className={source.revalidating ? 'hr-spin' : undefined} />
                Refresh
              </button>
              {admin ? (
                <button
                  type="button"
                  className="hr-btn hr-btn-primary"
                  onClick={() => setFormMode({ kind: 'create' })}
                >
                  <Plus size={14} />
                  Add employee
                </button>
              ) : null}
            </>
          )
        }
      />

      {!firstLoad ? (
        <div className="hr-toolbar">
          <label className="hr-search">
            <Search size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, employee id…"
              aria-label="Search employees"
            />
          </label>
          <div className="hr-chips" role="group" aria-label="Status filter">
            {(['all', 'Active', 'Terminated'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className="hr-chip"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
          <label className="hr-select">
            <span className="hr-sr">Department</span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {deptOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="hr-select">
            <span className="hr-sr">Designation</span>
            <select value={designation} onChange={(e) => setDesignation(e.target.value)}>
              <option value="">All designations</option>
              {designationOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {!firstLoad ? (
        <HrSummaryTiles
          label="Employee directory summary"
          items={[
            {
              label: isFiltered ? 'Matching people' : 'People directory',
              value: isFiltered ? `${filtered} / ${total}` : total,
              detail: isFiltered ? 'Visible with current filters' : 'All employee records',
              icon: <Users size={19} />,
              tone: 'var(--tone-blue)',
            },
            {
              label: 'Active employees',
              value: active,
              detail: 'Currently active in Mytrion',
              icon: <UserCheck size={19} />,
              tone: 'var(--success)',
            },
            {
              label: 'Needs department',
              value: unassigned,
              detail: 'Employee records not assigned',
              icon: <UserMinus size={19} />,
              tone: unassigned ? 'var(--warning)' : 'var(--success)',
            },
          ]}
        />
      ) : null}

      {error || source.error ? (
        <p className="hr-banner-error" role="alert">
          {error || source.error}
        </p>
      ) : null}

      {firstLoad || searching ? (
        <HrPageLoader label={searching ? 'Searching employees…' : 'Loading employees…'} />
      ) : filtered === 0 ? (
        <HrEmpty
          icon={<Users size={26} />}
          title={isFiltered ? 'No matches' : 'No employees yet'}
          body={
            isFiltered
              ? 'No one in the directory matches those filters.'
              : admin
                ? 'Add an employee manually, or run the Zoho People sync.'
                : 'No employee records in the directory yet.'
          }
        />
      ) : (
        <div className="hr-empc-grid">
          {visible.map((e) => (
            <HrEmployeeCard
              key={e.id}
              employee={e}
              admin={admin}
              busy={deletingId === e.id}
              departmentColor={
                e.departmentId ? (deptColorById.get(e.departmentId) ?? null) : null
              }
              onOpen={setDetail}
              onEdit={(emp) => setFormMode({ kind: 'edit', employee: emp })}
              onDelete={(emp) => void onDelete(emp)}
            />
          ))}
        </div>
      )}

      {detail ? (
        <HrEmployeeDetail
          employee={detail}
          admin={admin}
          departmentColor={
            detail.departmentId ? (deptColorById.get(detail.departmentId) ?? null) : null
          }
          onClose={() => setDetail(null)}
          onEdit={(emp) => {
            setDetail(null);
            setFormMode({ kind: 'edit', employee: emp });
          }}
        />
      ) : null}

      {formMode && admin ? (
        <HrEmployeeForm
          mode={formMode}
          departments={deptOptions}
          designations={designationOptions}
          /* The already-loaded directory, so the manager picker costs no extra request. */
          colleagues={directory.data?.items ?? []}
          onClose={() => setFormMode(null)}
          onSaved={onSaved}
        />
      ) : null}

      {needsServerSearch ? (
        <p className="hr-note">
          The directory holds {total} people, more than the {DIRECTORY_WINDOW}-row page — search is run
          on the server so it covers everyone, while the filters apply to the loaded rows.
        </p>
      ) : null}
    </div>
  );
}
