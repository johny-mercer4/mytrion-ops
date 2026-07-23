/**
 * Payment Transactions panel — 1:1 port of the widget's transactions-panel.js (header + stats
 * banner + toolbar + date-grouped list + pagination + detail modal) over the LIVE billing.*
 * touchpoints. The WebSocket real-time sync (connectWebSocket / _broadcastMapping / remoteLock /
 * _applyRemoteEvent) is deliberately OMITTED for Phase 1.
 *
 * The initial page loads through the shared `useLoad` hook; pagination ("load next 200"),
 * debounced server search, per-row optimistic mapping patches, and the modal are managed with
 * useState. Mapping/unmapping WRITES are wired through TransactionModal and mutate the in-memory
 * list optimistically (the authoritative values return on the next reload).
 *
 * Phase 3b — real-time mapping sync: a reconnecting WebSocket (useMappingSocket) applies remote
 * map/unmap/returned events to the in-memory rows (list + stat banner react in place); because
 * `openTx` is derived from those rows, a remote map flips the open modal to read-only for free.
 * Local writes relay to peers via broadcastMapping (backend proxy keeps the servercrm key safe).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { broadcastMapping, fetchTransactions, fetchTransactionStats, searchTransactions } from '@/api/billing';
import { useUserContext } from '../../context/UserContextProvider';
import { useLoad } from '../_shared/useLoad';
import { computeAutoMapFlag, getCarrierMemoryIndex } from './autoMapFlag';
import { type TxSource, dateLabel, fmtCurrency } from './data';
import { ChaseAddModal } from './ChaseAddModal';
import { TransactionModal } from './TransactionModal';
import { useMappingSocket, type RemoteMappingEvent } from './useMappingSocket';
import {
  BM_SEARCH_DEBOUNCE_MS,
  BM_TOAST_MS,
  BM_TX_PAGE_SIZE,
  SOURCE_NAMES,
  type TxRow,
  extractRecords,
  normalizeTx,
  readBool,
  readNum,
  rebuildHaystack,
  txSourceLabel,
  txStatusBadgeClass,
} from './transactionModel';
import type { BillingTransactionsPage } from '@/api/touchpointTypes';

type ToastKind = 'success' | 'error';
type PageData = BillingTransactionsPage | null | undefined;

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

const SOURCE_OPTIONS: { id: 'all' | TxSource; label: string }[] = [
  { id: 'all', label: 'All Sources' },
  { id: 'zelle', label: 'Zelle' },
  { id: 'chase', label: 'Chase' },
  { id: 'mx', label: 'MX Merchant' },
  { id: 'stripe', label: 'Stripe' },
];

const CARRIER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'invoiceMapped', label: 'Invoice Mapped' },
  { id: 'invoiceUnmapped', label: 'Invoice Unmapped' },
];

function fetchPage(page: number): Promise<BillingTransactionsPage> {
  return fetchTransactions(page, BM_TX_PAGE_SIZE);
}
function pageHasMore(d: PageData): boolean {
  return readBool(d?.has_more) || readBool(d?.hasMore) || readBool(d?.more_records);
}
function pageTotal(d: PageData, fallback: number): number {
  const t = readNum(d?.total_fetched);
  return t > 0 ? t : fallback;
}
function pageNumber(d: PageData, fallback: number): number {
  const p = readNum(d?.page);
  return p > 0 ? p : fallback;
}

export function Transactions() {
  const user = useUserContext();

  const firstPage = useLoad(() => fetchPage(1), []);
  const page1 = firstPage.data;

  // Whole-dataset aggregates (source counts + mapped/total/$) — so the source filter and summary
  // tiles reflect ALL transactions, not just the loaded page(s). Refreshed on reload + after a
  // mapping change (see the patches effect below).
  const statsLoad = useLoad(() => fetchTransactionStats(), []);
  const stats = statsLoad.data;

  // Carrier-memory index for the Zelle auto-map row badge (loaded + cached once per session).
  const [memoryIndex, setMemoryIndex] = useState<Map<string, Set<string>> | null>(null);
  useEffect(() => {
    let off = false;
    void getCarrierMemoryIndex().then((idx) => {
      if (!off) setMemoryIndex(idx);
    });
    return () => {
      off = true;
    };
  }, []);

  // Appended pages (page ≥ 2) + optimistic per-row patches, both reset when page 1 reloads.
  const [extra, setExtra] = useState<TxRow[]>([]);
  const [meta, setMeta] = useState<{ page: number; hasMore: boolean; total: number } | null>(null);
  const [patches, setPatches] = useState<Record<string, Partial<TxRow>>>({});
  const [loadingMore, setLoadingMore] = useState(false);

  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | TxSource>('all');
  const [carrierFilter, setCarrierFilter] = useState('all');
  const [serverExtras, setServerExtras] = useState<TxRow[] | null>(null);
  const [searchFetching, setSearchFetching] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [showChaseAdd, setShowChaseAdd] = useState(false);
  const [toast, setToast] = useState<{ id: number; kind: ToastKind; message: string } | null>(null);

  const notify = useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  // Fresh page-1 payload (initial load or reload) → drop appended pages, patches and page meta.
  useEffect(() => {
    setExtra([]);
    setMeta(null);
    setPatches({});
  }, [page1]);

  // A mapping change (optimistic/remote patch) shifts the global mapped/unmapped split → refresh
  // the whole-dataset stats so the summary tiles stay accurate. Cheap aggregate; low frequency.
  const statsReload = statsLoad.reload;
  useEffect(() => {
    statsReload();
  }, [patches, statsReload]);

  useEffect(() => {
    if (firstPage.error) notify('error', 'Could not load transactions. Try refreshing.');
  }, [firstPage.error, notify]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), BM_TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Debounced background server search (full CRM dataset), merged with local matches below.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setServerExtras(null);
      setSearchFetching(false);
      return;
    }
    if (SOURCE_NAMES.includes(q.toLowerCase())) {
      // Source-name queries can't match text fields server-side — local matches only.
      setServerExtras(null);
      return;
    }
    let off = false;
    const timer = setTimeout(() => {
      setSearchFetching(true);
      searchTransactions(q)
        .then((data) => {
          if (!off) setServerExtras(extractRecords(data).map(normalizeTx));
        })
        .catch(() => {
          if (!off) notify('error', 'Search failed. Try again.');
        })
        .finally(() => {
          if (!off) setSearchFetching(false);
        });
    }, BM_SEARCH_DEBOUNCE_MS);
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [search, notify]);

  const applyPatch = useCallback(
    (r: TxRow): TxRow => {
      const p = patches[r.recordId];
      if (!p) return r;
      const merged = { ...r, ...p };
      return { ...merged, haystack: rebuildHaystack(merged) };
    },
    [patches],
  );

  // Full loaded list = page-1 records + appended pages, with optimistic patches layered on.
  const rows = useMemo<TxRow[]>(() => {
    const base = page1 ? extractRecords(page1).map(normalizeTx) : [];
    return [...base, ...extra].map(applyPatch);
  }, [page1, extra, applyPatch]);

  const curPage = meta?.page ?? pageNumber(page1, 1);
  const hasMore = meta ? meta.hasMore : pageHasMore(page1);
  const totalFetched = meta ? meta.total : pageTotal(page1, rows.length);

  const query = search.trim().toLowerCase();
  const searchResults = useMemo<TxRow[] | null>(() => {
    if (!query) return null;
    const isCarrierId = /^\d+$/.test(query);
    const local = rows.filter((t) => (isCarrierId ? (t.carrierId ?? '') === query : t.haystack.includes(query)));
    if (!serverExtras) return local;
    const localIds = new Set(local.map((t) => t.recordId));
    const extras = serverExtras.map(applyPatch).filter((t) => !localIds.has(t.recordId));
    return [...local, ...extras];
  }, [query, rows, serverExtras, applyPatch]);

  const filtered = useMemo<TxRow[]>(() => {
    let list = searchResults ?? rows;
    if (source !== 'all') list = list.filter((t) => t.source === source);
    if (carrierFilter === 'invoiceMapped') list = list.filter((t) => t.isInvoiceMapped);
    else if (carrierFilter === 'invoiceUnmapped') list = list.filter((t) => !t.isInvoiceMapped);
    return list;
  }, [searchResults, rows, source, carrierFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, TxRow[]>();
    for (const t of filtered) {
      const key = t.postingDate || 'Unknown';
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest date first
      .map(([date, items]) => ({ date, items, total: items.reduce((s, t) => s + t.amount, 0) }));
  }, [filtered]);

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of rows) c[t.source] = (c[t.source] ?? 0) + 1;
    return c;
  }, [rows]);

  const openTx = useMemo(() => {
    if (!openId) return null;
    return rows.find((r) => r.recordId === openId) ?? serverExtras?.map(applyPatch).find((r) => r.recordId === openId) ?? null;
  }, [openId, rows, serverExtras, applyPatch]);

  const totalAmount = Math.abs(filtered.reduce((s, t) => s + t.amount, 0));
  const mappedCount = filtered.filter((t) => t.isInvoiceMapped).length;
  const unmappedCount = filtered.length - mappedCount;
  const resultsActive = !!search.trim() || source !== 'all' || carrierFilter !== 'all';

  // Summary tiles show whole-dataset stats (ALL transactions), not just the loaded page. During an
  // active text search the list is a specific query, so fall back to the (full-dataset) match set.
  const searchActive = !!search.trim();
  const g = !searchActive ? stats : null;
  const summaryTotal = g ? g.total : filtered.length;
  const summaryMapped = g ? g.mapped : mappedCount;
  const summaryUnmapped = g ? g.unmapped : unmappedCount;
  const summaryAmount = g ? Math.abs(g.totalAmount) : totalAmount;
  const summaryDenom = g ? g.total : filtered.length;

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = curPage + 1;
      const data = await fetchPage(next);
      const recs = extractRecords(data).map(normalizeTx);
      const seen = new Set(rows.map((r) => r.recordId));
      const fresh = recs.filter((r) => !seen.has(r.recordId));
      setExtra((prev) => [...prev, ...fresh]);
      setMeta({ page: pageNumber(data, next), hasMore: pageHasMore(data), total: pageTotal(data, rows.length + recs.length) });
    } catch {
      notify('error', 'Could not load more transactions.');
    } finally {
      setLoadingMore(false);
    }
  }

  function reload() {
    setSearch('');
    setSource('all');
    setCarrierFilter('all');
    setServerExtras(null);
    firstPage.refresh();
  }

  const patchRow = useCallback((recordId: string, patch: Partial<TxRow>) => {
    setPatches((prev) => ({ ...prev, [recordId]: { ...prev[recordId], ...patch } }));
  }, []);

  // ── Real-time mapping sync (Phase 3b) ──
  // Stable per-session id so the relay can echo-filter our own broadcasts.
  const originId = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `bm-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );

  const onRemote = useCallback(
    (e: RemoteMappingEvent) => {
      const id = String(e.transactionRecordId || '');
      if (!id) return;
      if (e.action === 'returned') {
        // A return reverses the CMP payment but keeps the CRM mapping — only flag it.
        patchRow(id, { isReturned: true, returnedAt: e.mappedAt ?? '' });
      } else if (e.action === 'unmap') {
        patchRow(id, {
          carrierId: null,
          isInvoiceMapped: false,
          mappedBy: '',
          mappedAt: '',
          mappingType: '',
          cmpRef: '',
        });
      } else {
        patchRow(id, {
          carrierId: e.carrierId ?? '',
          isInvoiceMapped: true,
          mappedBy: e.mappedBy ?? '',
          mappedAt: e.mappedAt ?? '',
          mappingType: e.mappingType ?? '',
          // UI-only placeholder so the unmap affordance shows immediately; the real CMP_Ref
          // lives in the CRM record and comes back on the next fetch.
          cmpRef: 'remote',
        });
      }
      // Toast only when the affected tx is the one open in the modal (which is now read-only
      // via the derived openTx state).
      if (openId === id) {
        const who = e.mappedBy || 'another user';
        if (e.action === 'returned') {
          notify('error', 'This transaction was returned / charged back (payment reversed in CMP)');
        } else if (e.action === 'unmap') {
          notify('success', `Updated — ${who} just unmapped this transaction`);
        } else {
          notify('success', `Updated — ${who} just mapped this transaction`);
        }
      }
    },
    [patchRow, openId, notify],
  );
  useMappingSocket(originId.current, onRemote);

  // Relay a local mapping write to peers (inferred from the modal's isInvoiceMapped patch).
  const patchAndBroadcast = useCallback(
    (row: TxRow, patch: Partial<TxRow>) => {
      patchRow(row.recordId, patch);
      if (patch.isInvoiceMapped === true) {
        broadcastMapping({
          action: 'map',
          transactionRecordId: row.recordId,
          source: row.source,
          carrierId: (patch.carrierId ?? row.carrierId) ?? '',
          mappingType: patch.mappingType ?? '',
          originId: originId.current,
        });
      } else if (patch.isInvoiceMapped === false) {
        broadcastMapping({
          action: 'unmap',
          transactionRecordId: row.recordId,
          source: row.source,
          originId: originId.current,
        });
      }
    },
    [patchRow],
  );

  const initialLoading = firstPage.loading && rows.length === 0;

  return (
    <div className="bm-panel tx-panel">
      {/* Header */}
      <div className="bm-header-row">
        <div>
          <h2 className="bm-title">Payment Transactions</h2>
          <div className="bm-subtitle">
            {totalFetched > 0 ? `${totalFetched.toLocaleString()} total records` : 'Live transaction ledger'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="bm-refresh-btn"
            onClick={() => setShowChaseAdd(true)}
            title="Manually add a Chase transaction"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Chase
          </button>
          <button className="bm-refresh-btn" onClick={reload} disabled={firstPage.loading || firstPage.refreshing} title="Refresh">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={firstPage.loading || firstPage.refreshing ? 'spin-icon' : undefined}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {initialLoading ? (
        <div className="bm-initial-loader">
          <div className="bm-loader-ring" />
          <div className="bm-loader-text">Loading transactions</div>
          <div className="bm-loader-sub">Fetching latest payment data...</div>
        </div>
      ) : (
        <>
          {/* Stats banner */}
          <div className="bm-summary-banner">
            <SummaryItem
              color="var(--billing-accent)"
              amount={summaryTotal.toLocaleString()}
              label={g ? 'Transactions' : resultsActive ? 'Results' : 'Loaded'}
              sub={
                g
                  ? rows.length < g.total
                    ? `${rows.length.toLocaleString()} loaded`
                    : 'all loaded'
                  : hasMore
                    ? `of ${totalFetched.toLocaleString()} total`
                    : 'all loaded'
              }
            />
            <SummaryItem
              color="var(--success-text)"
              amount={fmtCurrency(summaryAmount)}
              label="Total Amount"
              sub={g ? 'all sources' : resultsActive ? 'filtered' : 'this page'}
            />
            <SummaryItem
              color="var(--purple-text)"
              amount={String(summaryMapped)}
              label="Invoice Mapped"
              sub={summaryDenom ? `${Math.round((summaryMapped / summaryDenom) * 100)}%` : '—'}
            />
            <SummaryItem
              color="var(--danger-text)"
              amount={String(summaryUnmapped)}
              label="Invoice Unmapped"
              sub="needs review"
            />
          </div>

          {/* Toolbar */}
          <div className="bm-toolbar">
            <div className="bm-search-bar" style={{ flex: 1, minWidth: 140 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search by sender, memo, transaction #…" autoComplete="off" />
              {searchFetching ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>loading all…</span>
              ) : search ? (
                <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>

            <select value={source} onChange={(e) => setSource(e.target.value as 'all' | TxSource)} className="bm-select">
              {SOURCE_OPTIONS.map((f) => {
                // Whole-dataset counts (fall back to loaded counts until stats arrive).
                const count = stats
                  ? f.id === 'all'
                    ? stats.total
                    : (stats.bySource[f.id] ?? 0)
                  : f.id === 'all'
                    ? rows.length
                    : (sourceCounts[f.id] ?? 0);
                return (
                  <option key={f.id} value={f.id}>
                    {f.label} {count > 0 ? `(${count})` : ''}
                  </option>
                );
              })}
            </select>

            <select value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)} className="bm-select">
              {CARRIER_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* List */}
          <div className="bm-table-wrap" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {filtered.length === 0 ? (
              <div className="bm-empty">
                <svg width="36" height="36" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <div className="bm-empty-label">No transactions found</div>
                <div className="bm-empty-sub">Try adjusting your search or filters.</div>
              </div>
            ) : (
              <div className="tx-list-scroll">
                {groups.map((group) => (
                  <div key={group.date}>
                    <div className="tx-date-sep">
                      <span>{dateLabel(group.date)}</span>
                      <span style={{ fontSize: '0.5625rem', fontWeight: 600, marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                        {group.items.length} txn · {fmtCurrency(group.total)}
                      </span>
                    </div>
                    {group.items.map((tx) => (
                      <div key={tx.recordId} className="tx-row" onClick={() => setOpenId(tx.recordId)} title="Click to view details">
                        <div className={`tx-source-badge tx-source-${tx.source}`}>{txSourceLabel(tx.source)}</div>
                        <div className="tx-body">
                          <div className="tx-sender">
                            {/* Card payments (Stripe) carry no payer name — build the widget-style
                                "Payment - $500.00 - succeeded" label instead of showing a blank. */}
                            {tx.sender ||
                              tx.name ||
                              `Payment - ${fmtCurrency(tx.amount)}${tx.status ? ` - ${tx.status}` : ''}`}
                          </div>
                          <div className="tx-meta">
                            {tx.memo ? (
                              <span className="tx-memo" title={tx.memo}>
                                {tx.memo}
                              </span>
                            ) : null}
                            {tx.memo && tx.txn ? <span style={{ opacity: 0.3 }}>·</span> : null}
                            {tx.txn ? (
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', opacity: 0.5 }}>#{tx.txn}</span>
                            ) : null}
                            {(tx.source === 'mx' || tx.source === 'stripe') && tx.status && (tx.sender || tx.name) ? (
                              <span className={`bm-badge ${txStatusBadgeClass(tx.source, tx.status)}`} style={{ fontSize: '0.55rem', padding: '0.1rem 0.4rem', marginLeft: '0.25rem' }}>
                                {tx.status}
                              </span>
                            ) : null}
                            {tx.isReturned ? (
                              <span
                                className="bm-badge"
                                title="This payment was returned / charged back — the money was reversed in CMP. The mapping is kept for reference."
                                style={{ fontSize: '0.55rem', padding: '0.1rem 0.45rem', marginLeft: '0.25rem', fontWeight: 800, background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border)' }}
                              >
                                RETURNED
                              </span>
                            ) : null}
                            {tx.isQuickPay ? (
                              <span
                                className="bm-badge"
                                title="QuickPay payment — must be mapped manually to CMP (not auto-mapped)."
                                style={{ fontSize: '0.55rem', padding: '0.1rem 0.45rem', marginLeft: '0.25rem', fontWeight: 700, background: 'var(--accent-bg)', color: 'var(--billing-accent)', border: '1px solid var(--accent-border-strong)' }}
                              >
                                QUICKPAY
                              </span>
                            ) : null}
                            {/* Zelle auto-map suggestion badge (parity with the widget) — only when
                                there IS a positive suggestion; the "why not" reasons show in the modal. */}
                            {(() => {
                              const amf = computeAutoMapFlag(tx, memoryIndex);
                              return amf && amf.kind !== 'none' ? (
                                <span
                                  className="bm-badge"
                                  title="A carrier id suggestion is available — open to review and map."
                                  style={{ fontSize: '0.55rem', padding: '0.1rem 0.45rem', marginLeft: '0.25rem', fontWeight: 700, letterSpacing: '0.03em', background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid var(--success-border)' }}
                                >
                                  AUTO-MAP
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        <div className="tx-carrier-col">
                          {tx.isInvoiceMapped ? (
                            <span className="bm-badge tx-carrier-badge" style={{ background: 'var(--purple-bg)', color: 'var(--purple-text)', border: '1px solid var(--purple-border)' }}>
                              <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                              </svg>
                              Invoice Mapped
                            </span>
                          ) : tx.carrierId ? (
                            <span className="bm-badge bm-badge-success tx-carrier-badge">
                              <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                              </svg>
                              {tx.carrierId}
                            </span>
                          ) : (
                            <span className="bm-badge bm-badge-muted tx-carrier-badge" style={{ opacity: 0.5 }}>
                              Unmapped
                            </span>
                          )}
                        </div>
                        <div className="tx-amount-col">
                          <span className="tx-amount-value">{fmtCurrency(tx.amount)}</span>
                          <span className="tx-date-inline">{tx.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {(hasMore || loadingMore) && searchResults === null ? (
                  <div className="tx-load-more-row">
                    <button className="tx-load-more-btn" onClick={() => void loadMore()} disabled={loadingMore}>
                      {loadingMore ? (
                        <>
                          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ animation: 'ai-spin 0.8s linear infinite' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
                          </svg>
                          Loading page {curPage + 1}...
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                          Load next 200 transactions
                          <span style={{ opacity: 0.55, fontSize: '0.6rem' }}> · {Math.max(totalFetched - rows.length, 0).toLocaleString()} remaining</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : rows.length > 0 ? (
                  <div className="tx-end-row">All {rows.length.toLocaleString()} transactions loaded</div>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}

      {openTx ? (
        <TransactionModal
          key={openTx.recordId}
          tx={openTx}
          currentUserName={user.userName}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchAndBroadcast(openTx, patch)}
          onToast={notify}
        />
      ) : null}

      {showChaseAdd ? (
        <ChaseAddModal
          onClose={() => setShowChaseAdd(false)}
          onAdded={(msg) => {
            notify('success', msg);
            reload();
          }}
        />
      ) : null}

      {toast ? (
        <div className={`bm-toast bm-toast--${toast.kind}`}>
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={toast.kind === 'success' ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} />
          </svg>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

interface SummaryItemProps {
  /** Accent colour for the value + the 2px left bar (a CSS colour / var). */
  color: string;
  amount: string;
  label: string;
  sub?: string;
}

function SummaryItem({ color, amount, label, sub }: SummaryItemProps) {
  return (
    <div className="bm-summary-item" style={{ '--stat-color': color } as CSSProperties}>
      <div className="bm-summary-label">{label}</div>
      <div className="bm-summary-amount">{amount}</div>
      {sub ? <div className="bm-summary-sub">{sub}</div> : null}
    </div>
  );
}
