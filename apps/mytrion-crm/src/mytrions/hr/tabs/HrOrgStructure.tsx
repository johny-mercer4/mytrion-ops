import { useCallback, useMemo, useState } from 'react';
import {
  Building2,
  EyeOff,
  Maximize2,
  Minimize2,
  Network,
  RefreshCw,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import type { HrDepartmentDto, HrEmployeeDto } from '../../../api/hr';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrDepartmentModal, type DepartmentModalMode } from '../HrDepartmentModal';
import { HrEmployeeDetail } from '../HrEmployeeDetail';
import { HrEmployeeForm, type EmployeeFormMode } from '../HrEmployeeForm';
import { HrOrgCanvas, type OrgCanvasHandlers } from '../HrOrgCanvas';
import { orgBranchIds } from '../orgGraph';
import {
  invalidateHrDepartments,
  invalidateHrEmployees,
  useHrDepartments,
  useHrDesignations,
  useHrDirectory,
  useHrOrgStructure,
} from '../hrData';
import { HrEmpty, HrPageLoader, HrPageHead, HrSummaryTiles } from '../HrBits';

/**
 * HR → Org Structure. A React Flow canvas, top-to-bottom, built from `hr_departments.parent_id`,
 * `hr_employees.department_id` and `hr_employees.reporting_to_employee_id` — no invented nodes.
 *
 * DEPARTMENTS OPEN, PEOPLE COLLAPSED. All ~20 departments render at once because that is the shape of
 * the company; their staff start collapsed because 213 person-nodes on one canvas is not a chart anyone
 * can read. Every node with children carries a chevron and a count, so nothing is hidden without saying
 * so, and "Expand all" is one click away.
 */
