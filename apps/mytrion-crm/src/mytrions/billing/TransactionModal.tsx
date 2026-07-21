/**
 * Transaction detail modal — 1:1 port of the widget's detail-modal template + carrier/invoice/
 * prepay/split/unmap flows (transactions-panel.js), wired to the LIVE billing.* write touchpoints.
 * The WebSocket real-time layer (remoteLock / _broadcastMapping / _applyRemoteEvent) is deliberately
 * omitted for Phase 1.
 *
 * Identity (mappedBy/unmappedBy) is injected server-side from the session; the UI never sends it.
 * `mappedBy` is set locally ONLY for the optimistic audit avatar — the authoritative value returns
 * on the next fetch.
 */
import { useEffect, useRef, useState } from 'react';

import {
  applySplits as applySplitsApi,
  billingTouchpoint,
  fuzzyCarrier,
  mapTransaction,
  saveCarrierMemory,
  searchCarrierInvoices,
  syncCrmOnly as syncCrmOnlyApi,
  topUpTransaction,
  unmapTransaction,
} from '@/api/billing';
import { dateFull, fmtCurrency, srcLabel } from './data';
import {
  BM_SAVE_MSG_MS,
  type CarrierInvoiceSearch,
  type FuzzyCarrier,
  type InvoiceOption,
  type SplitAllocation,
  type SplitType,
  type TxRow,
  fmtDateTime,
  fmtShortDate,
  initialsOf,
  isJunkCompanyName,
  mappingTypeBadgeStyle,
  parseInvoiceRefs,
  parseSplitAllocations,
  readNum,
  readStr,
  toCarrierInvoiceSearch,
  toFuzzyCarriers,
  toInvoiceOption,
  txStatusBadgeClass,
  zohoTimestamp,
} from './transactionModel';

type ToastKind = 'success' | 'error';
type SaveMsg = { type: ToastKind; text: string } | null;

interface SplitResultPart {
  carrierId?: string;
  invoiceNumber?: string;
  amount?: number | string;
  paymentId?: string | number;
  status?: string;
  message?: string;
}
interface SplitResult {
  status: string;
  message?: string;
  splits?: SplitResultPart[];
}

interface SplitDraft {
  type: SplitType;
  carrierId: string;
  searching: boolean;
  searched: boolean;
  invoiceOptions: InvoiceOption[];
  selectedInvoice: InvoiceOption | null;
  isPrepayCarrier: boolean;
  amount: number;
  error: string;
}

const EMPTY_DRAFT: SplitDraft = {
  type: 'invoice',
  carrierId: '',
  searching: false,
  searched: false,
  invoiceOptions: [],
  selectedInvoice: null,
  isPrepayCarrier: false,
  amount: 0,
  error: '',
};

const SPIN = 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface TransactionModalProps {
  tx: TxRow;
  currentUserName: string;
  onClose: () => void;
  onPatch: (patch: Partial<TxRow>) => void;
  onToast: (kind: ToastKind, message: string) => void;
}

