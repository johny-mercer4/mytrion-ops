/**
 * Control points (TZ §9) — the work list the ledger produces, as opposed to the balances it displays.
 *
 * Everything here reads the NIGHTLY SNAPSHOT rather than computing live, because reconciling a closing
 * balance against an external system cannot happen inside a page load for ~2,850 carriers. The
 * consequence is that this surface can be STALE, so it says so: an un-run or out-of-date snapshot is
 * labelled explicitly instead of rendering zeros that read as "nothing is wrong".
 *
 * Four checks, each answering a different failure:
 *   • Reconciliation — does our Closing match EFS/CMP? (the module's whole purpose)
 *   • AR aging — how old is what we are owed?
 *   • Unbilled over cycle — did CMP fail to invoice something it already billed through?
 *   • Un Top-Upped 24h — is money sitting unattributed?
 */
import { useState } from 'react';

import {
  fetchLedgerArAging,
  fetchLedgerControlSums,
  fetchLedgerSummary,
  fetchLedgerUnbilledAging,
  fetchLedgerUntoppedAging,
  fetchLedgerVariances,
  recomputeLedger,
} from '../../api/billing';
import type { LedgerSectionId } from '../../api/ledgerTypes';
import { useLoad } from '../_shared/useLoad';
import { AgingBar } from './AgingBar';
import { errMsg, fmtMoney, formatStamp, formatYmd } from './ledgerModel';

const P_REFRESH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

const STATUS_LABELS: Record<string, string> = {
  ok: 'Reconciled',
  variance: 'Variance',
  no_opening: 'No opening balance',
  source_unavailable: 'Source unavailable',
  stale_external: 'Checked against another day',
};

