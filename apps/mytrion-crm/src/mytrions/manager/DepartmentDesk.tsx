/**
 * Shared department landing — page chrome + workspace blocks (Tasks first).
 */
import { Clock3 } from 'lucide-react';
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

      {dept.id === 'sales' ? (
        <section className="mg-coming-soon" aria-label="Sales Manager coming soon">
          <span>
            <Clock3 size={22} />
          </span>
          <div className="mg-kicker">Coming soon</div>
          <h2>Sales Manager is being prepared</h2>
          <p>
            Pipeline oversight and agent performance controls are temporarily held back while the
            production workflow is finalized.
          </p>
        </section>
      ) : (
        <TasksBlock department={dept.id as ManagerTaskDepartment} />
      )}
    </div>
  );
}