export function HrOrgStructure() {
  const user = useUserContext();
  const admin = isAdmin(user);

  const org = useHrOrgStructure();
  const departments = useHrDepartments();
  const directory = useHrDirectory();
  const designations = useHrDesignations();

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [includeTerminated, setIncludeTerminated] = useState(false);
  /** People the current collapse state is hiding, reported up by the canvas. */
  const [hiddenCount, setHiddenCount] = useState(0);
  const [error, setError] = useState('');

  const [deptModal, setDeptModal] = useState<DepartmentModalMode | null>(null);
  /** The department whose "+" was clicked, while we ask what to add under it. */
  const [addChoice, setAddChoice] = useState<HrDepartmentDto | null>(null);
  const [empForm, setEmpForm] = useState<EmployeeFormMode | null>(null);
  const [empDetail, setEmpDetail] = useState<HrEmployeeDto | null>(null);

  const deptById = useMemo(
    () => new Map((departments.data?.items ?? []).map((d) => [d.id, d])),
    [departments.data],
  );
  const empById = useMemo(
    () => new Map((directory.data?.items ?? []).map((e) => [e.id, e])),
    [directory.data],
  );

  const onToggle = useCallback(
    (id: string): void => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          for (const branchId of orgBranchIds(
            org.data ?? {
              departments: [],
              employees: [],
              departmentCount: 0,
              employeeLinkedCount: 0,
              employeeUnlinkedCount: 0,
            },
            id,
          )) {
            next.delete(branchId);
          }
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [org.data],
  );

  /** Every id that COULD hold children — what "Expand all" opens. */
  const expandableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of org.data?.departments ?? []) ids.add(d.id);
    for (const e of org.data?.employees ?? []) ids.add(e.id);
    return ids;
  }, [org.data]);

  const allExpanded = expanded.size >= expandableIds.size && expandableIds.size > 0;

  const reloadAll = useCallback((): void => {
    org.reload();
    departments.reload();
    directory.reload();
  }, [org, departments, directory]);

  /**
   * Handler identities are stable so the canvas does not re-register its node callbacks (and therefore
   * re-render every node) on each parent render.
   */
  const handlers: OrgCanvasHandlers = useMemo(
    () => ({
      onOpenDepartment: (id) => {
        const dep = deptById.get(id);
        if (dep) setDeptModal({ kind: 'edit', department: dep });
      },
      onOpenEmployee: (id) => {
        const emp = empById.get(id);
        if (emp) setEmpDetail(emp);
      },
      onAddUnderDepartment: (id) => {
        // "+" on a department is ambiguous — a sub-department or a person? Ask with a real choice.
        // A window.confirm would map the two creates onto OK/Cancel, where "Cancel" creating something
        // is exactly backwards from what that button means everywhere else.
        const dep = deptById.get(id);
        if (dep) setAddChoice(dep);
      },
      onHiddenCount: setHiddenCount,
      onAddUnderEmployee: (id) => {
        const mgr = empById.get(id);
        if (!mgr) return;
        setEmpForm({
          kind: 'create',
          presetManagerId: mgr.id,
          ...(mgr.departmentId ? { presetDepartmentId: mgr.departmentId } : {}),
        });
      },
    }),
    [deptById, empById],
  );

  const onGraphChanged = useCallback((): void => {
    setError('');
    /**
     * `invalidateHrDepartments` covers ALL THREE caches (departments + directory + graph), which is what
     * a re-parent actually invalidates.
     *
     * This used to invalidate only the graph and the directory. Dragging a sub-department to a new parent
     * therefore left `hr:departments:all` holding the OLD parentName — and because this tab feeds that
     * cached row straight into the department modal, opening the department you had just moved and
     * pressing Save wrote the stale parent back, silently undoing the move.
     */
    invalidateHrDepartments();
  }, []);

  const firstLoad = org.loading && !org.data;
  const hasGraph = (org.data?.departments.length ?? 0) > 0 || (org.data?.employees.length ?? 0) > 0;

  return (
    <div className="hr-page hr-page-wide">
      <HrPageHead
        tab="org"
        actions={
          firstLoad ? null : (
            <>
              <button
                type="button"
                className="hr-btn"
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(expandableIds))}
              >
                {allExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
              <button
                type="button"
                className="hr-btn"
                disabled={org.revalidating}
                onClick={reloadAll}
              >
                <RefreshCw size={14} className={org.revalidating ? 'hr-spin' : undefined} />
                Refresh
              </button>
            </>
          )
        }
      />

      {!firstLoad ? (
        <div className="hr-toolbar">
          <div className="hr-chips" role="group" aria-label="Canvas options">
            <button
              type="button"
              className="hr-chip"
              aria-pressed={includeTerminated}
              onClick={() => setIncludeTerminated((v) => !v)}
            >
              Show terminated
            </button>
          </div>
          <p className="hr-hint">
            {admin
              ? 'Click a node to open it · drag onto another to re-parent · “+” adds under a node · chevron expands staff'
              : 'Click a node to open details. Changing the structure needs Mytrion Admin.'}
          </p>
        </div>
      ) : null}

      {!firstLoad ? (
        <HrSummaryTiles
          label="Organization structure summary"
          items={[
            {
              label: 'Departments',
              value: org.data?.departmentCount ?? 0,
              detail: 'Organizational units in the chart',
              icon: <Building2 size={19} />,
              tone: 'var(--tone-violet)',
            },
            {
              label: 'Linked employees',
              value: org.data?.employeeLinkedCount ?? 0,
              detail: 'Placed in the reporting structure',
              icon: <Users size={19} />,
              tone: 'var(--success)',
            },
            {
              label: 'Needs assignment',
              value: org.data?.employeeUnlinkedCount ?? 0,
              detail: 'Not connected to the chart',
              icon: <UserMinus size={19} />,
              tone: 'var(--warning)',
            },
            {
              label: 'Collapsed people',
              value: hiddenCount,
              detail: 'Hidden under folded nodes',
              icon: <EyeOff size={19} />,
              tone: 'var(--tone-blue)',
            },
          ]}
        />
      ) : null}

      {error || org.error ? (
        <p className="hr-banner-error" role="alert">
          {error || org.error}
        </p>
      ) : null}

      {firstLoad ? (
        <HrPageLoader label="Building organization chart…" />
      ) : !org.data || !hasGraph ? (
        <HrEmpty
          icon={<Network size={26} />}
          title="No org structure yet"
          body="Departments need parent links and employees need a department. Migrate departments first, then link employees."
        />
      ) : (
        <HrOrgCanvas
          data={org.data}
          admin={admin}
          expanded={expanded}
          includeTerminated={includeTerminated}
          onToggle={onToggle}
          handlers={handlers}
          onGraphChanged={onGraphChanged}
          onError={setError}
        />
      )}

      {addChoice ? (
        <div className="hr-modal-backdrop" role="presentation" onClick={() => setAddChoice(null)}>
          <div
            className="hr-modal hr-addchoice"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-addchoice-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <header className="hr-modal-head">
              <h2 id="hr-addchoice-title">Add under {addChoice.name}</h2>
              <button
                type="button"
                className="hr-icon-btn"
                aria-label="Close"
                onClick={() => setAddChoice(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="hr-addchoice-opts">
              <button
                type="button"
                className="hr-addchoice-opt"
                onClick={() => {
                  setEmpForm({ kind: 'create', presetDepartmentId: addChoice.id });
                  setAddChoice(null);
                }}
              >
                <UserPlus size={18} />
                <span className="hr-addchoice-t">An employee</span>
                <span className="hr-addchoice-d">A new person in this department.</span>
              </button>
              <button
                type="button"
                className="hr-addchoice-opt"
                onClick={() => {
                  setDeptModal({ kind: 'create', parentName: addChoice.name });
                  setAddChoice(null);
                }}
              >
                <Building2 size={18} />
                <span className="hr-addchoice-t">A sub-department</span>
                <span className="hr-addchoice-d">A new org unit beneath this one.</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deptModal ? (
        <HrDepartmentModal
          mode={deptModal}
          admin={admin}
          departments={departments.data?.items ?? ([] as HrDepartmentDto[])}
          employees={directory.data?.items ?? []}
          headcount={
            deptModal.kind === 'edit'
              ? {
                  total:
                    org.data?.departments.find((d) => d.id === deptModal.department.id)
                      ?.employeeCount ?? 0,
                  active:
                    org.data?.departments.find((d) => d.id === deptModal.department.id)
                      ?.activeEmployeeCount ?? 0,
                }
              : undefined
          }
          onClose={() => setDeptModal(null)}
          onSaved={() => {
            setDeptModal(null);
            invalidateHrDepartments();
            org.reload();
          }}
          onDirectoryChanged={() => {
            invalidateHrEmployees();
            directory.reload();
            org.reload();
          }}
        />
      ) : null}

      {empForm && admin ? (
        <HrEmployeeForm
          mode={empForm}
          departments={departments.data?.items ?? []}
          designations={designations.data ?? []}
          colleagues={directory.data?.items ?? []}
          onClose={() => setEmpForm(null)}
          onSaved={() => {
            setEmpForm(null);
            invalidateHrEmployees();
          }}
        />
      ) : null}

      {empDetail ? (
        <HrEmployeeDetail
          employee={empDetail}
          admin={admin}
          departmentColor={
            empDetail.departmentId
              ? (deptById.get(empDetail.departmentId)?.iconColor ?? null)
              : null
          }
          onClose={() => setEmpDetail(null)}
          onEdit={(emp) => {
            setEmpDetail(null);
            setEmpForm({ kind: 'edit', employee: emp });
          }}
        />
      ) : null}
    </div>
  );
}
