/**
 * Manual-match modal — 1:1 port of the widget returns-panel.js match modal (search MX candidates →
 * select one → "Match & Reverse"), wired to the LIVE billing.returns.* touchpoints.
 *
 * The write (`billing.returns.match`) LINKS the return and, if the transaction is mapped, REVERSES
 * the CMP payment (mapping kept) — the same server flow the automatic matcher runs. Identity
 * (matchedBy) is injected server-side from the session; the UI never sends it. Status handling
 * mirrors TransactionModal's reversal writes: partial → inline + toast, modal stays open, no
 * optimistic patch; success → patch the row, toast, close.
 */
import { type CSSProperties, useEffect, useState } from 'react';

import { matchReturn, searchReturnCandidates } from '@/api/billing';
import { readStr } from './transactionModel';
import {
  type Candidate,
  type ReturnRow,
  errMsg,
  fmtCurrency,
  formatDay,
  mapCandidate,
  sameAmount,
  typeLabel,
} from './returnsModel';

type ToastKind = 'success' | 'error';

const SEARCH_ICON = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const CLOSE_ICON = 'M6 18L18 6M6 6l12 12';
const LINK_ICON =
  'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1';

export interface ReturnMatchModalProps {
  ret: ReturnRow;
  onClose: () => void;
  /** Applied on a successful match so the row's status pill flips without a refetch. */
  onMatched: (returnRecordId: string, patch: Partial<ReturnRow>) => void;
  onToast: (kind: ToastKind, message: string) => void;
}

