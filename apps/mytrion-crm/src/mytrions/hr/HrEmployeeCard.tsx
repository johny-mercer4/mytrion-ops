import { type CSSProperties } from 'react';
import { Pencil, Send, Trash2 } from 'lucide-react';
import type { HrEmployeeDto } from '../../api/hr';
import { departmentTone } from './departmentAppearance';
import { HrAvatar } from './HrAvatar';
import { Pill, toneFor } from './HrBits';

export const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

/**
 * One employee, as a card.
 *
 * The card is an `<article>` with a real hit `<button>` for open-detail, and separate real action
 * buttons for admin edit/delete. Nesting interactives (the old whole-card `<button>` wrapping
 * role=button spans) made hover/focus fight the top-right controls — the status pills and action
 * icons shared the same corner, and keyboard focus was ambiguous. Actions sit bottom-right now so
 * they never cover the status/ID row.
 *
 * `source` is deliberately not rendered. It still exists on the row (it marks which records the Zoho
 * People sync still owns) but it is operator plumbing, not something an HR user needs on every card.
 */
export function HrEmployeeCard({
  employee,
  admin,
  busy,
  departmentColor,
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
  /** Department tone token (e.g. `tone-sky`) — drives the department chip colour. */
  departmentColor?: string | null;
  onOpen: (e: HrEmployeeDto) => void;
  onEdit: (e: HrEmployeeDto) => void;
  onDelete: (e: HrEmployeeDto) => void;
}) {
  const name = displayName(employee);
  const terminated = employee.status.toLowerCase() === 'terminated';
  const handle = (employee.telegramUsername ?? '').trim().replace(/^@+/, '');
  const deptTone = departmentTone(departmentColor ?? null, employee.departmentId);

  return (
    <article
      className={`hr-empc${terminated ? ' is-terminated' : ''}${busy ? ' hr-card-saving' : ''}${
        admin ? ' is-admin' : ''
      }`}
      aria-busy={busy}
      style={{ ['--dc' as string]: deptTone } as CSSProperties}
    >
      <button
        type="button"
        className="hr-empc-hit"
        onClick={() => onOpen(employee)}
        aria-label={`Open ${name}`}
        disabled={busy}
      >
        <span className="hr-empc-shimmer" aria-hidden="true" />

        <span className="hr-empc-top">
          <HrAvatar
            name={name}
            employeeId={employee.id}
            photoFileId={employee.photoFileId}
            size="lg"
          />
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
          {/* Titled because the column ellipsises it: a mytriontrucking.com address does not fit the
              268px grid minimum, and scanning the directory by email otherwise means opening each card. */}
          {employee.email ? (
            <span className="hr-empc-mail" title={employee.email}>
              {employee.email}
            </span>
          ) : null}
          {handle ? (
            <span className="hr-empc-tg" title={`Telegram @${handle}`}>
              <Send size={11} />@{handle}
            </span>
          ) : null}
        </span>
      </button>

      {admin ? (
        <div className="hr-empc-actions">
          <button
            type="button"
            className="hr-icon-btn"
            aria-label={`Edit ${name}`}
            disabled={busy}
            onClick={() => onEdit(employee)}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="hr-icon-btn hr-icon-danger"
            aria-label={`Delete ${name}`}
            disabled={busy}
            onClick={() => onDelete(employee)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : null}
    </article>
  );
}
