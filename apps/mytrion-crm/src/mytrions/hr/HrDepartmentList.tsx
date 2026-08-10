/**
 * Departments as rows. Same contract as `HrEmployeeList` — a real table, the name is the button, the
 * row is a mouse convenience.
 *
 * The headcount column keeps the card's THREE states: `undefined` means the directory has not landed
 * (a second, slower fetch), which is not the same as a department with nobody in it.
 */
import { useMemo } from 'react';
import { DataTable, type DataColumn } from '@/ds';
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
  /**
   * Built in-component: the headcount cell reads `headcountFor` and the busy state reads `busyId`,
   * both of which are props that change.
   *
   * MOBILE ROLES — a department is its name (primary), its code and lead (secondary) and its
   * headcount (the one value). "Under" and the description are context you read once you have
   * picked one, so they open with it.
   */
  const columns = useMemo<DataColumn<HrDepartmentDto>[]>(
    () => [
      {
        id: 'name',
        header: 'Department',
        rowHeader: true,
        mobile: 'primary',
        cell: (department) => {
          const Icon = departmentIcon(department.icon);
          const busy = busyId === department.id;
          return (
            <div
              className="hr-list-person"
              /* --dc lives here rather than on the row: it is only ever read by .hr-list-glyph and
                 .hr-list-name:hover, both inside this cell, so this is the same paint with no
                 per-row style hook. */
              style={{ ['--dc' as string]: departmentTone(department.iconColor, department.id) }}
            >
              <span className="hr-list-glyph" aria-hidden="true">
                <Icon size={14} />
              </span>
              {/* The row's real affordance: a keyboard user tabs to this, not to 222 focusable
                  table rows — which is why the table uses rowActivation="cell". */}
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
          );
        },
        // Plain text on the card: the card is already a button, and a button inside a button is
        // invalid HTML.
        mobileCell: (department) => department.name,
      },
      {
        id: 'code',
        header: 'Code',
        mobile: 'secondary',
        cell: (department) => (
          <span className="hr-mono hr-list-dim">{department.code || '—'}</span>
        ),
      },
      {
        id: 'lead',
        header: 'Lead',
        mobile: 'secondary',
        cell: (department) => department.leadName || '—',
      },
      {
        id: 'parent',
        header: 'Under',
        priority: 2,
        cell: (department) =>
          department.parentName || <span className="hr-list-dim">Top level</span>,
      },
      {
        id: 'people',
        header: 'People',
        mobile: 'value',
        cell: (department) => {
          const staff = headcountFor(department.id);
          return (
            <span className="hr-list-count">
              {/* THREE states, not two: `undefined` means the directory has not landed (a second,
                  slower fetch), which is not the same as a department with nobody in it. */}
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
            </span>
          );
        },
      },
      {
        id: 'description',
        header: 'Description',
        priority: 3,
        cell: (department) => {
          const blurb = summarize(department.description);
          return (
            <span className="hr-list-blurb">
              {blurb || <span className="hr-list-dim">No description yet.</span>}
            </span>
          );
        },
      },
    ],
    [busyId, headcountFor, onOpen],
  );

  return (
    <DataTable
      caption="Departments"
      rows={departments}
      rowKey={(department) => department.id}
      columns={columns}
      className="hr-list"
      scrollerClassName="hr-listwrap"
      /* Click is a mouse convenience; the name button is the keyboard path. See the component
         docblock — a directory this long must not put a tab stop on every row. */
      rowActivation="cell"
      onRowActivate={(department) => {
        if (busyId !== department.id) onOpen(department);
      }}
    />
  );
}
