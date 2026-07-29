import { Pencil, Send, Trash2 } from 'lucide-react';
import type { HrEmployeeDto } from '../../api/hr';
import { HrAvatar } from './HrAvatar';
import { Pill, toneFor } from './HrBits';

export const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

/**
 * One employee, as a card.
 *
 * The whole card is the click target that opens the detail modal, so it is a real `<button>`: keyboard
 * users get Enter/Space and the focus ring for free, which a div with onClick would not give. The admin
 * edit/delete controls sit INSIDE it, so their handlers stop propagation — otherwise editing would also
 * open the detail modal behind the form.
 *
 * `source` is deliberately not rendered. It still exists on the row (it marks which records the Zoho
 * People sync still owns) but it is operator plumbing, not something an HR user needs on every card.
 */
export function HrEmployeeCard({
  employee,
  admin,
  busy,
  onOpen,
  onEdit,
  onDelete,
}: {
  employee: HrEmployeeDto;
  admin: boolean;
  /**
   * A write is in flight for this row: dim it and make it inert, in place.
   *
   * Taken as a prop rather than handled by wrapping the card in a div at the call site — the grid sizes
   * its children, so an extra element between the grid and the card broke the equal-height rows the whole
   * layout depends on, and only for the one card being saved.
   */
  busy?: boolean;
  onOpen: (e: HrEmployeeDto) => void;
  onEdit: (e: HrEmployeeDto) => void;
  onDelete: (e: HrEmployeeDto) => void;
}) {
  const name = displayName(employee);
  const terminated = employee.status.toLowerCase() === 'terminated';
  const handle = (employee.telegramUsername ?? '').trim().replace(/^@+/, '');

  return (
    <button
      type="button"
      className={`hr-empc${terminated ? ' is-terminated' : ''}${busy ? ' hr-card-saving' : ''}`}
      onClick={() => onOpen(employee)}
      aria-label={`Open ${name}`}
      aria-busy={busy}
    >
      <span className="hr-empc-shimmer" aria-hidden="true" />

      <span className="hr-empc-top">
        <HrAvatar name={name} photoUrl={employee.photoUrl} size="lg" />
        <span className="hr-empc-id">
          {/* Status first: whether someone still works here outranks their id. */}
          <Pill label={employee.status} tone={toneFor(employee.status)} />
          {employee.employeeId ? <span className="hr-mono">{employee.employeeId}</span> : null}
        </span>
      </span>

      <span className="hr-empc-name">{name}</span>
      <span className="hr-empc-role">{employee.designation ?? '—'}</span>

      <span className="hr-empc-meta">
        {employee.department ? <span className="hr-empc-dept">{employee.department}</span> : null}
        {employee.email ? <span className="hr-empc-mail">{employee.email}</span> : null}
        {handle ? (
          <span className="hr-empc-tg" title={`Telegram @${handle}`}>
            <Send size={11} />@{handle}
          </span>
        ) : null}
      </span>

      {admin ? (
        <span className="hr-empc-actions">
          <span
            role="button"
            tabIndex={0}
            className="hr-icon-btn"
            aria-label={`Edit ${name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              onEdit(employee);
            }}
            onKeyDown={(ev) => {
              if (ev.key !== 'Enter' && ev.key !== ' ') return;
              ev.preventDefault();
              ev.stopPropagation();
              onEdit(employee);
            }}
          >
            <Pencil size={13} />
          </span>
          <span
            role="button"
            tabIndex={0}
            className="hr-icon-btn hr-icon-danger"
            aria-label={`Delete ${name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              onDelete(employee);
            }}
            onKeyDown={(ev) => {
              if (ev.key !== 'Enter' && ev.key !== ' ') return;
              ev.preventDefault();
              ev.stopPropagation();
              onDelete(employee);
            }}
          >
            <Trash2 size={13} />
          </span>
        </span>
      ) : null}
    </button>
  );
}