export function LedgerControls({ canWrite }: { canWrite: boolean }) {
  const [tick, setTick] = useState(0);
  const [recomputing, setRecomputing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [varianceSection, setVarianceSection] = useState<LedgerSectionId | ''>('');

  const summary = useLoad(() => fetchLedgerSummary(), [tick]);
  const variances = useLoad(
    () => fetchLedgerVariances({ limit: 50, ...(varianceSection ? { section: varianceSection } : {}) }),
    [tick, varianceSection],
  );
  const arAging = useLoad(() => fetchLedgerArAging(), [tick]);
  const unbilled = useLoad(() => fetchLedgerUnbilledAging(25), [tick]);
  const untopped = useLoad(() => fetchLedgerUntoppedAging(), [tick]);
  const control = useLoad(() => fetchLedgerControlSums(), [tick]);

  const s = summary.data;
  const neverRun = s !== undefined && s !== null && s.latestComputedDate === null;

  async function onRecompute(): Promise<void> {
    setRecomputing(true);
    setNotice(null);
    try {
      const res = await recomputeLedger();
      setNotice({
        kind: 'ok',
        text: `Recompute queued for ${formatYmd(res.asOfDate)}. Refresh in a minute or two — a full pass touches every carrier.`,
      });
    } catch (e) {
      setNotice({ kind: 'error', text: errMsg(e, 'Could not queue the recompute.') });
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <>
      <div className="lg-toolbar">
        <div className="lg-control-asof">
          {s ? (
            <>
              <span className="lg-control-asof-label">Reconciliation as of</span>
              <span className="lg-control-asof-value">{formatYmd(s.asOfDate)}</span>
              {neverRun ? (
                <span className="lg-pill-warn">never computed</span>
              ) : s.stale ? (
                <span className="lg-pill-warn">
                  last computed {formatYmd(s.latestComputedDate)}
                </span>
              ) : (
                <span className="lg-pill-ok">current</span>
              )}
            </>
          ) : (
            <div className="bm-skeleton" style={{ height: 12, width: 220 }} />
          )}
        </div>

        {canWrite ? (
          <button className="bm-btn bm-btn-ghost" disabled={recomputing} onClick={() => void onRecompute()}>
            {recomputing ? 'Queuing…' : 'Recompute today'}
          </button>
        ) : null}

        <button className="bm-refresh-btn" onClick={() => setTick((t) => t + 1)}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_REFRESH} />
          </svg>
          Refresh
        </button>
      </div>

      {notice ? (
        <div
          className={`bm-notice bm-notice--${notice.kind === 'ok' ? 'ok' : 'error'}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <div className="bm-notice-msg">{notice.text}</div>
        </div>
      ) : null}

      {/* An un-run snapshot must not look like a clean bill of health. */}
      {neverRun ? (
        <div className="db-empty-state">
          The nightly reconciliation has not run yet, so there is nothing to report. It runs at 05:00
          Central; {canWrite ? 'or use “Recompute today” above.' : 'ask a colleague with write access to trigger it.'}
        </div>
      ) : null}

      {/* ── 1. Reconciliation per section ── */}
      <div className="lg-control-block">
        <div className="lg-control-head">
          <h3 className="lg-control-title">Closing vs the independent source</h3>
          <span className="lg-control-sub">
            Every section's closing balance checked against EFS or CMP — the module's core control
          </span>
        </div>
        {summary.error && !s ? (
          <div className="db-error-msg">{summary.error}</div>
        ) : (
          <div className="db-kpi-grid">
            {(s?.sections ?? []).map((sec) => {
              const total =
                sec.counts.ok +
                sec.counts.variance +
                sec.counts.noOpening +
                sec.counts.sourceUnavailable +
                sec.counts.staleExternal;
              return (
                <button
                  key={sec.section}
                  type="button"
                  className={`db-kpi-card lg-kpi-clickable${varianceSection === sec.section ? ' lg-kpi-active' : ''}`}
                  onClick={() =>
                    setVarianceSection((cur) => (cur === sec.section ? '' : sec.section))
                  }
                  title="Filter the variance queue to this section"
                >
                  <div className="db-kpi-title">{sec.label}</div>
                  <div className={`db-kpi-value${sec.counts.variance ? ' text-danger' : ''}`}>
                    {sec.counts.variance}
                  </div>
                  <div className="lg-kpi-sub">
                    {total === 0
                      ? 'not computed'
                      : `${sec.counts.variance} of ${total} off · ${fmtMoney(sec.varianceTotal)}`}
                  </div>
                  {sec.counts.noOpening || sec.counts.sourceUnavailable ? (
                    <div className="lg-kpi-sub">
                      {sec.counts.noOpening ? `${sec.counts.noOpening} no opening` : ''}
                      {sec.counts.noOpening && sec.counts.sourceUnavailable ? ' · ' : ''}
                      {sec.counts.sourceUnavailable ? `${sec.counts.sourceUnavailable} no source` : ''}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {/* The queue itself */}
        {variances.data && variances.data.rows.length > 0 ? (
          <div className="lg-preview-wrap">
            <table className="lg-preview-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>Section</th>
                  <th className="lg-th-num">Closing</th>
                  <th className="lg-th-num">External</th>
                  <th className="lg-th-num">Difference</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {variances.data.rows.map((r) => (
                  <tr key={`${r.carrierId}:${r.section}`}>
                    <td>{r.carrierId}</td>
                    <td>{r.section}</td>
                    <td className="lg-td-num">{fmtMoney(r.closing)}</td>
                    <td className="lg-td-num">{fmtMoney(r.externalValue)}</td>
                    <td className="lg-td-num">
                      <span className={Math.abs(r.variance ?? 0) > 0 ? 'text-danger' : undefined}>
                        {fmtMoney(r.variance)}
                      </span>
                    </td>
                    <td>{r.externalSource ?? '—'}</td>
                    <td>
                      <span
                        className={
                          r.status === 'variance'
                            ? 'lg-pill-bad'
                            : r.status === 'ok'
                              ? 'lg-pill-ok'
                              : 'lg-pill-warn'
                        }
                      >
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : variances.data && !neverRun ? (
          <div className="db-empty-state">
            Nothing outside tolerance{varianceSection ? ' in this section' : ''}.
          </div>
        ) : null}
        {variances.data && variances.data.total > variances.data.rows.length ? (
          <div className="lg-list-caption">
            Showing {variances.data.rows.length} of {variances.data.total} — worst first.
          </div>
        ) : null}
      </div>

      {/* ── 2. AR aging ── */}
      <div className="lg-control-block">
        <div className="lg-control-head">
          <h3 className="lg-control-title">Accounts Receivable aging</h3>
          <span className="lg-control-sub">Open invoices by days past due</span>
        </div>
        {arAging.data ? (
          <>
            <AgingBar
              buckets={arAging.data.buckets}
              total={arAging.data.total}
              label={`${arAging.data.invoices} open invoices`}
            />
            {arAging.data.noDueDate.invoices > 0 ? (
              <div className="lg-exclusion-note">
                {arAging.data.noDueDate.invoices} invoice
                {arAging.data.noDueDate.invoices === 1 ? '' : 's'} worth{' '}
                {fmtMoney(arAging.data.noDueDate.amount)} have no due date — a data-quality problem, not
                an aging bucket.
              </div>
            ) : null}
          </>
        ) : arAging.error ? (
          <div className="db-error-msg">{arAging.error}</div>
        ) : (
          <div className="bm-skeleton" style={{ height: 44, width: '100%' }} />
        )}
      </div>

      {/* ── 3. Unbilled over cycle ── */}
      <div className="lg-control-block">
        <div className="lg-control-head">
          <h3 className="lg-control-title">Should already have been invoiced</h3>
          <span className="lg-control-sub">
            Spend dated inside a window CMP has already billed through, still carrying no invoice
          </span>
        </div>
        {unbilled.data ? (
          unbilled.data.rows.length === 0 ? (
            <div className="db-empty-state">Nothing outstanding — CMP has invoiced everything in scope.</div>
          ) : (
            <>
              <div className="lg-summary-strip">
                <span className="lg-sum-bad">{unbilled.data.total} clients</span>
                <span className="lg-sum-sep">·</span>
                <span>{fmtMoney(unbilled.data.totalAmount)} not invoiced</span>
              </div>
              <div className="lg-preview-wrap">
                <table className="lg-preview-table">
                  <thead>
                    <tr>
                      <th>Carrier</th>
                      <th>Client</th>
                      <th className="lg-th-num">Amount</th>
                      <th className="lg-th-num">Txns</th>
                      <th>Billed through</th>
                      <th className="lg-th-num">Oldest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unbilled.data.rows.map((r) => (
                      <tr key={r.carrierId}>
                        <td>{r.carrierId}</td>
                        <td>{r.companyName || '—'}</td>
                        <td className="lg-td-num">{fmtMoney(r.amount)}</td>
                        <td className="lg-td-num">{r.transactions}</td>
                        <td>{r.lastInvoicedThrough ? formatYmd(r.lastInvoicedThrough) : '—'}</td>
                        <td className="lg-td-num">{r.oldestDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : unbilled.error ? (
          <div className="db-error-msg">{unbilled.error}</div>
        ) : (
          <div className="bm-skeleton" style={{ height: 44, width: '100%' }} />
        )}
      </div>

      {/* ── 4. Un Top-Upped 24h alarm ── */}
      <div className="lg-control-block">
        <div className="lg-control-head">
          <h3 className="lg-control-title">Received but not yet loaded</h3>
          <span className="lg-control-sub">
            Nothing should sit here longer than 24 hours (TZ §5.2)
          </span>
        </div>
        {untopped.data ? (
          <>
            <div className="lg-summary-strip">
              <span className={untopped.data.alarmPayments ? 'lg-sum-bad' : 'lg-sum-ok'}>
                {untopped.data.alarmPayments} past 24h
              </span>
              <span className="lg-sum-sep">·</span>
              <span>{fmtMoney(untopped.data.alarmAmount)} in alarm</span>
              <span className="lg-sum-sep">·</span>
              <span className="lg-sum-muted">{fmtMoney(untopped.data.total)} unapplied in total</span>
            </div>
            <AgingBar
              buckets={untopped.data.buckets.map((b) => ({
                key: b.key,
                label: b.label,
                tone: b.tone,
                amount: b.amount,
                invoices: b.payments,
                carriers: 0,
              }))}
              total={untopped.data.total}
            />
          </>
        ) : untopped.error ? (
          <div className="db-error-msg">{untopped.error}</div>
        ) : (
          <div className="bm-skeleton" style={{ height: 44, width: '100%' }} />
        )}
      </div>

      {/* ── 5. Control sums ── */}
      <div className="lg-control-block">
        <div className="lg-control-head">
          <h3 className="lg-control-title">Control sums</h3>
          <span className="lg-control-sub">
            Cross-checks that must hold if the underlying data is sound
          </span>
        </div>
        {control.data ? (
          <div className="lg-preview-wrap">
            <table className="lg-preview-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th className="lg-th-num">Left</th>
                  <th className="lg-th-num">Right</th>
                  <th className="lg-th-num">Difference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {control.data.checks.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td className="lg-td-num">
                      {fmtMoney(c.left.amount)}
                      <span className="lg-aging-count"> {c.left.label}</span>
                    </td>
                    <td className="lg-td-num">
                      {fmtMoney(c.right.amount)}
                      <span className="lg-aging-count"> {c.right.label}</span>
                    </td>
                    <td className="lg-td-num">{fmtMoney(c.variance)}</td>
                    <td>
                      <span className={c.status === 'ok' ? 'lg-pill-ok' : 'lg-pill-bad'}>
                        {c.status === 'ok' ? 'OK' : 'Variance'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : control.error ? (
          <div className="db-error-msg">{control.error}</div>
        ) : (
          <div className="bm-skeleton" style={{ height: 44, width: '100%' }} />
        )}
        <p className="lg-modal-note">
          The spec's own control sum — total EFS Parent Account outflow against total loaded onto customer
          balances — is <strong>not computed</strong>: EFS exposes no batched parent-account route, so the
          left-hand side of that identity is unavailable. Rather than approximate it, the checks above are
          ones that genuinely hold when the data is sound. The per-carrier Customer Balance reconciliation
          is what actually tests “opening + loads − spend = closing”.
        </p>
      </div>

      <div className="lg-list-caption">
        {s ? `Computed ${s.latestComputedDate ? formatStamp(`${s.latestComputedDate}T05:00:00Z`) : 'never'}. ` : ''}
        Aging and control sums are computed live; the reconciliation status comes from the nightly pass.
      </div>
    </>
  );
}