export function ReturnMatchModal({ ret, onClose, onMatched, onToast }: ReturnMatchModalProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<Candidate[]>([]);
  const [mode, setMode] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /* Search MX transactions. Empty query = suggestion mode (server decides: same amount / same
     customer, on-or-before the return date); a single character is too short to search. */
  async function runSearch(rawQuery: string): Promise<void> {
    const q = rawQuery.trim();
    if (q.length === 1 || searching) return;
    setSearching(true);
    setError('');
    setResults([]);
    setSelectedId('');
    try {
      const data = await searchReturnCandidates({
        query: q,
        amount: String(ret.amount),
        beforeDate: ret.returnDate.slice(0, 10),
        customerName: ret.customerName,
      });
      if (readStr(data.status) !== 'success') throw new Error(readStr(data.message) || 'Search failed');
      setResults((data.records ?? []).map(mapCandidate));
      setMode(readStr(data.mode) || 'text');
    } catch (e) {
      setError('Search failed. ' + errMsg(e));
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }

  /* Deliberately NO reference prefill: unmatched returns are unmatched BECAUSE the reference lookup
     already failed — searching it again finds nothing. Open in suggestion mode. */
  useEffect(() => {
    void runSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestClose(): void {
    if (submitting) return;
    onClose();
  }

  async function confirmMatch(): Promise<void> {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      // Reverses a REAL CMP payment (when the transaction is mapped) — do not fire in verification.
      const res = await matchReturn(ret.recordId, selectedId);
      const status = readStr(res.status);
      if (status === 'partial') {
        const msg = readStr(res.message) || 'Partial reversal — reconcile the CMP payment manually.';
        setError(msg);
        onToast('error', 'Match incomplete — manual CMP reconciliation needed');
        return; // keep modal open; do NOT optimistically flip the row to matched
      }
      if (status !== 'success') throw new Error(readStr(res.message) || 'Match failed');
      onMatched(ret.recordId, {
        matched: true,
        matchNote: readStr(res.matchNote) || ret.matchNote,
        originalTransactionId: readStr(res.transactionId) || ret.originalTransactionId,
        originalTransactionName: readStr(res.transactionName) || ret.originalTransactionName,
      });
      onToast('success', 'Return matched — ' + (readStr(res.message) || 'done'));
      onClose();
    } catch (e) {
      const msg = errMsg(e);
      setError(msg);
      onToast('error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="bm-modal-box" style={{ maxWidth: 660 }}>
        <div className="bm-modal-header">
          <div className="bm-modal-title">
            Match Return — {ret.customerName || ret.referenceNumber || 'Unknown'}
            <span className="text-danger" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {' '}
              · -{fmtCurrency(ret.amount)}
            </span>
          </div>
          <button className="bm-modal-close" onClick={requestClose}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CLOSE_ICON} />
            </svg>
          </button>
        </div>

        <div className="bm-modal-body">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Reference{' '}
            <b style={{ fontFamily: "'JetBrains Mono', monospace" }}>{ret.referenceNumber || '—'}</b>
            {' · '}
            {typeLabel(ret.returnType)}
            {' · '}
            {formatDay(ret.returnDate)}
          </div>

          {/* Search MX transactions */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              type="text"
              className="db-search-input"
              style={{ flex: 1, paddingLeft: '0.75rem' }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch(query);
                }
              }}
              placeholder="Search by reference, payment id, or customer name — empty shows suggestions"
              autoComplete="off"
            />
            <button
              className="bm-refresh-btn"
              onClick={() => void runSearch(query)}
              disabled={searching || query.trim().length === 1}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={SEARCH_ICON} />
              </svg>
              Search
            </button>
          </div>

          {/* Results */}
          {searching ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.75rem 0' }}>
              Searching MX transactions…
            </div>
          ) : results.length && mode === 'suggest' ? (
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              Suggested — same amount or same customer, on/before the return date
            </div>
          ) : results.length && mode === 'window' ? (
            <div style={{ fontSize: '0.6875rem', color: 'var(--warning-text, #eab308)', marginBottom: '0.4rem' }}>
              No amount/customer matches — showing all MX transactions from the 7 days before the return
            </div>
          ) : null}

          {!searching && results.length ? (
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {results.map((tx) => {
                const selected = selectedId === tx.recordId;
                const rowStyle: CSSProperties = {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.55rem 0.7rem',
                  borderRadius: 6,
                  border: `1px solid ${selected ? 'var(--billing-accent, #4aa8ff)' : 'var(--border)'}`,
                  ...(tx.isReturned ? { opacity: 0.45, cursor: 'not-allowed' } : { cursor: 'pointer' }),
                  ...(selected ? { background: 'var(--accent-bg, #12233a)' } : {}),
                };
                return (
                  <div
                    key={tx.recordId}
                    onClick={() => {
                      if (!tx.isReturned) setSelectedId(tx.recordId);
                    }}
                    title={
                      tx.isReturned
                        ? 'Already marked returned — another return consumed this transaction'
                        : 'Click to select'
                    }
                    style={rowStyle}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="rt-ellipsis" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                        {tx.customerName || '—'}
                      </div>
                      <div
                        className="rt-ellipsis"
                        style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        #{tx.name}
                        {tx.reference ? ` · ref ${tx.reference}` : ''}
                        {tx.carrierId ? ` · ${tx.carrierId}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                      {sameAmount(tx.amount, ret.amount) ? (
                        <span className="db-status-badge db-status-ok" title="Amount equals the return amount">
                          amount match
                        </span>
                      ) : null}
                      {tx.isReturned ? (
                        <span className="db-status-badge db-status-pending">RETURNED</span>
                      ) : tx.isInvoiceMapped ? (
                        <span
                          className="db-status-badge db-status-ok"
                          title="Mapped — CMP payment will be reversed (mapping kept)"
                        >
                          Mapped
                        </span>
                      ) : (
                        <span className="db-cmp-quiet">Unmapped</span>
                      )}
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                          {fmtCurrency(tx.amount)}
                        </div>
                        <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>{formatDay(tx.createdDate)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !searching && searched ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.75rem 0' }}>
              No MX transactions found — try part of the customer name or the payment id, or clear the box and hit
              Search for suggestions.
            </div>
          ) : null}

          {error ? (
            <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--danger-text, #ff6b6b)' }}>{error}</div>
          ) : null}
        </div>

        <div className="bm-modal-footer" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1, fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Links the return and, if the transaction is mapped, reverses the CMP payment (mapping kept) — same as the
            automatic flow.
          </div>
          <button className="bm-refresh-btn" onClick={requestClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="rt-match-btn rt-match-btn--lg rt-match-btn--solid"
            onClick={() => void confirmMatch()}
            disabled={!selectedId || submitting}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={LINK_ICON} />
            </svg>
            {submitting ? 'Matching…' : 'Match & Reverse'}
          </button>
        </div>
      </div>
    </div>
  );
}