export function TransactionModal({ tx, currentUserName, onClose, onPatch, onToast }: TransactionModalProps) {
  /* ── Single-carrier search state ── */
  const [carrierInput, setCarrierInput] = useState(tx.carrierId ?? '');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<CarrierInvoiceSearch | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceOption | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [note, setNote] = useState('');
  const [saveMsg, setSaveMsg] = useState<SaveMsg>(null);
  /* ── Prepay ── */
  const [isPrepay, setIsPrepay] = useState(false);
  const [prepayLoading, setPrepayLoading] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState(tx.amount);
  const [toppingUp, setToppingUp] = useState(false);
  /* ── Sync CRM only ── */
  const [syncing, setSyncing] = useState(false);
  const [syncingRef, setSyncingRef] = useState<string | null>(null);
  /* ── Unmap ── */
  const [unmapping, setUnmapping] = useState(false);
  const [confirmingUnmap, setConfirmingUnmap] = useState(false);
  /* ── Fuzzy suggestions ── */
  const [fuzzy, setFuzzy] = useState<FuzzyCarrier[]>([]);
  const [fuzzyLoading, setFuzzyLoading] = useState(false);
  /* ── Split ── */
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitAllocation[]>([]);
  const [draft, setDraft] = useState<SplitDraft>(EMPTY_DRAFT);
  const [applyingSplits, setApplyingSplits] = useState(false);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaved = (text: string): void => {
    setSaveMsg({ type: 'success', text });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveMsg(null), BM_SAVE_MSG_MS);
  };

  /* Fuzzy carrier suggestions on open (unmapped only). */
  useEffect(() => {
    if (tx.isInvoiceMapped) return;
    const sender = tx.sender || tx.name;
    if (!sender && !tx.email && !tx.description) return;
    let off = false;
    setFuzzyLoading(true);
    void fuzzyCarrier({
      senderName: sender,
      description: tx.description,
      email: tx.email,
    })
      .then((data) => {
        if (!off && readStr(data.status) === 'success') setFuzzy(toFuzzyCarriers(data));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!off) setFuzzyLoading(false);
      });
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const companyName = (tx.sender || tx.name || '').trim();

  /* ── Optimistic map / unmap (mirrors _applyMapping / _applyUnmap, minus broadcast) ── */
  function applyMapping(carrierId: string, mappingType: string): void {
    const patch: Partial<TxRow> = {
      carrierId,
      isInvoiceMapped: true,
      mappedBy: currentUserName,
      mappedAt: zohoTimestamp(),
      mappingType,
    };
    // Show the Unmap button immediately: CMP_Ref / Split_Allocations are written server-side and
    // only appear on the next fetch, so set a UI-only placeholder now (skip for CRM-Sync, which
    // already satisfies the unmap condition via its mapping_type).
    if (!tx.cmpRef && !tx.splitAllocationsRaw && !mappingType.startsWith('CRM-Sync')) {
      patch.cmpRef = '__remote__';
    }
    onPatch(patch);
    saveMemory(carrierId);
  }

  function applyUnmap(): void {
    onPatch({
      carrierId: null,
      isInvoiceMapped: false,
      mappedBy: '',
      mappedAt: '',
      mappingType: '',
      cmpRef: '',
      splitAllocationsRaw: '',
    });
  }

  function saveMemory(carrierId: string): void {
    if (!companyName || isJunkCompanyName(companyName)) return;
    void saveCarrierMemory(companyName, carrierId.trim()).catch(() => undefined);
  }

  /* ── Carrier search (invoices + prepay type) ── */
  async function searchCarrier(): Promise<void> {
    const cid = carrierInput.trim();
    if (!cid || searching) return;
    setSearching(true);
    setPrepayLoading(true);
    setSearchError('');
    setResults(null);
    setSelectedInvoice(null);
    setIsPrepay(false);
    const [invRes, typeRes] = await Promise.allSettled([
      searchCarrierInvoices(cid),
      billingTouchpoint('billing.carrier.type', { carrierId: cid }),
    ]);
    try {
      if (invRes.status === 'rejected') throw new Error('Invoice search failed');
      const inv = invRes.value;
      if (readStr(inv.status) !== 'success') throw new Error(readStr(inv.message) || 'Search failed');
      setResults(toCarrierInvoiceSearch(inv, cid));
      if (typeRes.status === 'fulfilled') {
        const t = typeRes.value;
        if (t.success === true) setIsPrepay(t.isPrepay === true);
      }
    } catch (e) {
      setSearchError('Search failed. ' + errMsg(e));
    } finally {
      setSearching(false);
      setPrepayLoading(false);
    }
  }

  /* ── Map to invoice ── */
  async function assignInvoice(invoice: InvoiceOption): Promise<void> {
    if (assigning) return;
    setAssigning(true);
    setSaveMsg(null);
    try {
      const cid = results?.carrierId || carrierInput.trim();
      const res = await mapTransaction(tx.recordId, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentAmount: tx.amount,
        paymentDate: tx.postingDateRaw,
        note: note.trim(),
        carrierId: cid,
      });
      if (readStr(res.status) !== 'success') throw new Error(readStr(res.message) || 'Update failed');
      setSelectedInvoice(invoice);
      applyMapping(cid, 'Invoice');
      flashSaved(`Assigned to Invoice #${invoice.invoiceNumber}` + (res.paymentId ? ` · Payment #${res.paymentId}` : ''));
      onToast('success', `Carrier ${cid} matched — Invoice #${invoice.invoiceNumber}`);
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'Failed to assign. ' + errMsg(e) });
    } finally {
      setAssigning(false);
    }
  }

  /* ── Prepay top-up ── */
  async function topUp(): Promise<void> {
    if (toppingUp) return;
    setToppingUp(true);
    setSaveMsg(null);
    try {
      const cid = results?.carrierId || carrierInput.trim();
      const res = await topUpTransaction(tx.recordId, {
        carrierId: cid,
        paymentAmount: topUpAmount,
        paymentDate: tx.postingDateRaw,
        note: note.trim(),
      });
      if (readStr(res.status) !== 'success') throw new Error(readStr(res.message) || 'Top-up failed');
      applyMapping(cid, 'Prepay Top-Up');
      flashSaved(
        `Top-up applied — ${fmtCurrency(topUpAmount || 0)} to Carrier ${cid}` +
          (res.topUpId ? ` · Ref #${res.topUpId}` : ''),
      );
      onToast('success', `Prepay top-up applied — Carrier ${cid}`);
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'Top-up failed. ' + errMsg(e) });
    } finally {
      setToppingUp(false);
    }
  }

  /* ── Sync CRM only (CMP payment pre-existed) ── */
  async function syncCRMOnly(invoice: InvoiceOption | null): Promise<void> {
    if (syncing) return;
    setSyncing(true);
    setSyncingRef(invoice ? invoice.invoiceNumber : 'prepay');
    setSaveMsg(null);
    try {
      const cid = results?.carrierId || carrierInput.trim();
      const res = await syncCrmOnlyApi(tx.recordId, {
        carrierId: cid,
        invoiceNumber: invoice ? invoice.invoiceNumber : '',
      });
      if (readStr(res.status) !== 'success') throw new Error(readStr(res.message) || 'Sync failed');
      setSelectedInvoice(invoice);
      applyMapping(cid, invoice ? 'CRM-Sync (Invoice)' : 'CRM-Sync (Prepay)');
      const ctx = invoice ? `Invoice #${invoice.invoiceNumber}` : 'Prepay Top-Up';
      flashSaved(`CRM synced — ${ctx} (CMP payment was pre-existing)`);
      onToast('success', `CRM synced — Carrier ${cid} · ${ctx}`);
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'Sync failed. ' + errMsg(e) });
    } finally {
      setSyncing(false);
      setSyncingRef(null);
    }
  }

  /* ── Unmap (reverse CMP + clear CRM) ── */
  async function unmap(): Promise<void> {
    if (unmapping) return;
    setUnmapping(true);
    setSaveMsg(null);
    try {
      const res = await unmapTransaction(tx.recordId, 'true');
      if (readStr(res.status) === 'partial') {
        setSaveMsg({ type: 'error', text: readStr(res.message) || 'Partial reversal — reconcile CMP manually.' });
        onToast('error', 'Unmap incomplete — manual CMP reconciliation needed');
        return;
      }
      if (readStr(res.status) !== 'success') throw new Error(readStr(res.message) || 'Unmap failed');
      const wasCrmSync = tx.mappingType.startsWith('CRM-Sync');
      applyUnmap();
      setConfirmingUnmap(false);
      const n = Array.isArray(res.reversed) ? res.reversed.length : 0;
      if (n > 0) {
        flashSaved(`Unmapped — carrier & mapping cleared · ${n} CMP reversal(s)`);
        onToast('success', 'Transaction unmapped');
      } else if (wasCrmSync) {
        flashSaved('Unmapped — CRM cleared (CMP payment was pre-existing)');
        onToast('success', 'Transaction unmapped');
      } else {
        setSaveMsg({
          type: 'error',
          text:
            readStr(res.message) ||
            'CRM cleared — reverse the payment/top-up in CMP manually (no stored CMP reference).',
        });
        onToast('error', 'CRM cleared — reverse CMP manually');
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'Unmap failed. ' + errMsg(e) });
    } finally {
      setUnmapping(false);
    }
  }

  /* ── Split-mapping helpers ── */
  const splitTotal = round2(splits.reduce((s, a) => s + (a.amount || 0), 0));
  const splitRemaining = round2(tx.amount - splitTotal);
  const canApplySplits = splits.length >= 2 && splitRemaining >= 0 && !applyingSplits;
  const canAddDraft = (() => {
    const amt = draft.amount || 0;
    if (!draft.carrierId.trim() || amt <= 0) return false;
    if (amt > splitRemaining + 0.001) return false;
    if ((draft.type === 'invoice' || draft.type === 'syncOnly') && !draft.selectedInvoice) return false;
    return true;
  })();

  function toggleSplitMode(): void {
    if (splitMode) {
      setSplitMode(false);
      setSplits([]);
      setDraft(EMPTY_DRAFT);
      setSplitResult(null);
    } else {
      setResults(null);
      setSelectedInvoice(null);
      setSearchError('');
      setIsPrepay(false);
      setPrepayLoading(false);
      setSplitMode(true);
      setDraft({ ...EMPTY_DRAFT, amount: tx.amount });
    }
  }

  async function searchDraftCarrier(): Promise<void> {
    const cid = draft.carrierId.trim();
    if (!cid || draft.searching) return;
    setDraft((d) => ({ ...d, searching: true, error: '', invoiceOptions: [], selectedInvoice: null, isPrepayCarrier: false }));
    const [invRes, typeRes] = await Promise.allSettled([
      searchCarrierInvoices(cid),
      billingTouchpoint('billing.carrier.type', { carrierId: cid }),
    ]);
    try {
      if (invRes.status === 'rejected') throw new Error('Invoice search failed');
      const inv = invRes.value;
      if (readStr(inv.status) !== 'success') throw new Error(readStr(inv.message) || 'Search failed');
      const options = Array.isArray(inv.invoices) ? (inv.invoices as Record<string, unknown>[]).map(toInvoiceOption) : [];
      const prepay = typeRes.status === 'fulfilled' && typeRes.value.success === true && typeRes.value.isPrepay === true;
      setDraft((d) => ({ ...d, invoiceOptions: options, isPrepayCarrier: prepay, searching: false, searched: true }));
    } catch (e) {
      setDraft((d) => ({ ...d, error: 'Search failed. ' + errMsg(e), searching: false, searched: true }));
    }
  }

  function addSplitAllocation(): void {
    if (!canAddDraft) return;
    const alloc: SplitAllocation = {
      type: draft.type,
      carrierId: draft.carrierId.trim(),
      amount: round2(draft.amount),
    };
    if ((draft.type === 'invoice' || draft.type === 'syncOnly') && draft.selectedInvoice) {
      alloc.invoiceId = draft.selectedInvoice.id;
      alloc.invoiceNumber = draft.selectedInvoice.invoiceNumber;
    }
    const nextRemaining = round2(tx.amount - (splitTotal + alloc.amount));
    setSplits((prev) => [...prev, alloc]);
    setDraft({ ...EMPTY_DRAFT, amount: nextRemaining });
  }

  function removeSplitAllocation(index: number): void {
    setSplits((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setDraft((d) => ({ ...d, amount: round2(tx.amount - next.reduce((s, a) => s + a.amount, 0)) }));
      return next;
    });
  }

  async function applySplits(): Promise<void> {
    if (!canApplySplits) return;
    setApplyingSplits(true);
    setSplitResult(null);
    setSaveMsg(null);
    try {
      const payload = splits.map((a) => {
        const entry: Record<string, unknown> = { type: a.type, carrierId: a.carrierId, amount: a.amount, note: note || '' };
        if (a.type === 'invoice') {
          entry.invoiceId = a.invoiceId;
          entry.invoiceNumber = a.invoiceNumber;
        }
        return entry;
      });
      const res = await applySplitsApi(tx.recordId, JSON.stringify(payload));
      const status = readStr(res.status);
      const parsed: SplitResult = { status };
      if (readStr(res.message)) parsed.message = readStr(res.message);
      if (Array.isArray(res.splits)) parsed.splits = res.splits as SplitResultPart[];
      setSplitResult(parsed);
      if (status === 'success') {
        const first = splits[0];
        if (first) applyMapping(first.carrierId, 'Split');
        for (const a of splits) saveMemory(a.carrierId);
        flashSaved(`Split applied — ${readNum(res.appliedCount)} allocations across ${splits.length} carriers`);
        onToast('success', `Split mapped — ${splits.length} carriers`);
      } else if (status === 'partial') {
        setSaveMsg({
          type: 'error',
          text: readStr(res.message) || `Stopped at split #${readNum(res.appliedCount)} — manual CMP reconciliation needed`,
        });
      } else {
        throw new Error(readStr(res.message) || 'Apply failed');
      }
    } catch (e) {
      setSplitResult({ status: 'error', message: errMsg(e) });
      setSaveMsg({ type: 'error', text: 'Split apply failed. ' + errMsg(e) });
    } finally {
      setApplyingSplits(false);
    }
  }

  /* ── Derived (already-mapped audit view) ── */
  const parsedSplits = parseSplitAllocations(tx.splitAllocationsRaw);
  const invoiceRefs = parseInvoiceRefs(tx.cmpRef, parsedSplits);
  const showUnmap =
    tx.isInvoiceMapped && (!!tx.cmpRef || !!tx.splitAllocationsRaw || tx.mappingType.startsWith('CRM-Sync'));
  const editable = !tx.isInvoiceMapped;

  return (
    <div className="bm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bm-modal-box tx-detail-modal">
        {/* Accent header */}
        <div className={`tx-modal-accent-hdr tx-modal-accent-${tx.source}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <div className={`tx-source-badge-lg tx-source-${tx.source}`}>{srcLabel(tx.source)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="tx-modal-sender">{tx.sender || tx.name}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                {tx.source.toUpperCase()} · {dateFull(tx.postingDate)}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="tx-modal-amount">{fmtCurrency(tx.amount)}</div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--surface-raised)',
                border: 'none',
                borderRadius: 2,
                width: 28,
                height: 28,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 'auto',
                marginTop: '0.375rem',
                color: 'var(--text-secondary)',
              }}
            >
              <Icon d="M6 18L18 6M6 6l12 12" size={13} w={2.5} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="bm-modal-body">
          {/* Transaction details */}
          <div className="tx-detail-section">
            <div className="tx-detail-section-title">Transaction Details</div>
            {tx.source === 'stripe' ? (
              <>
                <FieldRow label="Transaction ID" mono value={tx.transactionId || '—'} />
                <FieldRow label="Customer ID" mono value={tx.customerId || '—'} />
                <FieldRow label="Email" value={tx.email || '—'} />
                <div className="bm-field-row">
                  <span className="bm-field-label">Status</span>
                  <span className="bm-field-value">
                    <span className={`bm-badge ${txStatusBadgeClass('stripe', tx.status)}`}>{tx.status || '—'}</span>
                  </span>
                </div>
                <FieldRow label="Card" value={`${tx.cardBrand} ···· ${tx.cardLast4}`} />
                {tx.receiptUrl ? (
                  <div className="bm-field-row">
                    <span className="bm-field-label">Receipt</span>
                    <a
                      href={tx.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bm-field-value"
                      style={{ color: 'var(--billing-accent)', textDecoration: 'underline' }}
                    >
                      View Receipt
                    </a>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <FieldRow label="Transaction #" mono value={tx.txn || '—'} />
                {tx.memo ? (
                  <div className="bm-field-row" style={{ alignItems: 'flex-start' }}>
                    <span className="bm-field-label">Memo</span>
                    <span className="bm-field-value" style={{ textAlign: 'right', lineHeight: 1.5, fontStyle: 'italic' }}>
                      {tx.memo}
                    </span>
                  </div>
                ) : null}
                {tx.description ? (
                  <div className="bm-field-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '0.375rem' }}>
                    <span className="bm-field-label">Description</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {tx.description}
                    </span>
                  </div>
                ) : null}
              </>
            )}
            <FieldRow label="Record ID" mono muted value={tx.recordId} />
            <div className="bm-field-row">
              <span className="bm-field-label">Source</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className={`bm-field-value tx-source-badge tx-source-${tx.source}`} style={{ fontSize: '0.6875rem' }}>
                  {srcLabel(tx.source)}
                </span>
                {tx.isQuickPay ? (
                  <span
                    className="bm-badge"
                    title="QuickPay — map manually to CMP"
                    style={{ fontSize: '0.6rem', fontWeight: 700, background: 'var(--accent-bg)', color: 'var(--billing-accent)', border: '1px solid var(--accent-border-strong)' }}
                  >
                    QuickPay
                  </span>
                ) : null}
              </span>
            </div>
            <FieldRow label="Posting Date" value={dateFull(tx.postingDate)} />
            <div className="bm-field-row">
              <span className="bm-field-label">Amount</span>
              <span
                className="bm-field-value"
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9375rem', fontWeight: 700, color: 'var(--success-text)' }}
              >
                {fmtCurrency(tx.amount)}
              </span>
            </div>
          </div>

          {/* Carrier assignment */}
          <div className="tx-detail-section">
            <div className="tx-detail-section-title">Carrier Assignment</div>

            {/* Current status */}
            <div className="bm-field-row">
              <span className="bm-field-label">Status</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                {tx.carrierId ? (
                  <span className="bm-badge bm-badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Icon d="M5 13l4 4L19 7" size={9} w={3} />
                    Matched · {tx.carrierId}
                  </span>
                ) : (
                  <span className="bm-badge bm-badge-danger">Unmatched</span>
                )}
                {tx.isInvoiceMapped ? (
                  <span
                    className="bm-badge"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'var(--purple-bg)', color: 'var(--purple-text)', border: '1px solid var(--purple-border)' }}
                  >
                    <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" size={9} w={2} />
                    Invoice Mapped
                  </span>
                ) : null}
                {tx.isReturned ? (
                  <span
                    className="bm-badge"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 800, background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border)' }}
                  >
                    <Icon d="M3 10h10a5 5 0 015 5v1M3 10l4-4M3 10l4 4" size={9} w={2} />
                    Returned
                  </span>
                ) : null}
              </div>
            </div>

            {/* Returned banner */}
            {tx.isReturned ? (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: 4, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', fontSize: '0.75rem' }}
              >
                <Icon d="M3 10h10a5 5 0 015 5v1M3 10l4-4M3 10l4 4" size={14} w={2} />
                <span>
                  This payment was <strong>returned / charged back</strong> — the amount was reversed in CMP
                  {tx.returnedAt ? ` on ${fmtShortDate(tx.returnedAt)}` : ''}. The mapping is kept for reference.
                </span>
              </div>
            ) : null}

            {editable ? (
              <>
                {/* Proposed carrier IDs (fuzzy) */}
                <div className="tx-carrier-field-group">
                  <label className="tx-field-sublabel" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    Proposed Carrier IDs
                    {fuzzyLoading ? <Spinner size={11} /> : null}
                    {!fuzzyLoading && fuzzy.length > 0 ? (
                      <span style={{ fontSize: '0.6rem', fontWeight: 400, color: 'var(--text-muted)' }}>Click a badge to use it</span>
                    ) : null}
                  </label>
                  {fuzzyLoading ? (
                    <div className="tx-readonly-input" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <Spinner size={12} /> Searching for carrier matches…
                    </div>
                  ) : fuzzy.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', padding: '0.25rem 0' }}>
                      {fuzzy.map((c) => {
                        const isMemory = c.module === 'Memory';
                        return (
                          <span
                            key={c.carrierId}
                            className={`bm-badge${isMemory ? '' : ' bm-badge-success'}`}
                            title={`${c.name} · ${isMemory ? 'Learned from past mapping' : c.module} — Click to use this Carrier ID`}
                            onClick={() => setCarrierInput(c.carrierId)}
                            style={{
                              cursor: 'pointer',
                              fontSize: '0.6875rem',
                              padding: '0.2rem 0.55rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              ...(isMemory
                                ? { background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid var(--warning-border)' }
                                : {}),
                            }}
                          >
                            <Icon d={isMemory ? 'M13 10V3L4 14h7v7l9-11h-7z' : 'M5 13l4 4L19 7'} size={9} w={isMemory ? 2 : 3} />
                            {c.carrierId}
                            <span style={{ opacity: 0.7, fontSize: '0.6rem' }}>
                              {isMemory ? '⚡ ' : ''}
                              {c.name}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.2rem 0' }}>No suggestions found</div>
                  )}
                </div>

                {/* Split toggle */}
                <div className="tx-carrier-field-group" style={{ marginBottom: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={splitMode} onChange={toggleSplitMode} />
                    Split between multiple carriers
                  </label>
                </div>

                {splitMode ? (
                  <SplitSection
                    tx={tx}
                    splits={splits}
                    draft={draft}
                    setDraft={setDraft}
                    splitTotal={splitTotal}
                    splitRemaining={splitRemaining}
                    canAddDraft={canAddDraft}
                    canApplySplits={canApplySplits}
                    applyingSplits={applyingSplits}
                    splitResult={splitResult}
                    onSearchDraft={searchDraftCarrier}
                    onAddSplit={addSplitAllocation}
                    onRemoveSplit={removeSplitAllocation}
                    onApply={applySplits}
                  />
                ) : (
                  <div className="tx-carrier-field-group">
                    <label className="tx-field-sublabel">Carrier ID Lookup</label>
                    <div className="tx-carrier-search-row">
                      <input
                        value={carrierInput}
                        onChange={(e) => setCarrierInput(e.target.value)}
                        type="text"
                        className="tx-carrier-input"
                        placeholder="Enter Carrier ID…"
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void searchCarrier();
                          }
                        }}
                      />
                      <button className="bm-btn bm-btn-primary" style={{ flexShrink: 0 }} disabled={!carrierInput.trim() || searching} onClick={() => void searchCarrier()}>
                        {searching ? <Spinner size={13} /> : <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={13} w={2} />}
                        {searching ? 'Searching…' : 'Search'}
                      </button>
                    </div>
                  </div>
                )}

                {searchError ? (
                  <div className="tx-save-msg error">
                    <Icon d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={13} w={2} />
                    {searchError}
                  </div>
                ) : null}

                {prepayLoading ? (
                  <div className="tx-save-msg" style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    <Spinner size={13} /> Checking account type…
                  </div>
                ) : null}

                {/* Prepay top-up */}
                {results && isPrepay && !prepayLoading ? (
                  <div className="tx-prepay-topup">
                    <div className="tx-prepay-badge">
                      <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" size={12} w={2} />
                      PREPAY ACCOUNT
                    </div>
                    <p className="tx-prepay-info">This carrier uses a prepay balance. Enter the top-up amount below.</p>
                    <div className="tx-carrier-field-group">
                      <label className="tx-field-sublabel">
                        Top-Up Amount <span style={{ opacity: 0.5, fontWeight: 400 }}>(editable)</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>$</span>
                        <input
                          value={topUpAmount || ''}
                          onChange={(e) => setTopUpAmount(parseFloat(e.target.value.replace(',', '.')) || 0)}
                          type="number"
                          step="0.01"
                          min="0"
                          className="tx-carrier-input"
                          style={{ paddingLeft: '1.5rem' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                      <button className="tx-topup-btn" onClick={() => void topUp()} disabled={toppingUp || !topUpAmount || topUpAmount <= 0 || syncing}>
                        {toppingUp ? <Spinner size={14} /> : <Icon d="M5 10l7-7m0 0l7 7m-7-7v18" size={14} w={2} />}
                        {toppingUp ? 'Processing…' : `Top Up ${fmtCurrency(topUpAmount || 0)}`}
                      </button>
                      <button
                        className="bm-btn"
                        style={{ fontSize: '0.75rem', padding: '0.5rem 0.6rem', background: 'var(--purple-bg)', border: '1px solid var(--purple-border)', color: 'var(--purple-text)', borderRadius: '0.375rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', width: '100%' }}
                        disabled={syncing || toppingUp}
                        onClick={() => void syncCRMOnly(null)}
                        title="Payment already applied in CMP — sync CRM record only"
                      >
                        {syncing && syncingRef === 'prepay' ? <Spinner size={12} /> : <Icon d={SPIN} size={12} w={2} />}
                        {syncing && syncingRef === 'prepay' ? 'Syncing…' : 'Already in CMP'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Invoice results */}
                {results && !isPrepay && !prepayLoading ? (
                  <div className="tx-invoice-results">
                    <div className="tx-invoice-results-meta">
                      <span className="tx-invoice-summary-text">{results.summary}</span>
                      <span className="tx-invoice-daterange">{results.dateRange}</span>
                    </div>
                    {results.invoices.map((inv) => {
                      const assigned = selectedInvoice?.invoiceNumber === inv.invoiceNumber;
                      return (
                        <div
                          key={inv.invoiceNumber}
                          className={`tx-invoice-card${assigned ? ' is-assigned' : ''}`}
                          onClick={() => !assigning && void assignInvoice(inv)}
                        >
                          <div className="tx-invoice-top-row">
                            <div>
                              <span className="tx-invoice-num">#{inv.invoiceNumber}</span>
                              <span className="tx-invoice-period">{inv.period}</span>
                            </div>
                            <span className={`bm-badge ${inv.status === 'Paid' ? 'bm-badge-success' : 'bm-badge-warning'}`}>{inv.status}</span>
                          </div>
                          <div className="tx-invoice-amounts">
                            <div className="tx-inv-amount-item">
                              <span className="tx-inv-label">Total</span>
                              <span className="tx-inv-val">{fmtCurrency(inv.totalAmount)}</span>
                            </div>
                            <div className="tx-inv-amount-item">
                              <span className="tx-inv-label">Paid</span>
                              <span className="tx-inv-val" style={{ color: 'var(--success-text)' }}>{fmtCurrency(inv.totalPaid)}</span>
                            </div>
                            {inv.remainingAmount > 0 ? (
                              <div className="tx-inv-amount-item">
                                <span className="tx-inv-label">Remaining</span>
                                <span className="tx-inv-val" style={{ color: 'var(--danger-text)' }}>{fmtCurrency(inv.remainingAmount)}</span>
                              </div>
                            ) : null}
                          </div>
                          {assigned ? (
                            <div className="tx-invoice-assigned-tag">
                              <Icon d="M5 13l4 4L19 7" size={10} w={2.5} />
                              Assigned to this invoice
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <div className="tx-invoice-click-hint" style={{ flex: 1 }}>Click to assign this invoice</div>
                              <button
                                className="bm-btn"
                                style={{ fontSize: '0.65rem', padding: '0.25rem 0.6rem', background: 'var(--purple-bg)', border: '1px solid var(--purple-border)', color: 'var(--purple-text)', borderRadius: '0.375rem', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}
                                disabled={syncing}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void syncCRMOnly(inv);
                                }}
                                title="Payment already applied in CMP — sync CRM record only"
                              >
                                {syncing && syncingRef === inv.invoiceNumber ? <Spinner size={10} /> : <Icon d={SPIN} size={10} w={2} />}
                                {syncing && syncingRef === inv.invoiceNumber ? 'Syncing…' : 'Already in CMP'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Payment note */}
                {results ? (
                  <div className="tx-carrier-field-group" style={{ marginTop: '0.75rem' }}>
                    <label className="tx-field-sublabel">
                      Payment Note <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} type="text" className="tx-carrier-input" placeholder="Add a note for this payment…" autoComplete="off" />
                  </div>
                ) : null}

                {saveMsg ? (
                  <div className={`tx-save-msg ${saveMsg.type}`}>
                    <Icon d={saveMsg.type === 'success' ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} size={13} w={2} />
                    {saveMsg.text}
                  </div>
                ) : null}
              </>
            ) : (
              /* Already-mapped audit view */
              <div style={{ marginTop: '0.75rem' }}>
                {parsedSplits ? <SplitBreakdown allocations={parsedSplits} /> : null}
                <div style={{ marginTop: '0.75rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--purple-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.42rem 0.75rem', background: 'var(--purple-bg)' }}>
                    <Icon d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" size={12} w={2.5} stroke="var(--purple-text)" />
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--purple-text)' }}>Invoice Mapped</span>
                  </div>
                  {tx.mappedBy ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.6rem 0.75rem', background: 'var(--surface-alt)' }}>
                      <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: 'var(--billing-purple)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, boxShadow: '0 0 0 2px var(--purple-border)' }}>
                        {initialsOf(tx.mappedBy)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.mappedBy}</div>
                        {tx.mappedAt ? <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: 2 }}>{fmtDateTime(tx.mappedAt)}</div> : null}
                      </div>
                      {tx.mappingType ? (
                        <span style={{ ...mappingTypeBadgeStyle(tx.mappingType), flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, padding: '0.22rem 0.6rem', borderRadius: '2rem', whiteSpace: 'nowrap' }}>
                          {tx.mappingType}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {invoiceRefs
                    ? invoiceRefs.map((ref, i) => (
                        <div key={`ref-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.6rem 0.75rem', background: 'var(--surface-alt)', borderTop: '1px solid var(--purple-border)' }}>
                          <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, background: 'var(--purple-bg)', border: '1px solid var(--purple-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={15} w={2} stroke="var(--purple-text)" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2 }}>
                              {invoiceRefs.length > 1 ? `Invoice ${i + 1}` : 'Invoice Number'}
                              {ref.carrierId ? <span style={{ textTransform: 'none', letterSpacing: 0 }}> · Carrier {ref.carrierId}</span> : null}
                            </div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {ref.invoiceNumber ? `#${ref.invoiceNumber}` : `ID ${ref.invoiceId}`}
                            </div>
                          </div>
                          {ref.paymentId ? (
                            <div style={{ flexShrink: 0, textAlign: 'right' }}>
                              <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2 }}>Payment</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>#{ref.paymentId}</div>
                            </div>
                          ) : null}
                        </div>
                      ))
                    : null}
                  {showUnmap ? (
                    !confirmingUnmap ? (
                      <div className="tx-unmap-bar">
                        <span className="tx-unmap-hint">Mapped in error?</span>
                        <button className="tx-unmap-btn" disabled={unmapping} onClick={() => setConfirmingUnmap(true)}>
                          <Icon d="M3 10h11a4 4 0 010 8h-1M3 10l4-4M3 10l4 4" size={12} w={2} />
                          Unmap
                        </button>
                      </div>
                    ) : (
                      <div className="tx-unmap-confirm">
                        <div className="tx-unmap-confirm-msg">
                          <Icon d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={14} w={2} />
                          <span>Reverse this mapping in CMP and clear the CRM record? This can&apos;t be undone automatically.</span>
                        </div>
                        <div className="tx-unmap-confirm-actions">
                          <button className="tx-unmap-confirm-yes" disabled={unmapping} onClick={() => void unmap()}>
                            {!unmapping ? <Icon d="M5 13l4 4L19 7" size={12} w={2.5} /> : null}
                            {unmapping ? 'Unmapping…' : 'Confirm Unmap'}
                          </button>
                          <button className="tx-unmap-confirm-no" disabled={unmapping} onClick={() => setConfirmingUnmap(false)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )
                  ) : null}
                </div>
                {saveMsg ? (
                  <div className={`tx-save-msg ${saveMsg.type}`}>
                    <Icon d={saveMsg.type === 'success' ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} size={13} w={2} />
                    {saveMsg.text}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Split section (add form + budget bar + allocations + apply) ───────────── */

interface SplitSectionProps {
  tx: TxRow;
  splits: SplitAllocation[];
  draft: SplitDraft;
  setDraft: React.Dispatch<React.SetStateAction<SplitDraft>>;
  splitTotal: number;
  splitRemaining: number;
  canAddDraft: boolean;
  canApplySplits: boolean;
  applyingSplits: boolean;
  splitResult: SplitResult | null;
  onSearchDraft: () => void;
  onAddSplit: () => void;
  onRemoveSplit: (i: number) => void;
  onApply: () => void;
}

const SPLIT_TYPES: { v: SplitType; l: string }[] = [
  { v: 'invoice', l: 'Invoice' },
  { v: 'prepay', l: 'Prepay' },
  { v: 'syncOnly', l: 'Already in CMP' },
];

function SplitSection(props: SplitSectionProps) {
  const { tx, splits, draft, setDraft, splitTotal, splitRemaining, canAddDraft, canApplySplits, applyingSplits, splitResult, onSearchDraft, onAddSplit, onRemoveSplit, onApply } = props;
  return (
    <div className="tx-split-section" style={{ marginBottom: '0.75rem' }}>
      {/* Budget bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginBottom: '0.75rem' }}>
        <BudgetCell label="Total" value={fmtCurrency(tx.amount)} bg="var(--surface-alt)" border="var(--border)" color="var(--text-primary)" />
        <BudgetCell label="Allocated" value={fmtCurrency(splitTotal)} bg={splitTotal > 0 ? 'var(--purple-bg)' : 'var(--surface-alt)'} border={splitTotal > 0 ? 'var(--purple-border)' : 'var(--border)'} color={splitTotal > 0 ? 'var(--purple-text)' : 'var(--text-muted)'} />
        <BudgetCell
          label="Remaining"
          value={fmtCurrency(splitRemaining)}
          bg={splitRemaining < 0 ? 'var(--danger-bg)' : splitRemaining === 0 ? 'var(--success-bg)' : 'var(--accent-bg)'}
          border={splitRemaining < 0 ? 'var(--danger-border)' : splitRemaining === 0 ? 'var(--success-border)' : 'var(--accent-border)'}
          color={splitRemaining < 0 ? 'var(--danger-text)' : splitRemaining === 0 ? 'var(--success-text)' : 'var(--accent-on)'}
        />
      </div>

      {/* Allocations list */}
      {splits.length ? (
        <div style={{ marginBottom: '0.6rem' }}>
          <label className="tx-field-sublabel" style={{ marginBottom: '0.4rem', display: 'block' }}>Splits ({splits.length})</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {splits.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.4rem 0.6rem' }}>
                <span className="bm-badge" style={splitTypeBadge(a.type)}>{splitTypeLabel(a.type)}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 600 }}>{a.carrierId}</span>
                {a.type === 'invoice' ? <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>#{a.invoiceNumber}</span> : <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{a.type === 'prepay' ? 'top-up' : 'already in CMP'}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', fontWeight: 700, color: 'var(--success-text)' }}>{fmtCurrency(a.amount)}</span>
                <button className="bm-btn" style={{ fontSize: '0.62rem', padding: '0.15rem 0.45rem', background: 'transparent', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', borderRadius: '0.25rem', cursor: 'pointer' }} onClick={() => onRemoveSplit(i)} title="Remove split">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Add form */}
      {splitRemaining > 0 ? (
        <div style={{ border: '1px solid var(--purple-border)', borderRadius: '0.45rem', padding: '0.65rem', background: 'var(--purple-bg)', marginBottom: '0.65rem' }}>
          <label className="tx-field-sublabel" style={{ display: 'block', marginBottom: '0.6rem' }}>
            Split {splits.length + 1}
            {splits.length === 0 ? <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: '0.4rem' }}>— minimum 2 required</span> : null}
          </label>

          {/* Type */}
          <div className="tx-carrier-field-group">
            <label className="tx-field-sublabel">Type</label>
            <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
              {SPLIT_TYPES.map((opt) => (
                <button
                  key={opt.v}
                  className="bm-btn"
                  style={{
                    flex: 1,
                    fontSize: '0.7rem',
                    padding: '0.3rem 0.5rem',
                    borderRadius: '0.3rem',
                    cursor: 'pointer',
                    ...(draft.type === opt.v
                      ? { background: 'var(--purple-border)', border: '1px solid var(--purple-border)', color: 'var(--purple-text)', fontWeight: 600 }
                      : { background: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text-muted)' }),
                  }}
                  onClick={() => setDraft((d) => ({ ...d, type: opt.v, selectedInvoice: null }))}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          {/* Carrier ID */}
          <div className="tx-carrier-field-group">
            <label className="tx-field-sublabel">Carrier ID</label>
            <div className="tx-carrier-search-row">
              <input
                value={draft.carrierId}
                onChange={(e) => setDraft((d) => ({ ...d, carrierId: e.target.value }))}
                type="text"
                className="tx-carrier-input"
                placeholder="Enter Carrier ID…"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSearchDraft();
                  }
                }}
              />
              <button className="bm-btn" style={{ background: 'var(--billing-purple)', borderColor: 'var(--billing-purple)', color: '#fff' }} disabled={!draft.carrierId.trim() || draft.searching} onClick={onSearchDraft}>
                {draft.searching ? <Spinner size={13} /> : <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={13} w={2} />}
                {draft.searching ? 'Searching…' : 'Search'}
              </button>
            </div>
          </div>

          {/* Carrier type feedback */}
          {draft.isPrepayCarrier && draft.type === 'invoice' ? (
            <div className="tx-prepay-topup" style={{ padding: '0.5rem 0.65rem', marginTop: '0.5rem' }}>
              <div className="tx-prepay-badge">
                <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" size={11} w={2} />
                PREPAY ACCOUNT
              </div>
              <p className="tx-prepay-info" style={{ margin: '0.25rem 0 0' }}>This carrier uses a prepay balance — consider switching type to Prepay.</p>
            </div>
          ) : null}
          {draft.type === 'prepay' && draft.searched && !draft.searching ? (
            <div className={`tx-save-msg ${draft.isPrepayCarrier ? 'success' : 'error'}`} style={{ marginTop: '0.4rem' }}>
              <Icon d={draft.isPrepayCarrier ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} size={13} w={2} />
              {draft.isPrepayCarrier ? 'Prepay account confirmed — balance will be topped up.' : 'This carrier is not a Prepay account.'}
            </div>
          ) : null}

          {/* Invoice picker */}
          {(draft.type === 'invoice' || draft.type === 'syncOnly') && draft.invoiceOptions.length ? (
            <div className="tx-carrier-field-group">
              <label className="tx-field-sublabel">Select Invoice</label>
              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.3rem' }}>
                {draft.invoiceOptions.map((inv) => {
                  const sel = draft.selectedInvoice?.invoiceNumber === inv.invoiceNumber;
                  return (
                    <div key={inv.invoiceNumber} className={`tx-invoice-card${sel ? ' is-assigned' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setDraft((d) => ({ ...d, selectedInvoice: inv }))}>
                      <div className="tx-invoice-top-row">
                        <div>
                          <span className="tx-invoice-num">#{inv.invoiceNumber}</span>
                          <span className="tx-invoice-period">{inv.period}</span>
                        </div>
                        <span className={`bm-badge ${inv.status === 'Paid' ? 'bm-badge-success' : 'bm-badge-warning'}`}>{inv.status}</span>
                      </div>
                      <div className="tx-invoice-amounts">
                        <div className="tx-inv-amount-item">
                          <span className="tx-inv-label">Total</span>
                          <span className="tx-inv-val">{fmtCurrency(inv.totalAmount)}</span>
                        </div>
                        <div className="tx-inv-amount-item">
                          <span className="tx-inv-label">Remaining</span>
                          <span className="tx-inv-val" style={{ color: inv.remainingAmount > 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>{fmtCurrency(inv.remainingAmount || 0)}</span>
                        </div>
                      </div>
                      {sel ? (
                        <div className="tx-invoice-assigned-tag">
                          <Icon d="M5 13l4 4L19 7" size={10} w={2.5} />
                          Selected for this split
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Amount */}
          <div className="tx-carrier-field-group">
            <label className="tx-field-sublabel">
              Amount <span style={{ opacity: 0.5, fontWeight: 400 }}>(max {fmtCurrency(splitRemaining)} remaining)</span>
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>$</span>
              <input value={draft.amount || ''} onChange={(e) => setDraft((d) => ({ ...d, amount: parseFloat(e.target.value.replace(',', '.')) || 0 }))} type="text" inputMode="decimal" placeholder="0.00" className="tx-carrier-input" style={{ paddingLeft: '1.5rem' }} />
            </div>
          </div>

          {draft.error ? (
            <div className="tx-save-msg error" style={{ marginTop: '0.35rem' }}>
              <Icon d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={13} w={2} />
              {draft.error}
            </div>
          ) : null}

          <button className="bm-btn bm-btn-primary" style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }} disabled={!canAddDraft} onClick={onAddSplit}>
            <Icon d="M12 4v16m8-8H4" size={13} w={2} />
            Add Split
          </button>
        </div>
      ) : null}

      {/* Apply */}
      <button className="bm-btn bm-btn-primary" style={{ width: '100%', fontSize: '0.8rem', padding: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }} disabled={!canApplySplits} onClick={onApply}>
        {applyingSplits ? <Spinner size={14} /> : <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" size={14} w={2} />}
        {applyingSplits ? 'Applying…' : splits.length < 2 ? 'Add at least 2 splits to apply' : `Apply ${splits.length} splits — ${fmtCurrency(splitTotal)}`}
      </button>

      {splitRemaining > 0 && splits.length >= 2 ? (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.4rem', fontStyle: 'italic' }}>
          {fmtCurrency(splitRemaining)} will remain unmapped after applying
        </div>
      ) : null}

      {/* Result */}
      {splitResult?.splits ? (
        <div style={{ marginTop: '0.65rem' }}>
          <label className="tx-field-sublabel" style={{ marginBottom: '0.4rem', display: 'block' }}>Result</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {splitResult.splits.map((s, i) => (
              <div key={i} className={`tx-save-msg ${s.status === 'success' ? 'success' : 'error'}`}>
                <Icon d={s.status === 'success' ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} size={13} w={2} />
                <span>
                  <strong>{s.carrierId}</strong>
                  {s.invoiceNumber ? ` · #${s.invoiceNumber}` : ''} · {fmtCurrency(readNum(s.amount))}
                  {s.paymentId ? ` · ID ${s.paymentId}` : ''}
                  {s.status !== 'success' ? ` — ${s.message ?? ''}` : ''}
                </span>
              </div>
            ))}
            {splitResult.status === 'partial' ? (
              <div className="tx-save-msg error">
                <Icon d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={13} w={2} />
                {splitResult.message}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Split allocation breakdown (already-mapped view) ──────────────────────── */

function SplitBreakdown({ allocations }: { allocations: { type?: string; carrierId?: string; amount?: string | number; invoiceNumber?: string; status?: string }[] }) {
  const total = allocations.reduce((s, a) => s + readNum(a.amount), 0);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.45rem' }}>
        <Icon d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" size={11} w={2} stroke="var(--purple-text)" />
        <span style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', fontWeight: 600 }}>Split Payment — {allocations.length} parts</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden', background: 'var(--surface-alt)' }}>
        {allocations.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.55rem 0.75rem', borderBottom: i < allocations.length - 1 ? '1px solid var(--border)' : undefined }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--purple-bg)', border: '1px solid var(--purple-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--purple-text)' }}>{i + 1}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.18rem' }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.73rem', color: 'var(--text-primary)', fontWeight: 600 }}>{a.carrierId}</span>
                <span className="bm-badge" style={{ ...splitTypeBadge((a.type as SplitType) ?? 'syncOnly'), fontSize: '0.54rem', padding: '1px 5px' }}>
                  {a.type === 'invoice' ? 'Invoice' : a.type === 'prepay' ? 'Prepay' : 'In CMP'}
                </span>
              </div>
              {a.invoiceNumber ? <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 500 }}>INV #{a.invoiceNumber}</div> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', fontWeight: 700, color: 'var(--success-text)' }}>{fmtCurrency(readNum(a.amount))}</span>
              {a.status === 'success' ? <Icon d="M5 13l4 4L19 7" size={13} w={2.5} stroke="var(--success-text)" /> : a.status === 'error' ? <Icon d="M6 18L18 6M6 6l12 12" size={13} w={2.5} stroke="var(--danger-text)" /> : null}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.45rem 0.75rem', background: 'var(--success-bg)', borderTop: '1px solid var(--success-border)' }}>
          <span style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--success-text)', fontWeight: 600 }}>Total Allocated</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', fontWeight: 700, color: 'var(--success-text)' }}>{fmtCurrency(total)}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Small presentational helpers ──────────────────────────────────────────── */

function FieldRow({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="bm-field-row">
      <span className="bm-field-label">{label}</span>
      <span
        className="bm-field-value"
        style={{
          ...(mono ? { fontFamily: "'JetBrains Mono', monospace", fontSize: muted ? '0.6875rem' : '0.75rem' } : {}),
          ...(muted ? { color: 'var(--text-muted)' } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

function BudgetCell({ label, value, bg, border, color }: { label: string; value: string; bg: string; border: string; color: string }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '0.375rem', padding: '0.45rem 0.6rem', textAlign: 'center' }}>
      <div className="tx-field-sublabel" style={{ marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function splitTypeLabel(type: SplitType): string {
  return type === 'invoice' ? 'Invoice' : type === 'prepay' ? 'Prepay' : 'Already in CMP';
}
function splitTypeBadge(type: SplitType): React.CSSProperties {
  if (type === 'invoice') return { background: 'var(--warning-bg)', color: 'var(--warning-text)', borderColor: 'var(--warning-border)' };
  if (type === 'prepay') return { background: 'var(--purple-bg)', color: 'var(--purple-text)', borderColor: 'var(--purple-border)' };
  return { background: 'var(--surface-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' };
}

function Icon({ d, size = 14, w = 2, stroke = 'currentColor' }: { d: string; size?: number; w?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} fill="none" stroke={stroke} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={w} d={d} />
    </svg>
  );
}

function Spinner({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ animation: 'ai-spin 0.8s linear infinite', flexShrink: 0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SPIN} />
    </svg>
  );
}
