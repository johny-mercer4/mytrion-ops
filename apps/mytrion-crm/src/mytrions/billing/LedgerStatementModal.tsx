/**
 * The drill-down statement — a carrier's operations for one section over the period, as a bank
 * statement with a running balance (TZ: "clicking a sum opens the operations history").
 *
 * THE RUNNING BALANCE COMES FROM THE SERVER. It is not derived here, and that is load-bearing: if this
 * component summed the lines itself, any line the server excluded from the aggregate would silently
 * shift the whole column, and the last row would disagree with the Closing on the section table. Both
 * numbers would look plausible. So the column is rendered, not computed, and the footer asserts
 * `last.running === closing`.
 *
 * The clicked column is tinted in the header — in the source prototype all four amount cells opened an
 * identical statement with no indication of which one was clicked, which reads as a bug.
 *
 * A real `<table>` here rather than the flex rows the section list uses: this is dense, fixed-column,
 * wants a sticky header and a footer, and scrolls horizontally on a narrow screen.
 */
import { useEffect } from 'react';

import { fetchLedgerStatement } from '../../api/billing';
import type { LedgerSectionId } from '../../api/ledgerTypes';
import { useLoad } from '../_shared/useLoad';
import { fmtMoney, formatYmdShort, formatYmd, toWireRange, type LedgerRange } from './ledgerModel';
import type { AmountColumn } from './LedgerTable';

export function LedgerStatementModal({
  carrierId,
  companyName,
  section,
  sectionLabel,
  column,
  range,
  onClose,
}: {
  carrierId: string;
  companyName: string;
  section: LedgerSectionId;
  sectionLabel: string;
  column: AmountColumn;
  range: LedgerRange;
  onClose: () => void;
}) {
  const wire = toWireRange(range);
  const load = useLoad(
    () => fetchLedgerStatement({ carrierId, section, ...wire }),
    [carrierId, section, wire.startDate, wire.endDate],
  );

  /** Esc closes — this modal is opened and dismissed dozens of times in a review session. */
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = load.data;
  const lines = d?.lines ?? [];
  const lastRunning = lines.length ? lines[lines.length - 1]!.running : d?.opening ?? null;
  const mismatch =
    d && d.closing !== null && lastRunning !== null
      ? Math.round((lastRunning - d.closing) * 100) / 100
      : 0;

  return (
    <div
      className="bm-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bm-modal-box" style={{ maxWidth: 1080 }}>
        <div className="bm-modal-header">
          <div>
            <h3 className="bm-modal-title">{companyName || carrierId}</h3>
            <div className="bm-modal-sub">
              {sectionLabel} · #{carrierId} · {formatYmd(range.from)} – {formatYmd(range.to)}
            </div>
          </div>
          <button className="bm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="bm-modal-body">
          {load.loading && !d ? (
            <div className="bm-initial-loader">
              <div className="bm-loader-ring" />
              <div className="bm-loader-text">Building the statement…</div>
            </div>
          ) : load.error && !d ? (
            <div className="db-error-msg">{load.error}</div>
          ) : d ? (
            <>
              {/* Header figures — the same numbers as the row that was clicked, from the same compute. */}
              <div className="lg-stmt-summary">
                <div className={`lg-stmt-fig${column === 'opening' ? ' lg-stmt-fig--active' : ''}`}>
                  <span className="lg-stmt-fig-label">Opening</span>
                  <span className="lg-stmt-fig-value">{fmtMoney(d.opening)}</span>
                  {d.openingAsOf ? (
                    <span className="lg-stmt-fig-sub">
                      {d.openingSource === 'rolled-forward' ? 'carried from ' : 'as of '}
                      {formatYmdShort(d.openingAsOf)}
                    </span>
                  ) : (
                    <span className="lg-stmt-fig-sub">not recorded</span>
                  )}
                </div>
                <div className={`lg-stmt-fig${column === 'debit' ? ' lg-stmt-fig--active' : ''}`}>
                  <span className="lg-stmt-fig-label">Debit</span>
                  <span className="lg-stmt-fig-value">{fmtMoney(d.debit)}</span>
                </div>
                <div className={`lg-stmt-fig${column === 'credit' ? ' lg-stmt-fig--active' : ''}`}>
                  <span className="lg-stmt-fig-label">Credit</span>
                  <span className="lg-stmt-fig-value">{fmtMoney(d.credit)}</span>
                </div>
                <div className={`lg-stmt-fig${column === 'closing' ? ' lg-stmt-fig--active' : ''}`}>
                  <span className="lg-stmt-fig-label">Closing</span>
                  <span className="lg-stmt-fig-value lg-stmt-fig-strong">{fmtMoney(d.closing)}</span>
                </div>
              </div>

              {d.warnings.length ? (
                <div className="bm-notice bm-notice--duplicate" role="status">
                  {d.warnings.map((w) => (
                    <div className="bm-notice-msg" key={w}>
                      {w}
                    </div>
                  ))}
                </div>
              ) : null}

              {Math.abs(mismatch) > 0.005 ? (
                <div className="bm-notice bm-notice--error" role="alert">
                  <div className="bm-notice-msg">
                    The last running balance ({fmtMoney(lastRunning)}) does not match the closing balance
                    ({fmtMoney(d.closing)}) — a difference of {fmtMoney(mismatch)}. Do not rely on these
                    figures; report it.
                  </div>
                </div>
              ) : null}

              <div className="lg-preview-wrap">
                <table className="lg-stmt-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className={`lg-th-num${column === 'debit' ? ' lg-th-active' : ''}`}>Debit</th>
                      <th className={`lg-th-num${column === 'credit' ? ' lg-th-active' : ''}`}>Credit</th>
                      <th className="lg-th-num lg-th-running">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="lg-stmt-bookend">
                      <td>{formatYmdShort(d.period.startDate)}</td>
                      <td>Opening balance</td>
                      <td className="lg-td-num" />
                      <td className="lg-td-num" />
                      <td className="lg-td-num lg-stmt-running">{fmtMoney(d.opening)}</td>
                    </tr>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="lg-td-empty">
                          No activity in this period.
                        </td>
                      </tr>
                    ) : (
                      lines.map((l) => (
                        <tr key={l.id}>
                          <td>{formatYmdShort(l.date)}</td>
                          <td className="lg-stmt-desc">{l.description}</td>
                          <td className="lg-td-num">{l.debit !== null ? fmtMoney(l.debit) : ''}</td>
                          <td className="lg-td-num">{l.credit !== null ? fmtMoney(l.credit) : ''}</td>
                          <td className="lg-td-num lg-stmt-running">{fmtMoney(l.running)}</td>
                        </tr>
                      ))
                    )}
                    <tr className="lg-stmt-bookend">
                      <td>{formatYmdShort(d.period.endDate)}</td>
                      <td>Closing balance</td>
                      <td className="lg-td-num">{fmtMoney(d.debit)}</td>
                      <td className="lg-td-num">{fmtMoney(d.credit)}</td>
                      <td className="lg-td-num lg-stmt-running">{fmtMoney(d.closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="lg-modal-note">
                {lines.length} line{lines.length === 1 ? '' : 's'}
                {d.truncated ? ' (capped — the totals above still cover the whole period)' : ''}. The
                balance column is computed server-side from the same figures as the section table.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
