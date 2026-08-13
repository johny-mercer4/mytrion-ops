/**
 * Opening Balances — the launch-migration surface (TZ §5, §10.2).
 *
 * Every sub-ledger computes `Closing = Opening + Debit − Credit` cumulatively from its opening-balance
 * date, so until an opening balance exists for a carrier its Closing is unknowable. Moving those
 * accumulated balances out of CMP by hand is what this screen is for.
 *
 * Shows what is already recorded, how much of the migration is outstanding (the coverage KPIs), and
 * the two ways in: manual single-carrier entry by carrier ID, and the Excel bulk path.
 *
 * Read-only billing grants see the table and the coverage; they do not see the write controls
 * (`canWriteMytrion`). The backend re-enforces this — the UI hide is not the boundary.
 */
import { useMemo, useState } from 'react';

import {
  downloadOpeningExport,
  fetchOpeningBalances,
  fetchOpeningCoverage,
  revertOpeningBalance,
} from '../../api/billing';
import type { LedgerSectionId, OpeningBalanceWire } from '../../api/ledgerTypes';
import { useLoad } from '../_shared/useLoad';
import { OpeningBulkImport } from './OpeningBulkImport';
import { OpeningManualModal } from './OpeningManualModal';
import {
  errMsg,
  fmtMoney,
  formatStamp,
  formatYmd,
  groupOpeningsByCarrier,
  type CarrierOpeningsRow,
} from './ledgerModel';

const P_SEARCH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const P_CLOSE = 'M6 18L18 6M6 6l12 12';
const P_REFRESH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const P_PLUS = 'M12 4v16m8-8H4';
const P_DOWNLOAD = 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3';
const P_SHEET =
  'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
const P_ERROR = 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

const PAGE_SIZE = 100;
const TOAST_MS = 3500;

type ToastKind = 'success' | 'error';

/** Column order for the per-carrier amount cells — LOC sections first, then Prepay. */
const SECTION_COLUMNS: { id: LedgerSectionId; label: string }[] = [
  { id: 'cb-loc', label: 'CB (LOC)' },
  { id: 'unbilled', label: 'Unbilled' },
  { id: 'ar', label: 'AR' },
  { id: 'cb-prepay', label: 'CB (Prepay)' },
  { id: 'untopped', label: 'Un Top-Upped' },
];

