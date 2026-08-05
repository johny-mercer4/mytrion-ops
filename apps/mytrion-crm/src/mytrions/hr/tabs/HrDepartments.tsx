import { useCallback, useMemo, useState } from 'react';
import { Building2, Plus, RefreshCw, Search, UserRoundCheck, Users } from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import { deleteHrDepartment, type HrDepartmentDto } from '../../../api/hr';
import { useUserContext } from '../../../context/UserContextProvider';
import { formatCachedAt } from '../../_shared/swrCache';
import { HrDepartmentCard } from '../HrDepartmentCard';
import { HrDepartmentModal, type DepartmentModalMode } from '../HrDepartmentModal';
import {
  invalidateHrDepartments,
  invalidateHrEmployees,
  isActiveStatus,
  useHrDepartments,
  useHrDirectory,
} from '../hrData';
import {
  HrEmpty,
  HrPageLoader,
  HrPageHead,
  HrSummaryTiles,
} from '../HrBits';

/**
 * HR → Departments. Own `hr_departments` table (migrated from Zoho People).
 *
 * Cards, not a table: see `HrDepartmentCard`. The card click opens the modal, which for an admin is the
 * editor — including the icon, its colour, and the rich-text description. `mail_alias` and `source` are
 * no longer surfaced anywhere in this tab.
 *
 * Headcount comes from the already-cached directory rather than a second endpoint, so the number a card
 * shows is the same number the Employees tab shows.
 */
