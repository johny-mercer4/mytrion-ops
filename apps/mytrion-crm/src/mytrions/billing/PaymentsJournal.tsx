/**
 * The payments journal in LEDGER framing (TZ §7).
 *
 * NOT a second Transactions tab. That tab answers "what came in and how do I map it"; this one answers
 * the ledger question — WHICH SUB-LEDGER did each payment land in. A matched invoice payment is an AR
 * credit, a matched prepay payment is a Customer Balance top-up, and an unmatched one is money we hold
 * and have attributed to nobody. That last case is the "lost money" §7 exists to prevent, and it is not
 * visible on the Transactions tab at all.
 *
 * Server-paged, unlike the other ledger surfaces: this is the one list with no natural ceiling — every
 * payment ever received — so loading it whole to filter in memory would not stay viable.
 *
 * Period-independent on purpose. An unmatched payment from three weeks ago is exactly the row an agent
 * needs today; scoping it to the ledger's period would hide the problem it reports.
 */
import { useEffect, useState } from 'react';

import { fetchLedgerPayments } from '../../api/billing';
import type { LedgerPaymentRow } from '../../api/ledgerTypes';
import { useLoad } from '../_shared/useLoad';
import { srcLabel, toTxSource } from './data';
import { fmtMoney, formatYmd } from './ledgerModel';

const P_ERROR = 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
const P_REFRESH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

const PAGE_SIZE = 50;

type MatchFilter = '' | 'matched' | 'unmatched';
type SourceFilter = '' | 'mx' | 'zelle' | 'chase' | 'stripe';

const SOURCES: { key: SourceFilter; label: string }[] = [
  { key: '', label: 'All rails' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'mx', label: 'MX Merchant' },
  { key: 'chase', label: 'Chase' },
];

export function PaymentsJournal() {
  const [page, setPage] = useState(1);
  const [match, setMatch] = useState<MatchFilter>('');
  const [source, setSource] = useState<SourceFilter>('');

  const load = useLoad(
    () =>
      fetchLedgerPayments({
        page,
        limit: PAGE_SIZE,
        ...(match ? { match } : {}),
        ...(source ? { source } : {}),
      }),
    [page, match, source],
  );

  useEffect(() => {
    setPage(1);
  }, [match, source]);

  const data = load.data;
  const rows: LedgerPaymentRow[] = data?.rows ?? [];
  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const initialLoading = load.loading && !data;

  return (
    <>
      <div className="lg-toolbar">
        <div className="lg-tabs">
          {(['', 'matched', 'unmatched'] as MatchFilter[]).map((m) => (
            <button
              key={m || 'all'}
              type="button"
              className={`lg-tab${match === m ? ' lg-tab-active' : ''}`}
              onClick={() => setMatch(m)}
            >
              {m === '' ? 'All' : m === 'matched' ? 'Matched' : 'Unmatched'}
            </button>
          ))}
        </div>
        <select
          className="bm-select"
          value={source}
          onChange={(e) => setSource(e.target.value as SourceFilter)}
          aria-label="Payment rail"
        >
          {SOURCES.map((s) => (
            <option key={s.key || 'all'} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
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
        <span className="lg-filter-hint">
          Chronological and independent of the period above — an old unmatched payment is still today's
          problem
        </span>
      </div>

      {initialLoading ? (
        <div className="lg-preview-wrap" aria-busy="true" aria-label="Loading payments">
          <table className="lg-preview-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rail</th>
                <th className="lg-th-num">Amount</th>
                <th>Carrier</th>
                <th>Client</th>
                <th>Landed in</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }, (_, i) => (
                <tr key={`skel-${i}`} aria-hidden>
                  {Array.from({ length: 6 }, (__, c) => (
                    <td key={c}>
                      <div className="bm-skeleton" style={{ height: 10, width: c === 4 ? 140 : 60 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : load.error && !data ? (
        <div className="db-error-state">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={P_ERROR} />
          </svg>
          <div className="db-error-msg">{load.error}</div>
          <button className="bm-refresh-btn" onClick={() => void load.reload()}>
            Try Again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="db-empty-state">No payments match these filters.</div>
      ) : (
        <div className="lg-preview-wrap">
          <table className="lg-preview-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rail</th>
                <th className="lg-th-num">Amount</th>
                <th>Carrier</th>
                <th>Client</th>
                <th>Landed in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.match.state === 'unmatched' ? 'lg-row--changed' : undefined}>
                  <td>{r.date ? formatYmd(r.date) : '—'}</td>
                  <td>{srcLabel(toTxSource(r.source))}</td>
                  <td className="lg-td-num">
                    {fmtMoney(r.amount)}
                    {r.isReturned ? <span className="lg-pill-bad">returned</span> : null}
                  </td>
                  <td>{r.carrierId ?? '—'}</td>
                  <td>
                    {r.companyName || r.senderName || '—'}
                    {r.clientType ? (
                      <span className={`lg-type-pill lg-type-${r.clientType.toLowerCase()}`}>
                        {r.clientType}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={r.match.state === 'matched' ? 'lg-pill-ok' : 'lg-pill-warn'}>
                      {r.match.label}
                    </span>
                    {r.mappedBy ? <div className="lg-row-reasons">by {r.mappedBy}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="db-pagination">
          <span className="db-page-info">
            Page {page} of {pageCount} · {data?.total ?? 0} payments
          </span>
          <div className="db-page-actions">
            <button className="db-page-btn" disabled={page <= 1 || load.loading} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span className="db-page-current">{page}</span>
            <button
              className="db-page-btn"
              disabled={page >= pageCount || load.loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <div className="lg-list-caption">
        Mapping happens on the <strong>Transactions</strong> tab — this view reports where each payment
        ended up in the ledger, not how to place it.
      </div>
    </>
  );
}
