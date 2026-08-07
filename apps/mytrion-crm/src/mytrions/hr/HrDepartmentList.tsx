/**
 * Departments as rows. Same contract as `HrEmployeeList` — a real table, the name is the button, the
 * row is a mouse convenience.
 *
 * The headcount column keeps the card's THREE states: `undefined` means the directory has not landed
 * (a second, slower fetch), which is not the same as a department with nobody in it.
 */
import type { HrDepartmentDto } from '../../api/hr';
import { departmentIcon, departmentTone } from './departmentAppearance';

/** Markdown stripped back to one line of prose — the same treatment the card's summary gets. */
function summarize(markdown: string | null): string {
  if (!markdown) return '';
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function HrDepartmentList({
  departments,
  headcountFor,
  busyId,
  onOpen,
}: {
  departments: readonly HrDepartmentDto[];
  headcountFor: (id: string) => { total: number; active: number } | undefined;
  busyId: string | null;
  onOpen: (d: HrDepartmentDto) => void;
}) {
  return (
    <div className="hr-listwrap">
      <table className="hr-list">
        <thead>
          <tr>
            <th scope="col">Department</th>
            <th scope="col">Code</th>
            <th scope="col">Lead</th>
            <th scope="col">Under</th>
            <th scope="col">People</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => {
            const Icon = departmentIcon(department.icon);
            const staff = headcountFor(department.id);
            const busy = busyId === department.id;
            const blurb = summarize(department.description);
            return (
              <tr
                key={department.id}
                className={busy ? 'is-busy' : undefined}
                aria-busy={busy}
                style={{
                  ['--dc' as string]: departmentTone(department.iconColor, department.id),
                }}
                onClick={() => {
                  if (!busy) onOpen(department);
                }}
              >
                <td>
                  <div className="hr-list-person">
                    <span className="hr-list-glyph" aria-hidden="true">
                      <Icon size={14} />
                    </span>
                    <button
                      type="button"
                      className="hr-list-name"
                      disabled={busy}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(department);
                      }}
                    >
                      {department.name}
                    </button>
                  </div>
                </td>
                <td className="hr-mono hr-list-dim">{department.code || '—'}</td>
                <td>{department.leadName || '—'}</td>
                <td>{department.parentName || <span className="hr-list-dim">Top level</span>}</td>
                <td className="hr-list-count">
                  {staff === undefined ? (
                    <span className="hr-list-dim" title="Headcount still loading">
                      —
                    </span>
                  ) : staff.total === 0 ? (
                    <span className="hr-list-dim">No one</span>
                  ) : (
                    <>
                      <strong>{staff.active}</strong>
                      {staff.total !== staff.active ? (
                        <span className="hr-list-dim"> / {staff.total}</span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="hr-list-blurb">
                  {blurb || <span className="hr-list-dim">No description yet.</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
