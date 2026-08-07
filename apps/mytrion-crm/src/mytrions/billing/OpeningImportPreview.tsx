/**
 * The import preview table — extracted from OpeningBulkImport so neither file passes the 600-line cap.
 *
 * Presentational only: it renders the verdicts the SERVER produced and reports tab/page intent upward.
 * It deliberately owns no fetching, because the parent's phase machine is what guarantees a preview can
 * only be shown for a batch that actually exists.
 *
 * Two details that matter to an agent fixing a large file:
 *   • Every rejection reason is listed, not just the first — a row can fail two ways at once, and
 *     surfacing them one at a time costs an upload cycle per fault.
 *   • The row number is the SPREADSHEET row, so "fix row 47" means row 47 in their file.
 */
import type { LedgerImportPreviewResponse, LedgerImportPreviewRow, LedgerImportSummary } from '../../api/ledgerTypes';
import { downloadRejectedRows } from '../../api/billing';
import { fmtMoney, formatYmd } from './ledgerModel';

const P_DOWNLOAD = 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3';

export type RowTab = 'accept' | 'reject' | 'changed' | 'unchanged';

export function OpeningImportPreview({
  batch,
  summary,
  tab,
  rows,
  rowsTotal,
  rowsLoading,
  page,
  pageCount,
  onTab,
  onPage,
}: {
  batch: LedgerImportPreviewResponse;
  summary: LedgerImportSummary;
  tab: RowTab;
  rows: LedgerImportPreviewRow[];
  rowsTotal: number;
  rowsLoading: boolean;
  page: number;
  pageCount: number;
  onTab: (t: RowTab) => void;
  onPage: (p: number) => void;
}) {
  const tabCounts: Record<RowTab, number> = {
    accept: summary.accepted,
    reject: summary.rejected,
    changed: summary.changed,
    unchanged: summary.unchanged,
  };

  return (
        <div className="lg-import-step">
          <div className="lg-step-num">3</div>
          <div className="lg-step-body">
            <div className="lg-step-title">Review before applying</div>

            {batch.fileErrors.length ? (
              <div className="bm-notice bm-notice--error" role="alert">
                <div className="bm-notice-title">This file cannot be applied</div>
                {batch.fileErrors.map((m) => (
                  <div className="bm-notice-msg" key={m}>
                    {m}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="lg-summary-strip">
              <span className="lg-sum-ok">{summary.accepted} to apply</span>
              <span className="lg-sum-sep">·</span>
              <span className={summary.rejected ? 'lg-sum-bad' : undefined}>{summary.rejected} rejected</span>
              <span className="lg-sum-sep">·</span>
              <span className={summary.changed ? 'lg-sum-warn' : undefined}>{summary.changed} will overwrite</span>
              <span className="lg-sum-sep">·</span>
              <span>{summary.new} new</span>
              <span className="lg-sum-sep">·</span>
              <span className="lg-sum-muted">{summary.unchanged} skipped</span>
            </div>

            <div className="lg-tabs">
              {(['accept', 'reject', 'changed', 'unchanged'] as RowTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`lg-tab${tab === t ? ' lg-tab-active' : ''}`}
                  disabled={tabCounts[t] === 0}
                  onClick={() => onTab(t)}
                >
                  {t === 'accept'
                    ? 'To apply'
                    : t === 'reject'
                      ? 'Rejected'
                      : t === 'changed'
                        ? 'Overwrites'
                        : 'Skipped'}{' '}
                  ({tabCounts[t]})
                </button>
              ))}
              {summary.rejected > 0 ? (
                <button
                  type="button"
                  className="lg-filter-clear"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => void downloadRejectedRows(batch.batchId)}
                  title="An annotated workbook with a Reason column — fix it and re-upload"
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_DOWNLOAD} />
                  </svg>
                  Download rejected rows
                </button>
              ) : null}
            </div>

            <div className="lg-preview-wrap">
              <table className="lg-preview-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Carrier</th>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Section</th>
                    <th>As of</th>
                    <th className="lg-th-num">Amount</th>
                    <th className="lg-th-num">Change</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsLoading ? (
                    Array.from({ length: 6 }, (_, i) => (
                      <tr key={`rskel-${i}`} aria-hidden>
                        {Array.from({ length: 9 }, (__, c) => (
                          <td key={c}>
                            <div className="bm-skeleton" style={{ height: 10, width: c === 2 ? 120 : 52 }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="lg-td-empty">
                        No rows in this group.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={`${r.rowNumber}-${r.carrierId}-${r.section}`}
                        className={
                          r.verdict === 'reject'
                            ? 'lg-row--rejected'
                            : r.changeKind === 'changed'
                              ? 'lg-row--changed'
                              : undefined
                        }
                      >
                        <td>{r.rowNumber}</td>
                        <td>{r.carrierId}</td>
                        <td>{r.companyName || '—'}</td>
                        <td>{r.clientType || '—'}</td>
                        <td>{r.section || '—'}</td>
                        <td>{r.asOfDate ? formatYmd(r.asOfDate) : '—'}</td>
                        <td className="lg-td-num">{fmtMoney(r.amount)}</td>
                        <td className="lg-td-num">
                          {r.previousAmount !== null ? (
                            <span className="lg-cell-delta">
                              {fmtMoney(r.previousAmount)} <span aria-hidden>→</span> {fmtMoney(r.amount)}
                            </span>
                          ) : (
                            <span className="db-money-muted">new</span>
                          )}
                        </td>
                        <td>
                          {r.verdict === 'reject' ? (
                            <>
                              <span className="lg-pill-bad">Rejected</span>
                              <div className="lg-row-reasons">
                                {r.reasons.map((why) => (
                                  <div key={why}>{why}</div>
                                ))}
                              </div>
                            </>
                          ) : r.verdict === 'unchanged' ? (
                            <>
                              <span className="lg-pill-muted">Skipped</span>
                              {r.reasons.length ? (
                                <div className="lg-row-reasons">{r.reasons[0]}</div>
                              ) : null}
                            </>
                          ) : r.changeKind === 'changed' ? (
                            <span className="lg-pill-warn">Overwrite</span>
                          ) : (
                            <span className="lg-pill-ok">New</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {pageCount > 1 ? (
              <div className="db-pagination">
                <span className="db-page-info">
                  Page {page} of {pageCount} · {rowsTotal} rows
                </span>
                <div className="db-page-actions">
                  <button
                    className="db-page-btn"
                    disabled={page <= 1 || rowsLoading}
                    onClick={() => onPage(page - 1)}
                  >
                    Prev
                  </button>
                  <button
                    className="db-page-btn"
                    disabled={page >= pageCount || rowsLoading}
                    onClick={() => onPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
  );
}
