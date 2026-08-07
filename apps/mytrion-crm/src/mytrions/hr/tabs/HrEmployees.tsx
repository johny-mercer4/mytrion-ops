import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import { deleteHrEmployee, type HrEmployeeDto } from '../../../api/hr';
import { formatCachedAt } from '../../_shared/swrCache';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrEmployeeCard } from '../HrEmployeeCard';
import { HrEmployeeList } from '../HrEmployeeList';
import { HrSelect, type HrSelectOption } from '../HrSelect';
import { HrViewToggle, useHrViewMode } from '../HrViewToggle';
import { HrEmployeeDetail } from '../HrEmployeeDetail';
import { HrEmployeeForm, type EmployeeFormMode } from '../HrEmployeeForm';
import {
  DIRECTORY_WINDOW,
  invalidateHrEmployees,
  isActiveStatus,
  sortDirectory,
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
  /**
   * The rows a delete is in flight for — dims those cards instead of yanking them out of the grid.
   *
   * A set, not one id: with a single id the handler had to bail out on a Delete click for any OTHER row,
   * and since `busy` is per row every other card's button stayed enabled and simply ate the click — no
   * confirm, no spinner, no message. Deletes address distinct rows, so they can just run alongside.
   */
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  /** A failed DELETE. Kept apart from the loader's error so neither can be read as the other. */
  const [deleteError, setDeleteError] = useState('');
  const [view, setView] = useHrViewMode('employees');

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
  const visible = useMemo(() => sortDirectory(filteredEmployees), [filteredEmployees]);

  const deptOptions = departments.data?.items ?? [];
  const designationOptions = designations.data ?? [];
  /**
   * Filter options, with "all" as a real entry rather than a magic empty string handled elsewhere — the
   * dropdown then has one uniform list and no special case for "nothing selected".
   */
  const departmentFilterOptions = useMemo<HrSelectOption[]>(
    () => [
      { value: '', label: 'All departments' },
      ...deptOptions.map((d) => ({ value: d.id, label: d.name })),
    ],
    [deptOptions],
  );
  const designationFilterOptions = useMemo<HrSelectOption[]>(
    () => [
      { value: '', label: 'All designations' },
      ...designationOptions.map((d) => ({ value: d, label: d })),
    ],
    [designationOptions],
  );
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
    // A refresh retires the previous delete's failure with it — leaving it up would caption the rows that
    // are about to arrive.
    setDeleteError('');
    directory.reload();
    departments.reload();
    designations.reload();
  }, [directory, departments, designations]);

  /**
   * Retry after a failed load. `reloadAll` owns the directory and the two picklists; in server-search
   * mode the request that actually failed is the search, which it does not.
   */
  const retryLoad = useCallback((): void => {
    reloadAll();
    if (serverMode) serverSearch.reload();
  }, [reloadAll, serverMode, serverSearch]);

  const onSaved = useCallback((): void => {
    setFormMode(null);
    setDeleteError('');
    invalidateHrEmployees();
  }, []);

  const onDelete = async (employee: HrEmployeeDto): Promise<void> => {
    if (!admin || deletingIds.has(employee.id)) return;
    if (!window.confirm(`Delete ${displayName(employee)} from the HR directory?`)) return;
    setDeleteError('');
    setDeletingIds((prev) => new Set(prev).add(employee.id));
    try {
      await deleteHrEmployee(employee.id);
      invalidateHrEmployees();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(employee.id);
        return next;
      });
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
  const loadError = source.error ?? directory.error;
  /**
   * The load FAILED and left nothing on screen — `loading` is already false, `data` is still null.
   *
   * Without its own branch the tab fell through to `filtered === 0` and told an admin the directory was
   * empty ("Add an employee manually, or run the Zoho People sync.") over a 403 or an unreachable
   * Postgres, with 0/0/0 tiles above it. An empty directory and an unanswered request are not the same
   * claim, and only one of them is safe to act on.
   */
  const loadFailed = !source.data && Boolean(loadError);

  const cachedCaption = useMemo(() => formatCachedAt(source.cachedAt), [source.cachedAt]);

  return (
    /* A seven-column table is not prose: it opts out of the reading measure so the row actions are
       not squeezed against the panel edge while the page sits in a pool of empty space. */
    <div className={`hr-page${view === 'list' ? ' hr-page-wide' : ''}`}>
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

      {/* Counted from the directory, so they need the directory — three tiles reading 0 over a failed
          load are a measurement, not a blank. */}
      {!firstLoad && directory.data ? (
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
          <HrSelect
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={departmentFilterOptions}
          />
          <HrSelect
            label="Designation"
            value={designation}
            onChange={setDesignation}
            options={designationFilterOptions}
          />
          <HrViewToggle mode={view} onChange={setView} label="Directory view" />
        </div>
      ) : null}

      {/* Two failures, two banners. A load error only captions rows that are STILL on screen (a failed
          revalidation); with nothing loaded the panel below owns the message instead of repeating it. */}
      {loadError && !loadFailed ? (
        <p className="hr-banner-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {/* A delete failure is the user's own action, so it is dismissible: sharing one banner with the load
          error left a stale "HTTP 500" pinned over a healthy grid for the rest of the session, reading as
          if the list on screen had failed to load. */}
      {deleteError ? (
        <div
          className="hr-banner-error"
          role="alert"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span style={{ flex: 1 }}>{deleteError}</span>
          <button
            type="button"
            className="hr-icon-btn"
            aria-label="Dismiss delete error"
            onClick={() => setDeleteError('')}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      {firstLoad || searching ? (
        <HrPageLoader label={searching ? 'Searching employees…' : 'Loading employees…'} />
      ) : loadFailed ? (
        <div className="hr-empty">
          <TriangleAlert size={26} />
          <div className="hr-empty-title">Directory unavailable</div>
          <p className="hr-empty-body">{loadError}</p>
          {/* Text only: `.hr-empty svg` mutes and half-fades every icon inside this panel, which is right
              for the state glyph and wrong for a live control. */}
          <button type="button" className="hr-btn" onClick={retryLoad}>
            Retry
          </button>
        </div>
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
      ) : view === 'list' ? (
        <HrEmployeeList
          employees={visible}
          admin={admin}
          isBusy={(id) => deletingIds.has(id)}
          departmentColor={(departmentId) =>
            departmentId ? (deptColorById.get(departmentId) ?? null) : null
          }
          onOpen={setDetail}
          onEdit={(emp) => setFormMode({ kind: 'edit', employee: emp })}
          onDelete={(emp) => void onDelete(emp)}
        />
      ) : (
        <div className="hr-empc-grid">
          {visible.map((e) => (
            <HrEmployeeCard
              key={e.id}
              employee={e}
              admin={admin}
              busy={deletingIds.has(e.id)}
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
          /* The modal owns the live avatar; this is so the CARD behind it stops showing the old one. */
          onPhotoChanged={invalidateHrEmployees}
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
