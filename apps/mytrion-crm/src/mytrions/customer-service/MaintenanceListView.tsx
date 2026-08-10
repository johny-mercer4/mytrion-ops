/**
 * Maintenance — List view (CS feedback 2026-08-07: "the list view we had before was much easier to
 * scan than this card grid"). The same page of rows the card grid renders, in a denser layout for
 * scanning many cases at once.
 *
 * Below the structure line `DataTable` turns this into a card list; tapping a card opens the same
 * `MaintenanceModal` a desktop row-click does, so the columns that drop off the card are still one
 * tap away — they are in the case record, which is the detail view here.
 */
import type { MouseEvent } from 'react';
import { DataTable, type DataColumn } from '@/ds';
import { copyWithToast } from './copyToast';
import { fmtMoneyStr, fmtYmd, maintenanceTitle, type MaintenanceRecord } from './live';

/** Same tone maps the card uses (MaintenanceCard.tsx) — a status reads the same color everywhere. */
const STATUS_BADGE: Record<string, string> = {
  'In Process': 'cs-badge-warning',
  Completed: 'cs-badge-success',
  Cancelled: 'cs-badge-muted',
};
const PAY_BADGE: Record<string, string> = {
  Paid: 'cs-badge-success',
  Pending: 'cs-badge-warning',
  'Not Paid': 'cs-badge-danger',
  Delay: 'cs-badge-orange',
  'N/A': 'cs-badge-muted',
};

const dash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

/**
 * A cell you can click to copy — QA feedback 2026-08-11: clicking Company / Carrier ID / Unit # /
 * Amount opened the record modal instead of copying, because those cells had no handler at all.
 *
 * THE WHOLE CELL is the target, via `cellProps` — exactly as the original did by spreading onto the
 * `<td>`. Putting the handler on the rendered content instead leaves the cell's padding still
 * activating the row, so a click copies or opens the record depending on which pixel it hit.
 *
 * `stopPropagation` is what makes it work at all: the row is the activate target, so without it a
 * copy click opens the modal too. Nothing to copy means no handler and no pointer cursor, rather
 * than a control that looks live and does nothing.
 *
 * DESKTOP ONLY, deliberately — `cellProps` is table-mode only. Below the structure line the row
 * becomes a card that IS a button, and a second click target nested inside it is ambiguous under a
 * thumb, so the copy columns give `mobileCell` plain text. Every value is in the record the card
 * opens.
 */
function copyable(
  baseClass: string,
  text: string,
  label: string,
): {
  className: string;
  title?: string | undefined;
  onClick?: ((event: MouseEvent<HTMLTableCellElement>) => void) | undefined;
} {
  if (!text) return { className: baseClass };
  return {
    className: `${baseClass} cs-mt-cell-copyable`,
    title: `Click to copy ${label}`,
    onClick: (event) => {
      event.stopPropagation();
      copyWithToast(text, event);
    },
  };
}

/**
 * Module scope, not inline: `DataTable` memoises its rows on `columns` identity, and an array
 * rebuilt every render would silently undo that.
 *
 * MOBILE ROLES — what an agent needs to triage a case at 375px: which company (primary), enough to
 * identify the job (carrier, unit, date), and whether it is still open (status, the one value).
 * Amount, case type, sign-off date, owner and payment state are what you read AFTER deciding a case
 * is the one you want, so they stay off the card and live in the record.
 */
export const COLUMNS: DataColumn<MaintenanceRecord>[] = [
  {
    id: 'company',
    header: 'Company',
    rowHeader: true,
    mobile: 'primary',
    cellProps: (row) => copyable('cs-mt-list-company', maintenanceTitle(row), 'Company'),
    cell: (row) => maintenanceTitle(row),
    mobileCell: (row) => maintenanceTitle(row),
  },
  {
    id: 'carrierId',
    header: 'Carrier ID',
    mobile: 'secondary',
    cellProps: (row) => copyable('cs-mt-list-mono', row.carrierId ?? '', 'Carrier ID'),
    cell: (row) => dash(row.carrierId),
    mobileCell: (row) => dash(row.carrierId),
  },
  {
    id: 'unit',
    header: 'Unit #',
    mobile: 'secondary',
    cellProps: (row) => copyable('cs-mt-list-mono', row.unitNumber ?? '', 'Unit #'),
    cell: (row) => dash(row.unitNumber),
    mobileCell: (row) => dash(row.unitNumber),
  },
  {
    id: 'status',
    header: 'Status',
    mobile: 'value',
    cell: (row) => {
      const status = row.status ?? '';
      return (
        <span className={`cs-badge cs-badge-sm ${STATUS_BADGE[status] ?? 'cs-badge-muted'}`}>
          {status || '—'}
        </span>
      );
    },
  },
  { id: 'caseType', header: 'Case Type', priority: 2, cell: (row) => dash(row.caseType) },
  {
    id: 'caseDate',
    header: 'Date',
    mobile: 'secondary',
    cell: (row) => <span className="cs-mt-list-mono">{fmtYmd(row.caseDate) || '—'}</span>,
  },
  {
    id: 'completed',
    header: 'Completed',
    priority: 3,
    cell: (row) => (
      <span className="cs-mt-list-mono">
        {row.caseCompletion ? (
          fmtYmd(row.caseCompletion)
        ) : (
          <span className="cs-mt-list-open">Not signed off</span>
        )}
      </span>
    ),
  },
  {
    id: 'owner',
    header: 'Owner',
    priority: 2,
    cell: (row) => (
      <span className="cs-mt-list-owner" title={row.ownerName ?? 'Unassigned'}>
        {row.ownerName || 'Unassigned'}
      </span>
    ),
  },
  {
    id: 'payment',
    header: 'Payment',
    priority: 2,
    cell: (row) => {
      const payStatus = row.paymentStatus ?? '';
      return payStatus ? (
        <span className={`cs-badge cs-badge-sm ${PAY_BADGE[payStatus] ?? 'cs-badge-muted'}`}>
          {payStatus}
        </span>
      ) : (
        '—'
      );
    },
  },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    align: 'end',
    cellProps: (row) =>
      copyable('cs-mt-list-amount', row.totalAmount ? fmtMoneyStr(row.totalAmount) : '', 'Amount'),
    cell: (row) => fmtMoneyStr(row.totalAmount),
    mobileCell: (row) => fmtMoneyStr(row.totalAmount),
  },
];

export function MaintenanceListView({
  rows,
  onOpen,
}: {
  rows: MaintenanceRecord[];
  onOpen: (row: MaintenanceRecord) => void;
}) {
  return (
    <DataTable
      caption="Maintenance cases"
      rows={rows}
      rowKey={(row) => row.id}
      columns={COLUMNS}
      scrollerClassName="cs-table-wrap cs-mt-list-wrap"
      className="cs-table cs-mt-list"
      /* No `detail`: the caller already owns MaintenanceModal, which IS the case record. Giving
         DataTable a sheet as well would put a second, thinner detail view one tap away from the
         real one. */
      onRowActivate={onOpen}
    />
  );
}
