/**
 * Maintenance — List view (CS feedback 2026-08-07: "the list view we had before was much easier to
 * scan than this card grid"). The same page of rows the card grid renders, in a denser layout for
 * scanning many cases at once.
 *
 * Below the structure line `DataTable` turns this into a card list; tapping a card opens the same
 * `MaintenanceModal` a desktop row-click does, so the columns that drop off the card are still one
 * tap away — they are in the case record, which is the detail view here.
 */
import { DataTable, Icon, type DataColumn } from '@/ds';
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
 * A small copy-to-clipboard button next to a cell's value (2026-08-18: previously the WHOLE cell
 * was the copy target via `cellProps`, which meant Company / Carrier ID / Unit # / Amount could
 * not be clicked into the record like every other column — that read as broken, not as a feature.
 * Every column now opens the record on click; copying gets its own explicit target instead.
 *
 * `stopPropagation` is still required: the row is the activate target, so without it the button's
 * own click would also open the modal. Nothing to copy means no button, rather than a control that
 * looks live and does nothing.
 *
 * DESKTOP ONLY, deliberately — the mobile card IS a button, and a second nested click target under
 * a thumb is ambiguous, so the copy columns give `mobileCell` plain text. Every value is in the
 * record the card opens.
 */
function copyButton(text: string, label: string) {
  if (!text) return null;
  return (
    <button
      type="button"
      className="cs-mt-copy-btn"
      aria-label={`Copy ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        copyWithToast(text, event);
      }}
    >
      <Icon name="content_copy" size="sm" />
    </button>
  );
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
    cellProps: () => ({ className: 'cs-mt-list-company' }),
    cell: (row) => {
      const name = maintenanceTitle(row);
      return (
        <span className="cs-mt-cell-copy-row">
          <span className="cs-mt-cell-copy-text">{name}</span>
          {copyButton(name, 'Company')}
        </span>
      );
    },
    mobileCell: (row) => maintenanceTitle(row),
  },
  {
    id: 'carrierId',
    header: 'Carrier ID',
    mobile: 'secondary',
    cellProps: () => ({ className: 'cs-mt-list-mono' }),
    cell: (row) => (
      <span className="cs-mt-cell-copy-row">
        {dash(row.carrierId)}
        {copyButton(row.carrierId ?? '', 'Carrier ID')}
      </span>
    ),
    mobileCell: (row) => dash(row.carrierId),
  },
  {
    id: 'unit',
    header: 'Unit #',
    mobile: 'secondary',
    cellProps: () => ({ className: 'cs-mt-list-mono' }),
    cell: (row) => (
      <span className="cs-mt-cell-copy-row">
        {dash(row.unitNumber)}
        {copyButton(row.unitNumber ?? '', 'Unit #')}
      </span>
    ),
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
    cellProps: () => ({ className: 'cs-mt-list-amount' }),
    cell: (row) => (
      <span className="cs-mt-cell-copy-row">
        {fmtMoneyStr(row.totalAmount)}
        {copyButton(row.totalAmount ? fmtMoneyStr(row.totalAmount) : '', 'Amount')}
      </span>
    ),
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
