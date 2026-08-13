/**
 * The attendance roster as rows — the same table the people directory uses.
 *
 * It was a narrow column of two-line rows beside a cramped detail pane, which is a picker, not a
 * directory: you could not compare two people, and department and shift had nowhere to live. This is
 * the `HrEmployeeList` treatment applied to attendance, so the two tabs read as one product and the
 * columns line up the way a list is supposed to.
 *
 * A real `<table>`, not a grid of divs: this is tabular data, and the semantics are what give a screen
 * reader "Department, column 4" instead of a wall of unlabelled text.
 *
 * The NAME is the button and the row is clickable as a convenience — making every `<tr>` focusable
 * would put a tab stop on each of 145 rows.
 */
import { useIsPhone } from '@/hooks/useMediaQuery';
import type { AttendanceTeamListItem } from '../../api/hr';
import { PhoneList, PhoneListRow } from '../_shared/phone/PhoneList';
import { departmentTone } from './departmentAppearance';
import { HrAvatar } from './HrAvatar';

/** The same wording the tiles and the day rows use, so one state is never named two ways. */
const PRESENCE_TEXT: Record<string, string> = {
  in_office: 'In office',
  out_of_office: 'Out of office',
  needs_review: 'Needs review',
  no_activity: 'No activity',
};

const displayName = (e: AttendanceTeamListItem): string => `${e.firstName} ${e.lastName}`.trim();

export function HrAttendanceRoster({
  items,
  selectedId,
  onOpen,
}: {
  items: readonly AttendanceTeamListItem[];
  selectedId: string | null;
  onOpen: (item: AttendanceTeamListItem) => void;
}) {
  const phone = useIsPhone();
  if (phone) {
    return (
      <PhoneList label="Attendance roster">
        {items.map((item) => {
          const name = displayName(item);
          const presence = PRESENCE_TEXT[item.currentState] ?? 'No activity';
          const meta = [item.department, item.shift ? `${item.shift.startLocal}–${item.shift.endLocal}` : 'No shift', presence]
            .filter(Boolean)
            .join(' · ');
          return (
            <PhoneListRow
              key={item.employeeId}
              title={name}
              meta={meta}
              onClick={() => onOpen(item)}
            />
          );
        })}
      </PhoneList>
    );
  }
  return (
    <div className="hr-listwrap">
      <table className="hr-list hr-att-list">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Employee ID</th>
            <th scope="col">Designation</th>
            <th scope="col">Department</th>
            <th scope="col">Shift</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const name = displayName(item);
            const on = item.employeeId === selectedId;
            return (
              <tr
                key={item.employeeId}
                className={on ? 'is-on' : ''}
                aria-current={on ? 'true' : undefined}
                /* Seeded from the department id so a chip is the same colour here, in the directory,
                   and on the org canvas — the roster has no stored tone map of its own to consult. */
                style={{ ['--dc' as string]: departmentTone(null, item.departmentId) }}
                onClick={() => onOpen(item)}
              >
                <td>
                  <div className="hr-list-person">
                    <HrAvatar
                      name={name}
                      employeeId={item.employeeId}
                      photoFileId={item.photoFileId}
                      size="sm"
                    />
                    <button
                      type="button"
                      className="hr-list-name"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(item);
                      }}
                    >
                      {name}
                    </button>
                  </div>
                </td>
                <td className="hr-mono hr-list-dim">{item.employeeCode || '—'}</td>
                <td>{item.designation || '—'}</td>
                <td>
                  {item.department ? (
                    <span className="hr-empc-dept">{item.department}</span>
                  ) : (
                    <span className="hr-list-dim">—</span>
                  )}
                </td>
                <td>
                  {item.shift ? (
                    /* The window, not just the name: whether someone is "late" is meaningless without
                       it, and nearly everyone shares one shift so the name alone carries nothing. */
                    <span className="hr-mono hr-list-dim">
                      {item.shift.startLocal}–{item.shift.endLocal}
                    </span>
                  ) : (
                    <em className="hr-att-row-flag">No shift</em>
                  )}
                </td>
                <td>
                  <span className="hr-att-state" data-state={item.currentState}>
                    <span className="hr-att-state-dot" aria-hidden="true" />
                    {PRESENCE_TEXT[item.currentState] ?? 'No activity'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
