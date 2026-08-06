/**
 * Shared department landing — page chrome + workspace blocks (Tasks first).
 *
 * Every desk gets the same blocks, Sales included. Sales used to render a "coming soon" panel here
 * instead, which meant the one department with a fully-built agent-side task board had no manager
 * side to assign from — the two halves of `mytrion_worker_tasks` were never both switched on.
 */
import type { ManagerDepartment } from './managerNav';
import type { ManagerTaskDepartment } from '../../api/managerTasks';
import { TasksBlock } from './tasks/TasksBlock';

export function DepartmentDesk({ dept }: { dept: ManagerDepartment }) {
  const Icon = dept.icon;
  return (
    <div className="mg-page" style={{ ['--mg-tone' as string]: dept.tone }}>
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          <span className="mg-page-glyph" aria-hidden="true">
            <Icon size={22} strokeWidth={1.9} />
          </span>
          <div>
            <div className="mg-kicker">Manager · {dept.navLabel}</div>
            <h1 className="mg-page-title">{dept.label}</h1>
            <p className="mg-page-sub">{dept.description}</p>
          </div>
        </div>
      </header>

      <TasksBlock
        department={dept.id as ManagerTaskDepartment}
        departmentLabel={dept.navLabel}
      />
    </div>
  );
}