export function HrDepartments() {
  const user = useUserContext();
  const admin = isAdmin(user);

  const [q, setQ] = useState('');
  const [modal, setModal] = useState<DepartmentModalMode | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  /**
   * Which department `error` is ABOUT — the delete failure is now rendered inside the modal, and a modal
   * is one department's editor. Unscoped, "Department has sub-departments" from A's failed delete greeted
   * whoever opened B (or Add department) next, announced by role="alert" as if something had been tried
   * there. `null` = the message belongs to no open editor.
   */
  const [errorDepartmentId, setErrorDepartmentId] = useState<string | null>(null);

  /** Any editor opens clean: a leftover message belongs to the delete that produced it, not to this one. */
  const openModal = useCallback((next: DepartmentModalMode): void => {
    setError('');
    setErrorDepartmentId(null);
    setModal(next);
  }, []);

  const closeModal = useCallback((): void => {
    setError('');
    setErrorDepartmentId(null);
    setModal(null);
  }, []);

  const departments = useHrDepartments();
  const directory = useHrDirectory();

  /**
   * id → headcount, from the cached directory.
   *
   * `null` while the directory has not loaded (or failed), which is NOT the same as zero: a card that
   * renders "No one assigned" before the fetch lands is stating something false about the department, and
   * the delete confirmation would drop its "N people are still assigned" warning at exactly the moment it
   * matters most.
   */
  const headcounts = useMemo(() => {
    if (!directory.data) return null;
    const map = new Map<string, { total: number; active: number }>();
    for (const e of directory.data.items) {
      if (!e.departmentId) continue;
      const cur = map.get(e.departmentId) ?? { total: 0, active: 0 };
      cur.total += 1;
      if (isActiveStatus(e.status)) cur.active += 1;
      map.set(e.departmentId, cur);
    }
    return map;
  }, [directory.data]);

  /** undefined = not known yet; a zero-filled entry = genuinely nobody. */
  const headcountFor = (id: string): { total: number; active: number } | undefined =>
    headcounts ? (headcounts.get(id) ?? { total: 0, active: 0 }) : undefined;

  const items = departments.data?.items ?? [];
  const term = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!term) return items;
    return items.filter((d) =>
      [d.name, d.code, d.leadName, d.parentName, d.description].some((v) =>
        (v ?? '').toLowerCase().includes(term),
      ),
    );
  }, [items, term]);

  const reloadAll = useCallback((): void => {
    departments.reload();
    directory.reload();
  }, [departments, directory]);

  const onDelete = async (department: HrDepartmentDto): Promise<void> => {
    if (!admin || deletingId) return;
    const staff = headcountFor(department.id);
    const warning = !staff
      ? // Headcount unknown: warn rather than imply the department is empty.
        `Delete department “${department.name}”?\n\nIts headcount has not loaded yet, so anyone still assigned to it will be left without a department.`
      : staff.total
        ? `“${department.name}” still has ${staff.total} ${staff.total === 1 ? 'person' : 'people'} assigned. They will be left without a department. Delete anyway?`
        : `Delete department “${department.name}”?`;
    if (!window.confirm(warning)) return;
    setError('');
    setErrorDepartmentId(null);
    setDeletingId(department.id);
    try {
      await deleteHrDepartment(department.id);
      closeModal();
      invalidateHrDepartments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorDepartmentId(department.id);
    } finally {
      setDeletingId(null);
    }
  };

  const firstLoad = departments.loading && !departments.data;
  const cachedCaption = formatCachedAt(departments.cachedAt);
  /**
   * `null` while the directory is unknown — same rule as `headcounts`: a tile reading "0 staffed" above a
   * grid of real departments is a measurement the page has not taken, and on a directory error it would
   * stay wrong forever. Zero is only ever printed when it was actually counted.
   */
  const staffed = headcounts
    ? items.filter((department) => (headcounts.get(department.id)?.total ?? 0) > 0).length
    : null;
  const assignedPeople = headcounts
    ? [...headcounts.values()].reduce((sum, count) => sum + count.total, 0)
    : null;
  /**
   * A failed delete is announced by the still-open modal, which is where the click happened; repeating it
   * here would fire a second identical role="alert" behind the backdrop. A list-load failure is the page's
   * own and always belongs here.
   */
  const bannerError = (modal ? '' : error) || departments.error;

  return (
    <div className="hr-page">
      <HrPageHead
        tab="departments"
        actions={
          firstLoad ? null : (
            <>
              {/* One loader: the Refresh icon spins; this stays text. */}
              <span className="hr-cached">
                {departments.revalidating
                  ? 'Refreshing…'
                  : cachedCaption
                    ? `Updated ${cachedCaption}`
                    : ''}
              </span>
              <button
                type="button"
                className="hr-btn"
                disabled={departments.revalidating}
                onClick={reloadAll}
              >
                <RefreshCw size={14} className={departments.revalidating ? 'hr-spin' : undefined} />
                Refresh
              </button>
              {admin ? (
                <button
                  type="button"
                  className="hr-btn hr-btn-primary"
                  onClick={() => openModal({ kind: 'create' })}
                >
                  <Plus size={14} />
                  Add department
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
              placeholder="Search name, code, lead, description…"
              aria-label="Search departments"
            />
          </label>
        </div>
      ) : null}

      {!firstLoad ? (
        <HrSummaryTiles
          label="Department summary"
          items={[
            {
              label: term ? 'Matching departments' : 'Departments',
              value: term ? `${visible.length} / ${items.length}` : items.length,
              detail: term ? 'Visible with current search' : 'Configured organizational units',
              icon: <Building2 size={19} />,
              tone: 'var(--tone-violet)',
            },
            {
              label: 'Staffed departments',
              value: staffed ?? '—',
              detail:
                staffed === null ? 'Waiting for the directory' : 'Have at least one assigned person',
              icon: <UserRoundCheck size={19} />,
              tone: 'var(--success)',
            },
            {
              label: 'Assigned people',
              value: assignedPeople ?? '—',
              detail:
                assignedPeople === null
                  ? 'Waiting for the directory'
                  : 'Linked across all departments',
              icon: <Users size={19} />,
              tone: 'var(--tone-blue)',
            },
          ]}
        />
      ) : null}

      {bannerError ? (
        <p className="hr-banner-error" role="alert">
          {bannerError}
        </p>
      ) : null}

      {firstLoad ? (
        <HrPageLoader label="Loading departments…" />
      ) : visible.length === 0 ? (
        <HrEmpty
          icon={<Building2 size={26} />}
          title={term ? 'No matches' : 'No departments yet'}
          body={
            term
              ? 'No department matches that search.'
              : admin
                ? 'Add a department, or run the Zoho People migrate sync.'
                : 'No department records in the directory yet.'
          }
        />
      ) : (
        <div className="hr-deptc-grid">
          {visible.map((d) => (
            <HrDepartmentCard
              key={d.id}
              department={d}
              headcount={headcountFor(d.id)}
              busy={deletingId === d.id}
              onOpen={(dep) => openModal({ kind: 'edit', department: dep })}
            />
          ))}
        </div>
      )}

      {modal ? (
        <HrDepartmentModal
          mode={modal}
          admin={admin}
          departments={items}
          employees={directory.data?.items ?? []}
          headcount={modal.kind === 'edit' ? headcountFor(modal.department.id) : undefined}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            invalidateHrDepartments();
          }}
          onDirectoryChanged={() => {
            // invalidateHrEmployees already wakes this tab's directory loader (and refreshes the
            // designations picklist + the org graph, which a `directory.reload()` would leave stale),
            // so calling reload() as well only put a second identical 500-row fetch in flight.
            invalidateHrEmployees();
          }}
          onDelete={(dep) => void onDelete(dep)}
          deleting={deletingId !== null}
          deleteError={
            modal.kind === 'edit' && errorDepartmentId === modal.department.id ? error : ''
          }
        />
      ) : null}
    </div>
  );
}
