import { useCallback, useMemo, useState } from 'react';
import { Building2, Plus, RefreshCw, Search } from 'lucide-react';
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
  HrCardGridSkeleton,
  HrEmpty,
  HrHeadActionsSkeleton,
  HrPageHead,
  HrToolbarSkeleton,
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
    setDeletingId(department.id);
    try {
      await deleteHrDepartment(department.id);
      setModal(null);
      invalidateHrDepartments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  const firstLoad = departments.loading && !departments.data;
  const cachedCaption = formatCachedAt(departments.cachedAt);

  return (
    <div className="hr-page">
      <HrPageHead
        tab="departments"
        actions={
          firstLoad ? (
            <HrHeadActionsSkeleton buttons={admin ? 2 : 1} />
          ) : (
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
                  onClick={() => setModal({ kind: 'create' })}
                >
                  <Plus size={14} />
                  Add department
                </button>
              ) : null}
            </>
          )
        }
      />

      {firstLoad ? (
        <HrToolbarSkeleton slots={0} />
      ) : (
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
          <div className="hr-summary">
            <strong>{visible.length}</strong>
            {term ? <> of {items.length}</> : null}{' '}
            {items.length === 1 ? 'department' : 'departments'}
          </div>
        </div>
      )}

      {error || departments.error ? (
        <p className="hr-banner-error" role="alert">
          {error || departments.error}
        </p>
      ) : null}

      {firstLoad ? (
        <HrCardGridSkeleton count={6} label="Loading departments" gridClass="hr-deptc-grid" />
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
              onOpen={(dep) => setModal({ kind: 'edit', department: dep })}
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
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            invalidateHrDepartments();
          }}
          onDirectoryChanged={() => {
            invalidateHrEmployees();
            directory.reload();
          }}
          onDelete={(dep) => void onDelete(dep)}
        />
      ) : null}
    </div>
  );
}
