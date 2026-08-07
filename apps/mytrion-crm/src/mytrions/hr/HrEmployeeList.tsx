/**
 * The people directory as rows.
 *
 * A real `<table>`, not a grid of divs: this is tabular data, and the semantics are what give a screen
 * reader "Department, column 4" instead of a wall of unlabelled text. It also gets column alignment for
 * free, which is the entire reason to want a list over cards.
 *
 * The NAME is the button, and the row is clickable as a convenience. Making the whole `<tr>` focusable
 * would put a tab stop on every one of 222 rows and leave the admin actions inside it unreachable.
 */
import { Pencil, Send, Trash2 } from 'lucide-react';
import type { HrEmployeeDto } from '../../api/hr';
import { departmentTone } from './departmentAppearance';
import { HrAvatar } from './HrAvatar';
import { Pill, toneFor } from './HrBits';

const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

export function HrEmployeeList({
  employees,
  admin,
  isBusy,
  departmentColor,
  onOpen,
  onEdit,
  onDelete,
}: {
  employees: readonly HrEmployeeDto[];
  admin: boolean;
  /** A delete can be in flight for several rows at once — the tab tracks a set, not one id. */
  isBusy: (id: string) => boolean;
  /** department id → stored tone token, so a row's chip matches that department everywhere else. */
  departmentColor: (departmentId: string | null) => string | null;
  onOpen: (e: HrEmployeeDto) => void;
  onEdit: (e: HrEmployeeDto) => void;
  onDelete: (e: HrEmployeeDto) => void;
}) {
  return (
    <div className="hr-listwrap">
      <table className="hr-list">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Employee ID</th>
            <th scope="col">Designation</th>
            <th scope="col">Department</th>
            <th scope="col">Contact</th>
            <th scope="col">Status</th>
            {admin ? (
              <th scope="col" className="hr-list-actions-col">
                <span className="hr-sr">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const name = displayName(employee);
            const busy = isBusy(employee.id);
            const terminated = employee.status.toLowerCase() === 'terminated';
            const handle = (employee.telegramUsername ?? '').trim().replace(/^@+/, '');
            return (
              <tr
                key={employee.id}
                className={`${terminated ? 'is-terminated' : ''}${busy ? ' is-busy' : ''}`}
                aria-busy={busy}
                style={{ ['--dc' as string]: departmentTone(departmentColor(employee.departmentId), employee.departmentId) }}
                onClick={() => {
                  if (!busy) onOpen(employee);
                }}
              >
                <td>
                  <div className="hr-list-person">
                    <HrAvatar
                      name={name}
                      employeeId={employee.id}
                      photoFileId={employee.photoFileId}
                      size="sm"
                    />
                    <button
                      type="button"
                      className="hr-list-name"
                      disabled={busy}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(employee);
                      }}
                    >
                      {name}
                    </button>
                  </div>
                </td>
                <td className="hr-mono hr-list-dim">{employee.employeeId || '—'}</td>
                <td>{employee.designation || '—'}</td>
                <td>
                  {employee.department ? (
                    <span className="hr-empc-dept">{employee.department}</span>
                  ) : (
                    <span className="hr-list-dim">—</span>
                  )}
                </td>
                <td className="hr-list-contact">
                  {employee.email ? (
                    <span className="hr-mono" title={employee.email}>
                      {employee.email}
                    </span>
                  ) : null}
                  {handle ? (
                    <span className="hr-list-tg" title={`Telegram @${handle}`}>
                      <Send size={10} />@{handle}
                    </span>
                  ) : null}
                  {!employee.email && !handle ? <span className="hr-list-dim">—</span> : null}
                </td>
                <td>
                  <Pill label={employee.status} tone={toneFor(employee.status)} />
                </td>
                {admin ? (
                  <td className="hr-list-actions-col">
                    <div className="hr-list-actions">
                      <button
                        type="button"
                        className="hr-icon-btn"
                        aria-label={`Edit ${name}`}
                        disabled={busy}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onEdit(employee);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="hr-icon-btn hr-icon-danger"
                        aria-label={`Delete ${name}`}
                        disabled={busy}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onDelete(employee);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
