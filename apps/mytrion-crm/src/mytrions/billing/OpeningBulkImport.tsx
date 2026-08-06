/**
 * Bulk opening-balance import — download a template, fill it, upload, review, commit.
 *
 * The review step is the point of the whole flow: an opening balance restates every downstream day for
 * that carrier, so nothing is written until an agent has seen exactly what would change. The upload
 * only VALIDATES; commit then replays the stored verdicts by `batchId`. The rows are never sent back —
 * doing so would let a client write values the validator never saw.
 *
 * Phases are a discriminated union so an impossible state (e.g. a preview with no batch) cannot be
 * represented. Parsing is server-side: this frontend has no xlsx reader and adding one for a single
 * screen would be the wrong trade.
 */
import { useMemo, useRef, useState } from 'react';

import {
  commitOpeningImport,
  discardOpeningImport,
  downloadOpeningTemplate,
  downloadRejectedRows,
  fetchOpeningImportRows,
  previewOpeningImport,
} from '../../api/billing';
import type {
  LedgerImportPreviewResponse,
  LedgerImportPreviewRow,
  LedgerImportSummary,
  LedgerSectionId,
} from '../../api/ledgerTypes';
import { errMsg, fmtMoney, formatYmd } from './ledgerModel';

const P_UPLOAD = 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12';
const P_DOWNLOAD = 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3';
const P_CLOSE = 'M6 18L18 6M6 6l12 12';

const ACCEPT = '.xlsx';
/** Pre-reject client-side at the server's own cap so an oversized file costs no upload. */
const MAX_BYTES = 10_000_000;
const ROWS_PER_PAGE = 50;

const SECTION_LABELS: Record<LedgerSectionId, string> = {
  'cb-loc': 'Customer Balance (LOC)',
  unbilled: 'Unbilled Transactions',
  ar: 'Accounts Receivable',
  'cb-prepay': 'Customer Balance (Prepay)',
  untopped: 'Un Top-Upped Payments',
};

type Phase =
  | { k: 'idle' }
  | { k: 'picked'; file: File }
  | { k: 'validating'; file: File }
  | { k: 'preview'; batch: LedgerImportPreviewResponse }
  | { k: 'confirm'; batch: LedgerImportPreviewResponse }
  | { k: 'committing'; batch: LedgerImportPreviewResponse }
  | { k: 'done'; committed: number; skipped: number }
  | { k: 'error'; message: string; batch?: LedgerImportPreviewResponse };

type RowTab = 'accept' | 'reject' | 'changed' | 'unchanged';

