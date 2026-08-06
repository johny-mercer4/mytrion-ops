/**
 * Shared department landing — page chrome + a WORKSPACE GRID, the same shape as Manager Overview.
 *
 * A desk used to render its Tasks board inline, so the desk WAS the board and there was nowhere to
 * put a second surface. It is now a hub of workspace cards (Tasks first on every desk, plus KPI on
 * Sales), and opening one replaces the grid — matching how Overview opens Referrals or Loyalty.
 *
 * Every desk gets Tasks, Sales included. Sales used to render a "coming soon" panel here instead,
 * which meant the one department with a fully-built agent-side task board had no manager side to
 * assign from.
 */
import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ManagerDepartment } from './managerNav';
import type { ManagerTaskDepartment } from '../../api/managerTasks';
import { deptWorkspaces, type DeptWorkspaceId } from './deptWorkspaces';
import { TasksBlock } from './tasks/TasksBlock';
import { SalesKpiBlock } from './kpi/SalesKpiBlock';

export function DepartmentDesk({ dept }: { dept: ManagerDepartment }) {
  const Icon = dept.icon;
  const workspaces = deptWorkspaces(dept.id);
  const [open, setOpen] = useState<DeptWorkspaceId | null>(null);
  const active = workspaces.find((w) => w.id === open) ?? null;

  return (
    <div className="mg-page" style={{ ['--mg-tone' as string]: dept.tone }}>
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          {active ? (
            <button
              type="button"
              className="mg-backbtn"
              onClick={() => setOpen(null)}
              aria-label={`Back to ${dept.navLabel} workspaces`}
            >
              <ArrowLeft size={16} />
            </button>
          ) : (
            <span className="mg-page-glyph" aria-hidden="true">
              <Icon size={22} strokeWidth={1.9} />
            </span>
          )}
          <div>
            <div className="mg-kicker">
              Manager · {dept.navLabel}
              {active ? ` · ${active.label}` : ''}
            </div>
            <h1 className="mg-page-title">{active ? active.label : dept.label}</h1>
            <p className="mg-page-sub">{active ? active.description : dept.description}</p>
          </div>
        </div>
      </header>

      {active === null ? (
        <section className="mg-section">
          <div className="mg-section-head">
            <h2 className="mg-section-title">Workspaces</h2>
            <span className="mg-section-line" aria-hidden="true" />
            <span className="mg-section-count">{workspaces.length} live</span>
          </div>
          <div className="mg-card-grid">
            {workspaces.map((workspace) => {
              const WorkspaceIcon = workspace.icon;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className="mg-card"
                  style={{ ['--mg-tone' as string]: workspace.tone }}
                  onClick={() => setOpen(workspace.id)}
                  data-od-id={`manager-${dept.id}-${workspace.id}`}
                >
                  <span className="mg-card-shimmer" aria-hidden="true" />
                  <span className="mg-card-top">
                    <span className="mg-card-glyph">
                      <WorkspaceIcon size={22} strokeWidth={1.9} />
                    </span>
                    <ArrowRight className="mg-card-arrow" size={15} strokeWidth={2.2} aria-hidden />
                  </span>
                  <span className="mg-card-title">{workspace.label}</span>
                  <span className="mg-card-desc">{workspace.description}</span>
                  <span className="mg-card-tag">{workspace.tag}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {active?.id === 'tasks' ? (
        <TasksBlock
          department={dept.id as ManagerTaskDepartment}
          departmentLabel={dept.navLabel}
        />
      ) : null}

      {active?.id === 'kpi' ? <SalesKpiBlock /> : null}
    </div>
  );
}
