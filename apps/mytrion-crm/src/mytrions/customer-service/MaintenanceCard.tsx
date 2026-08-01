/**
 * One maintenance case, as a card.
 *
 * `memo` is load-bearing, not an optimisation reflex: the search box lives in the panel, so every
 * keystroke re-renders it, and without this each keystroke would re-render all 24 cards. It only
 * works because `onOpen` is useCallback'd in the panel and everything else here is a module constant
 * — a fresh function identity per render would defeat the memo silently.
 *
 * Layout is fixed-slot on purpose. Coverage across the 2,714 migrated records is uneven (100% have a
 * company name, 87% a carrier id, 72% an owner), so a card that collapsed empty fields would make
 * every row a different height and the grid would look broken. Missing values render as an em dash.
 */
import { memo } from 'react';

import { fmtMoneyStr, fmtYmd, maintenanceTitle, type MaintenanceRecord } from './live';

/** Status → the module's existing badge tones. Unknown values stay muted rather than unstyled. */
const STATUS_BADGE: Record<string, string> = {
  'In Process': 'cs-badge-warning',
  Completed: 'cs-badge-success',
  Cancelled: 'cs-badge-muted',
};

/** Payment status carries its own scale — Paid is good, unpaid/delayed is what an agent chases. */
const PAY_BADGE: Record<string, string> = {
  Paid: 'cs-badge-success',
  Pending: 'cs-badge-warning',
  'Not Paid': 'cs-badge-danger',
  Delay: 'cs-badge-orange',
  'N/A': 'cs-badge-muted',
};

const TRUCK_PATH =
  'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0';
const PIN_PATH =
  'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z';
const USER_PATH =
  'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';

const dash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

export const MaintenanceCard = memo(function MaintenanceCard({
  row,
  onOpen,
}: {
  row: MaintenanceRecord;
  onOpen: (row: MaintenanceRecord) => void;
}) {
  const status = row.status ?? '';
  const payStatus = row.paymentStatus ?? '';
  // The Account lookup and the case's own name are usually the same company spelled differently.
  // Show the second line only when it actually says something new.
  const title = maintenanceTitle(row);
  const subName =
    row.name && row.name.trim().toLowerCase() !== title.trim().toLowerCase() ? row.name : '';

  return (
    <button
      type="button"
      className="cs-mt-card"
      onClick={() => onOpen(row)}
      aria-label={`Open maintenance case for ${title}`}
    >
      <div className="cs-mt-card-head">
        <div className="cs-mt-card-titles">
          <div className="cs-mt-card-company" title={title}>
            {title}
          </div>
          {subName ? <div className="cs-mt-card-subname">{subName}</div> : null}
        </div>
        <span className={`cs-badge ${STATUS_BADGE[status] ?? 'cs-badge-muted'}`}>
          {status || '—'}
        </span>
      </div>

      <div className="cs-mt-card-type">
        {row.caseType ? <span className="cs-mt-chip-type">{row.caseType}</span> : null}
        {row.source === 'mytrion' ? (
          <span className="cs-mt-chip-new" title="Created in Mytrion">
            New
          </span>
        ) : null}
      </div>

      {/* The three search keys, mono so they read as identifiers rather than prose. */}
      <div className="cs-mt-card-ids">
        <span className="cs-mt-id" title="Carrier ID">
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TRUCK_PATH} />
          </svg>
          {dash(row.carrierId)}
        </span>
        <span className="cs-mt-id" title="Unit number">
          Unit {dash(row.unitNumber)}
        </span>
      </div>

      <div className="cs-mt-card-meta">
        <div className="cs-mt-meta-row">
          <span className="cs-mt-meta-label">Date</span>
          <span className="cs-mt-meta-value">{fmtYmd(row.caseDate) || '—'}</span>
        </div>
        <div className="cs-mt-meta-row">
          <span className="cs-mt-meta-label">Completed</span>
          <span className={`cs-mt-meta-value${row.caseCompletion ? '' : ' is-open'}`}>
            {row.caseCompletion ? fmtYmd(row.caseCompletion) : 'Not signed off'}
          </span>
        </div>
        {row.shopNumber ? (
          <div className="cs-mt-meta-row">
            <span className="cs-mt-meta-label">
              <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={PIN_PATH} />
              </svg>
              Shop
            </span>
            <span className="cs-mt-meta-value">{row.shopNumber}</span>
          </div>
        ) : null}
      </div>

      <div className="cs-mt-card-foot">
        <div className="cs-mt-amount-wrap">
          <span className="cs-mt-amount">{fmtMoneyStr(row.totalAmount)}</span>
          {payStatus ? (
            <span className={`cs-badge cs-badge-sm ${PAY_BADGE[payStatus] ?? 'cs-badge-muted'}`}>
              {payStatus}
            </span>
          ) : null}
        </div>
        <span className="cs-mt-owner" title={row.ownerName ?? 'Unassigned'}>
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={USER_PATH} />
          </svg>
          {row.ownerName || 'Unassigned'}
        </span>
      </div>
    </button>
  );
});