export function OpeningBulkImport({
  onClose,
  onCommitted,
}: {
  onClose: () => void;
  onCommitted: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [section, setSection] = useState<LedgerSectionId>('cb-loc');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<RowTab>('accept');
  const [rows, setRows] = useState<LedgerImportPreviewRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsLoading, setRowsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const batch = 'batch' in phase ? phase.batch : undefined;
  const summary: LedgerImportSummary | undefined = batch?.summary;
  const busy = phase.k === 'validating' || phase.k === 'committing';

  async function loadRows(batchId: string, which: RowTab, pageNum: number): Promise<void> {
    setRowsLoading(true);
    try {
      const filters =
        which === 'changed'
          ? { verdict: 'accept' as const, changeKind: 'changed' as const }
          : which === 'unchanged'
            ? { verdict: 'unchanged' as const }
            : { verdict: which };
      const res = await fetchOpeningImportRows(batchId, pageNum, ROWS_PER_PAGE, filters);
      setRows(res.rows);
      setRowsTotal(res.total);
    } catch (e) {
      setPhase({ k: 'error', message: errMsg(e, 'Could not load the preview rows.'), ...(batch ? { batch } : {}) });
    } finally {
      setRowsLoading(false);
    }
  }

  function pick(file: File | undefined): void {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setPhase({ k: 'error', message: `${file.name} is not an .xlsx file. Use the downloaded template.` });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase({
        k: 'error',
        message: `${file.name} is ${(file.size / 1_000_000).toFixed(1)} MB — the limit is ${MAX_BYTES / 1_000_000} MB.`,
      });
      return;
    }
    setPhase({ k: 'picked', file });
  }

  async function validate(file: File): Promise<void> {
    setPhase({ k: 'validating', file });
    try {
      const res = await previewOpeningImport(file);
      setPhase({ k: 'preview', batch: res });
      const firstTab: RowTab = res.summary.accepted > 0 ? 'accept' : res.summary.rejected > 0 ? 'reject' : 'unchanged';
      setTab(firstTab);
      setPage(1);
      await loadRows(res.batchId, firstTab, 1);
    } catch (e) {
      setPhase({ k: 'error', message: errMsg(e, 'That file could not be validated.') });
    }
  }

  async function commit(): Promise<void> {
    if (!batch) return;
    setPhase({ k: 'committing', batch });
    try {
      // The server requires an explicit acknowledgement whenever existing balances would be replaced.
      const res = await commitOpeningImport(batch.batchId, batch.summary.changed > 0);
      setPhase({ k: 'done', committed: res.committed, skipped: res.skipped });
      onCommitted(
        `Applied ${res.committed} opening balance${res.committed === 1 ? '' : 's'} from ${batch.fileName}.`,
      );
    } catch (e) {
      setPhase({ k: 'error', message: errMsg(e, 'Commit failed.'), batch });
    }
  }

  async function discard(): Promise<void> {
    if (batch) {
      // Best-effort: a failed discard just leaves a pending batch that expires on its own.
      try {
        await discardOpeningImport(batch.batchId);
      } catch {
        /* ignore */
      }
    }
    onClose();
  }

  const tabCounts: Record<RowTab, number> = {
    accept: summary?.accepted ?? 0,
    reject: summary?.rejected ?? 0,
    changed: summary?.changed ?? 0,
    unchanged: summary?.unchanged ?? 0,
  };

  const canCommit = (summary?.accepted ?? 0) > 0 && (batch?.fileErrors.length ?? 0) === 0;

  const pageCount = useMemo(() => Math.max(1, Math.ceil(rowsTotal / ROWS_PER_PAGE)), [rowsTotal]);

  return (
    <div
      className="bm-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bm-modal-box" style={{ maxWidth: 1180 }}>
        <div className="bm-modal-header">
          <div>
            <h3 className="bm-modal-title">Bulk opening balances</h3>
            <div className="bm-modal-sub">
              Download the template → fill in the amounts → upload → review → apply
            </div>
          </div>
          <button
            className="bm-modal-close"
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="bm-modal-body">
          {/* ── Step 1: template ── */}
          <div className="lg-import-step">
            <div className="lg-step-num">1</div>
            <div className="lg-step-body">
              <div className="lg-step-title">Get the template</div>
              <div className="lg-step-hint">
                Pre-filled with the carriers that still need a balance for the section you pick, plus their
                current value where one exists. Carrier ID, company and section are locked — only the
                amount, as-of date and note are editable.
              </div>
              <div className="lg-step-controls">
                <select
                  className="bm-select"
                  value={section}
                  onChange={(e) => setSection(e.target.value as LedgerSectionId)}
                  disabled={templateBusy}
                  aria-label="Section"
                >
                  {(Object.keys(SECTION_LABELS) as LedgerSectionId[]).map((s) => (
                    <option key={s} value={s}>
                      {SECTION_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="bm-btn bm-btn-ghost"
                  disabled={templateBusy}
                  onClick={async () => {
                    setTemplateBusy(true);
                    try {
                      await downloadOpeningTemplate(section, 'missing');
                    } catch (e) {
                      setPhase({ k: 'error', message: errMsg(e, 'Template download failed.') });
                    } finally {
                      setTemplateBusy(false);
                    }
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_DOWNLOAD} />
                  </svg>
                  {templateBusy ? 'Preparing…' : 'Download template'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Step 2: upload ── */}
          <div className="lg-import-step">
            <div className="lg-step-num">2</div>
            <div className="lg-step-body">
              <div className="lg-step-title">Upload the filled file</div>
              {phase.k === 'idle' || phase.k === 'picked' || phase.k === 'validating' || phase.k === 'error' ? (
                <>
                  <div
                    className={`lg-dropzone${dragging ? ' lg-dropzone--on' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      pick(e.dataTransfer.files?.[0]);
                    }}
                    onClick={() => inputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        inputRef.current?.click();
                      }
                    }}
                  >
                    <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={P_UPLOAD} />
                    </svg>
                    <div className="lg-drop-title">
                      {phase.k === 'picked' ? phase.file.name : 'Drop the .xlsx here, or click to choose'}
                    </div>
                    <div className="lg-drop-hint">
                      {phase.k === 'picked'
                        ? `${(phase.file.size / 1024).toFixed(0)} KB — ready to check`
                        : `.xlsx only · up to ${MAX_BYTES / 1_000_000} MB · nothing is saved until you apply`}
                    </div>
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    style={{ display: 'none' }}
                    onChange={(e) => pick(e.target.files?.[0])}
                  />
                  {phase.k === 'picked' ? (
                    <div className="lg-step-controls">
                      <button type="button" className="bm-btn bm-btn-primary" onClick={() => void validate(phase.file)}>
                        Check this file
                      </button>
                      <button type="button" className="bm-btn bm-btn-ghost" onClick={() => setPhase({ k: 'idle' })}>
                        Choose a different one
                      </button>
                    </div>
                  ) : null}
                  {/* One inline progress line — never a second panel-level loader. */}
                  {phase.k === 'validating' ? (
                    <div className="lg-progress" role="status">
                      Checking {phase.file.name} — no changes have been made yet…
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="lg-file-row">
                  <span className="lg-file-pill">{batch?.fileName}</span>
                  {batch?.resumed ? (
                    <span className="lg-override-tag" title="An identical file was already waiting for review">
                      resumed
                    </span>
                  ) : null}
                  {phase.k === 'preview' || phase.k === 'confirm' ? (
                    <button
                      type="button"
                      className="lg-filter-clear"
                      onClick={() => {
                        setPhase({ k: 'idle' });
                        setRows([]);
                      }}
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
                      </svg>
                      Start over
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* ── Step 3: review ── */}
          {batch && summary ? (
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
                      onClick={() => {
                        setTab(t);
                        setPage(1);
                        void loadRows(batch.batchId, t, 1);
                      }}
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
                        onClick={() => {
                          const p = page - 1;
                          setPage(p);
                          void loadRows(batch.batchId, tab, p);
                        }}
                      >
                        Prev
                      </button>
                      <button
                        className="db-page-btn"
                        disabled={page >= pageCount || rowsLoading}
                        onClick={() => {
                          const p = page + 1;
                          setPage(p);
                          void loadRows(batch.batchId, tab, p);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase.k === 'error' ? (
            <div className="bm-notice bm-notice--error" role="alert">
              <div className="bm-notice-msg">{phase.message}</div>
            </div>
          ) : null}

          {phase.k === 'done' ? (
            <div className="bm-notice bm-notice--ok" role="status">
              <div className="bm-notice-title">Applied</div>
              <div className="bm-notice-msg">
                {phase.committed} opening balance{phase.committed === 1 ? '' : 's'} written
                {phase.skipped ? `, ${phase.skipped} skipped` : ''}. Every previous value is kept in the
                revision history, and the whole batch can be reverted.
              </div>
            </div>
          ) : null}
        </div>

        <div className="bm-modal-footer">
          {phase.k === 'confirm' ? (
            <span className="lg-footer-note lg-sum-warn">
              {summary?.changed} existing balance{summary?.changed === 1 ? '' : 's'} will be replaced. The old
              values stay in the revision history.
            </span>
          ) : (
            <span className="lg-footer-note">
              {batch ? 'Nothing is written until you apply.' : 'Step 1 and 2 above.'}
            </span>
          )}

          {phase.k === 'done' ? (
            <button type="button" className="bm-btn bm-btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="bm-btn bm-btn-ghost" onClick={() => void discard()} disabled={busy}>
                Cancel
              </button>
              {phase.k === 'confirm' ? (
                <button type="button" className="bm-btn bm-btn-primary" onClick={() => void commit()} disabled={busy}>
                  Yes, apply and overwrite
                </button>
              ) : (
                <button
                  type="button"
                  className="bm-btn bm-btn-primary"
                  disabled={!canCommit || busy || !batch}
                  onClick={() => {
                    if (!batch) return;
                    // Overwriting is always a conscious act — route it through a confirm step.
                    if (batch.summary.changed > 0) setPhase({ k: 'confirm', batch });
                    else void commit();
                  }}
                >
                  {phase.k === 'committing'
                    ? 'Applying…'
                    : summary
                      ? `Apply ${summary.accepted} row${summary.accepted === 1 ? '' : 's'}${
                          summary.rejected ? ` (skip ${summary.rejected})` : ''
                        }`
                      : 'Apply'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
