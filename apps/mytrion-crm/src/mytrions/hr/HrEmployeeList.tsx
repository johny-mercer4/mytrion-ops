/**
 * The people directory as rows.
 *
 * A real table, not a grid of divs: this is tabular data, and the semantics are what give a screen
 * reader "Department, column 4" instead of a wall of unlabelled text. It also gets column alignment
 * for free, which is the entire reason to want a list over cards. `ds/DataTable` renders it, so the
 * same column definition also becomes a card list below the structure line — looking someone up on
 * a phone is a real task, and 222 people in a seven-column sideways scroll is not it.
 *
 * The NAME is the button, and the row click is a mouse convenience. Making the whole row focusable
 * would put a tab stop on every one of 222 rows and leave the admin actions inside it unreachable —
 * which is what `rowActivation="cell"` expresses.
 */
import { useMemo } from 'react';
import { Pencil, Send, Trash2 } from 'lucide-react';
import { DataTable, type DataColumn } from '@/ds';
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
  /**
   * Built in-component: every cell reads a prop that changes (`isBusy`, `departmentColor`, `admin`).
   *
   * MOBILE ROLES — looking someone up on a phone is a real task, and it is answered by name
   * (primary), designation and department (secondary), and whether they still work here (status,
   * the one value). Employee id and contact details open with the person.
   */
  const columns = useMemo<DataColumn<HrEmployeeDto>[]>(() => {
    const base: DataColumn<HrEmployeeDto>[] = [
      {
        id: 'name',
        header: 'Name',
        rowHeader: true,
        mobile: 'primary',
        cell: (employee) => {
          const name = displayName(employee);
          return (
            <div
              className="hr-list-person"
              /* --dc is read only by .hr-list-glyph and .hr-list-name:hover, both inside this
                 cell, so it belongs here rather than on the row. */
              style={{
                ['--dc' as string]: departmentTone(
                  departmentColor(employee.departmentId),
                  employee.departmentId,
                ),
              }}
            >
              <HrAvatar
                name={name}
                employeeId={employee.id}
                photoFileId={employee.photoFileId}
                size="sm"
              />
              {/* The NAME is the button; the row click is a mouse convenience. Making the whole
                  <tr> focusable would put a tab stop on every one of 222 rows and leave the admin
                  actions inside it unreachable — hence rowActivation="cell". */}
              <button
                type="button"
                className="hr-list-name"
                disabled={isBusy(employee.id)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onOpen(employee);
                }}
              >
                {name}
              </button>
            </div>
          );
        },
        // Plain text on the card: the card is a button, and a button inside a button is invalid.
        mobileCell: (employee) => displayName(employee),
      },
      {
        id: 'employeeId',
        header: 'Employee ID',
        priority: 2,
        cell: (employee) => (
          <span className="hr-mono hr-list-dim">{employee.employeeId || '—'}</span>
        ),
      },
      {
        id: 'designation',
        header: 'Designation',
        mobile: 'secondary',
        cell: (employee) => employee.designation || '—',
      },
      {
        id: 'department',
        header: 'Department',
        mobile: 'secondary',
        cell: (employee) =>
          employee.department ? (
            <span className="hr-empc-dept">{employee.department}</span>
          ) : (
            <span className="hr-list-dim">—</span>
          ),
      },
      {
        id: 'contact',
        header: 'Contact',
        priority: 3,
        cell: (employee) => {
          const handle = (employee.telegramUsername ?? '').trim().replace(/^@+/, '');
          return (
            <span className="hr-list-contact">
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
            </span>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        mobile: 'value',
        cell: (employee) => <Pill label={employee.status} tone={toneFor(employee.status)} />,
      },
    ];

    if (!admin) return base;
    return [
      ...base,
      {
        id: 'actions',
        header: <span className="hr-sr">Actions</span>,
        /* Off the card and off the record sheet: on a phone the card is already one tap target, and
           edit/delete belong in the person's own view where there is room to confirm them. */
        mobileCell: () => null,
        detail: false,
        cell: (employee) => {
          const name = displayName(employee);
          const busy = isBusy(employee.id);
          return (
            <span className="hr-list-actions">
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
            </span>
          );
        },
      },
    ];
  }, [admin, departmentColor, isBusy, onDelete, onEdit, onOpen]);

  return (
    <DataTable
      caption="People directory"
      rows={employees}
      rowKey={(employee) => employee.id}
      columns={columns}
      className="hr-list"
      scrollerClassName="hr-listwrap"
      rowActivation="cell"
      rowState={(employee) => ({
        className:
          employee.status.toLowerCase() === 'terminated' ? 'is-terminated' : undefined,
        busy: isBusy(employee.id),
      })}
      onRowActivate={(employee) => {
        if (!isBusy(employee.id)) onOpen(employee);
      }}
    />
  );
}
