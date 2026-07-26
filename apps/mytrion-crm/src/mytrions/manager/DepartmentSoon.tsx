import { Clock3, Sparkles } from 'lucide-react';
import type { ManagerDepartment } from './managerNav';

/**
 * A department landing before it has any surface of its own. Deliberately not a bare "Coming soon"
 * string: it names the department, keeps its hue so the sidebar selection and the page agree, and
 * states what will live here — so the page is informative even while it's empty.
 */
export function DepartmentSoon({ dept }: { dept: ManagerDepartment }) {
  const Icon = dept.icon;
  return (
    <div className="mg-page" style={{ ['--mg-tone' as string]: dept.tone }}>
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          <span className="mg-page-glyph" aria-hidden="true">
            <Icon size={22} strokeWidth={1.9} />
          </span>
          <div>
            <div className="mg-kicker">Departments</div>
            <h1 className="mg-page-title">{dept.label}</h1>
            <p className="mg-page-sub">{dept.description}</p>
          </div>
        </div>
      </header>

      <section className="mg-soon" role="status">
        <span className="mg-soon-glyph" aria-hidden="true">
          <Sparkles size={26} strokeWidth={1.8} />
        </span>
        <div className="mg-soon-badge">
          <Clock3 size={12} strokeWidth={2.4} aria-hidden="true" />
          Coming soon
        </div>
        <h2 className="mg-soon-title">{dept.label} is being built</h2>
        <p className="mg-soon-body">
          This desk doesn&rsquo;t have a surface yet. When it lands it will live right here, using the
          same records the department works from — no separate source of truth.
        </p>
      </section>
    </div>
  );
}