export function OpeningBalances({ canWrite }: { canWrite: boolean }) {
  const [search, setSearch] = useState('');
  const [manualCarrier, setManualCarrier] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [historyFor, setHistoryFor] = useState<CarrierOpeningsRow | null>(null);
  const [toast, setToast] = useState<{ id: number; kind: ToastKind; message: string } | null>(null);

  // The saved book is small (one row per carrier per section) — load it whole and filter locally,
  // matching how Prepay and Returns handle their lists.
  const load = useLoad(() => fetchOpeningBalances(1, PAGE_SIZE * 5), []);
  const coverage = useLoad(() => fetchOpeningCoverage(), []);

  const rows = useMemo(() => groupOpeningsByCarrier(load.data?.rows ?? []), [load.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.carrierId.toLowerCase().includes(q) || r.companyName.toLowerCase().includes(q),
    );
  }, [rows, search]);

  function notify(kind: ToastKind, message: string): void {
    setToast({ id: Date.now(), kind, message });
    setTimeout(() => setToast(null), TOAST_MS);
  }

  async function onRevert(revisionId: string): Promise<void> {
    try {
      await revertOpeningBalance(revisionId);
      notify('success', 'Reverted — a new revision was written with the previous values.');
      await load.reload();
      await coverage.reload();
    } catch (e) {
      notify('error', errMsg(e, 'Revert failed.'));
    }
  }

  const initialLoading = load.loading && rows.length === 0;

  return (
    <>
      {/* ── Coverage: how much of the migration is still outstanding ── */}
      <div className="db-kpi-grid">
        {coverage.data
          ? coverage.data.sections.map((s) => (
              <div className="db-kpi-card" key={s.section}>
                <div className="db-kpi-title">{s.label}</div>
                <div className={`db-kpi-value${s.missing > 0 ? ' text-warning' : ''}`}>
                  {s.recorded}
                  <span className="lg-kpi-of"> / {s.eligible}</span>
                </div>
                <div className="lg-kpi-sub">
                  {s.missing > 0 ? `${s.missing} still to enter` : 'complete'}
                </div>
              </div>
            ))
          : Array.from({ length: 5 }, (_, i) => (
              <div className="db-kpi-card" key={`cov-skel-${i}`} aria-hidden>
                <div className="bm-skeleton" style={{ height: 11, width: 90 }} />
                <div className="bm-skeleton" style={{ height: 20, width: 60, marginTop: 8 }} />
              </div>
            ))}
      </div>

      {coverage.data && coverage.data.excluded.wexFunded + coverage.data.excluded.noType > 0 ? (
        // An excluded carrier simply isn't in the list, which is indistinguishable from a data bug
        // unless we say so.
        <div className="lg-exclusion-note">
          {coverage.data.excluded.wexFunded} WEX-Funded and {coverage.data.excluded.noType} untyped
          carriers are outside the ledger.
        </div>
      ) : null}

      {/* ── Toolbar ── */}
      <div className="lg-toolbar">
        <div className="db-search-wrap">
          <svg className="db-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_SEARCH} />
          </svg>
          <input
            type="text"
            className="db-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Carrier ID or Company..."
            aria-label="Search Carrier ID or Company"
          />
          {search ? (
            <button className="db-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
              </svg>
            </button>
          ) : null}
        </div>

        {canWrite ? (
          <>
            <button className="bm-btn bm-btn-primary" onClick={() => setManualCarrier('')}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_PLUS} />
              </svg>
              Enter by Carrier ID
            </button>
            <button className="bm-btn bm-btn-ghost" onClick={() => setBulkOpen(true)}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_SHEET} />
              </svg>
              Bulk from Excel
            </button>
          </>
        ) : null}

        {/* Export is a READ — read-only grants get it too. */}
        <button
          className="bm-refresh-btn db-export-btn"
          disabled={exporting || rows.length === 0}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadOpeningExport();
            } catch (e) {
              notify('error', errMsg(e, 'Export failed.'));
            } finally {
              setExporting(false);
            }
          }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_DOWNLOAD} />
          </svg>
          {exporting ? 'Exporting…' : 'Export'}
        </button>

        <button className="bm-refresh-btn" onClick={() => void load.refresh()} disabled={load.loading}>
          <svg
            className={load.loading ? 'spin-icon' : undefined}
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_REFRESH} />
          </svg>
          Refresh
        </button>
      </div>

      {!canWrite ? (
        <div className="lg-readonly-banner" role="status">
          Your Billing access is read-only — you can review opening balances but not enter or change
          them.
        </div>
      ) : null}

      {/* ── Table ── */}
      {initialLoading ? (
        <div className="db-content-area" aria-busy="true" aria-label="Loading opening balances">
          <div className="db-list-header lg-openings-header">
            <div className="db-col-carrier">Carrier</div>
            <div className="db-col-company">Company</div>
            {SECTION_COLUMNS.map((c) => (
              <div className="lg-col-amt" key={c.id}>
                {c.label}
              </div>
            ))}
            <div className="lg-col-meta">Updated</div>
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <div className="db-row-item" key={`skel-${i}`} aria-hidden>
              <div className="db-row-main lg-openings-row" style={{ pointerEvents: 'none' }}>
                <div className="db-col-carrier">
                  <div className="bm-skeleton" style={{ height: 11, width: 62 }} />
                </div>
                <div className="db-col-company">
                  <div className="bm-skeleton" style={{ height: 11, width: 150 }} />
                </div>
                {SECTION_COLUMNS.map((c) => (
                  <div className="lg-col-amt" key={c.id}>
                    <div className="bm-skeleton" style={{ height: 11, width: 54, marginLeft: 'auto' }} />
                  </div>
                ))}
                <div className="lg-col-meta">
                  <div className="bm-skeleton" style={{ height: 11, width: 90 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : load.error && rows.length === 0 ? (
        <div className="db-error-state">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={P_ERROR} />
          </svg>
          <div className="db-error-msg">{load.error}</div>
          <button className="bm-refresh-btn" onClick={() => void load.reload()}>
            Try Again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="db-empty-state">
          {rows.length === 0
            ? 'No opening balances recorded yet. Enter one by Carrier ID, or use the Excel template for a bulk load.'
            : 'No carriers match your search.'}
        </div>
      ) : (
        <div className="db-content-area">
          <div className="db-list-header lg-openings-header">
            <div className="db-col-carrier">Carrier</div>
            <div className="db-col-company">Company</div>
            {SECTION_COLUMNS.map((c) => (
              <div className="lg-col-amt" key={c.id}>
                {c.label}
              </div>
            ))}
            <div className="lg-col-meta">Updated</div>
          </div>

          {filtered.map((row) => (
            <div className="db-row-item" key={row.carrierId}>
              <div
                className="db-row-main lg-openings-row"
                role={canWrite ? 'button' : undefined}
                tabIndex={canWrite ? 0 : undefined}
                onClick={canWrite ? () => setManualCarrier(row.carrierId) : undefined}
                onKeyDown={
                  canWrite
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setManualCarrier(row.carrierId);
                        }
                      }
                    : undefined
                }
                title={canWrite ? 'Edit this carrier’s opening balances' : undefined}
              >
                <div className="db-col-carrier">
                  <span className="db-carrier-id">{row.carrierId}</span>
                </div>
                <div className="db-col-company">
                  <span className="db-company-name">{row.companyName || '—'}</span>
                  {row.clientType ? (
                    <span className={`lg-type-pill lg-type-${row.clientType.toLowerCase()}`}>
                      {row.clientType}
                    </span>
                  ) : null}
                </div>
                {SECTION_COLUMNS.map((c) => {
                  const cell = row.amounts[c.id];
                  return (
                    <div className="lg-col-amt" key={c.id}>
                      {cell ? (
                        <>
                          <span className="lg-amt-static">{fmtMoney(cell.amount)}</span>
                          <span className="lg-amt-asof">as of {formatYmd(cell.asOfDate)}</span>
                        </>
                      ) : (
                        <span className="db-money-muted">—</span>
                      )}
                    </div>
                  );
                })}
                <div className="lg-col-meta">
                  <span className="lg-meta-when">{formatStamp(row.updatedAt)}</span>
                  {row.updatedBy ? <span className="lg-meta-who">{row.updatedBy}</span> : null}
                </div>
              </div>
              <button
                type="button"
                className="lg-row-history"
                onClick={() => setHistoryFor(row)}
                title="Revision history"
              >
                History
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="lg-list-caption">
        {filtered.length} of {rows.length} carrier{rows.length === 1 ? '' : 's'} with a recorded opening
        balance. Amounts are the live revision; every change keeps its predecessor.
      </div>

      {manualCarrier !== null ? (
        <OpeningManualModal
          key={manualCarrier || 'new'}
          initialCarrierId={manualCarrier}
          onClose={() => setManualCarrier(null)}
          onSaved={(message) => {
            notify('success', message);
            void load.reload();
            void coverage.reload();
          }}
        />
      ) : null}

      {bulkOpen ? (
        <OpeningBulkImport
          onClose={() => setBulkOpen(false)}
          onCommitted={(message) => {
            notify('success', message);
            void load.reload();
            void coverage.reload();
          }}
        />
      ) : null}

      {historyFor ? (
        <OpeningHistoryModal
          key={historyFor.carrierId}
          row={historyFor}
          canWrite={canWrite}
          onRevert={onRevert}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}

      {toast ? (
        <div className={`bm-toast bm-toast--${toast.kind}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </>
  );
}

/**
 * The revision chain for one carrier. This is the answer to "who changed 12,400 to 12,000, when, and
 * from which spreadsheet" — the first question asked when a downstream number looks wrong.
 */
function OpeningHistoryModal({
  row,
  canWrite,
  onRevert,
  onClose,
}: {
  row: CarrierOpeningsRow;
  canWrite: boolean;
  onRevert: (revisionId: string) => Promise<void>;
  onClose: () => void;
}) {
  const load = useLoad(
    () => import('../../api/billing').then((m) => m.fetchOpeningHistory(row.carrierId)),
    [row.carrierId],
  );
  const [busy, setBusy] = useState<string | null>(null);

  const revisions: OpeningBalanceWire[] = load.data?.revisions ?? [];

  return (
    <div
      className="bm-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bm-modal-box" style={{ maxWidth: 820 }}>
        <div className="bm-modal-header">
          <div>
            <h3 className="bm-modal-title">Revision history</h3>
            <div className="bm-modal-sub">
              {row.companyName || row.carrierId} · #{row.carrierId}
            </div>
          </div>
          <button className="bm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="bm-modal-body">
          {load.loading && revisions.length === 0 ? (
            <div className="bm-initial-loader">
              <div className="bm-loader-ring" />
              <div className="bm-loader-text">Loading history…</div>
            </div>
          ) : load.error ? (
            <div className="db-error-msg">{load.error}</div>
          ) : revisions.length === 0 ? (
            <div className="db-empty-state">No revisions.</div>
          ) : (
            <div className="lg-preview-wrap">
              <table className="lg-preview-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Rev</th>
                    <th>As of</th>
                    <th className="lg-th-num">Amount</th>
                    <th>By</th>
                    <th>When</th>
                    <th>Source</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((r) => (
                    <tr key={r.id} className={r.supersededAt ? 'lg-row--superseded' : undefined}>
                      <td>{r.section}</td>
                      <td>{r.revision}</td>
                      <td>{formatYmd(r.asOfDate)}</td>
                      <td className="lg-td-num">{fmtMoney(r.amount)}</td>
                      <td>{r.createdByName ?? '—'}</td>
                      <td>{formatStamp(r.createdAt)}</td>
                      <td>
                        {r.source}
                        {r.importBatchId ? <span className="lg-batch-tag">batch</span> : null}
                      </td>
                      <td>
                        {r.supersededAt ? (
                          canWrite ? (
                            <button
                              type="button"
                              className="lg-revert-btn"
                              disabled={busy !== null}
                              onClick={async () => {
                                setBusy(r.id);
                                await onRevert(r.id);
                                setBusy(null);
                                onClose();
                              }}
                            >
                              {busy === r.id ? 'Reverting…' : 'Restore'}
                            </button>
                          ) : null
                        ) : (
                          <span className="lg-live-tag">live</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="lg-modal-note">
            Restoring writes a <strong>new</strong> revision carrying the old values — it never deletes
            history, so the rollback is itself auditable.
          </p>
        </div>
      </div>
    </div>
  );
}
