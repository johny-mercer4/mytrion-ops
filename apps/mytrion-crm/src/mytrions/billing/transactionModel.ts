/**
 * Transactions view-model + normalization + formatters — shared by Transactions.tsx (the panel)
 * and TransactionModal.tsx (the detail modal). Ports the widget's `_normalizeTxRecords`, the
 * split/CMP_Ref parsers, and the display helpers from transactions-panel.js (MINUS the WebSocket
 * layer, which is deliberately omitted for Phase 1). Raw records arrive as loose
 * `Record<string, unknown>` (the touchpoints unwrap permissively), so every field is read
 * defensively and mapped onto the strongly-typed `Transaction` view-model from ./data.ts.
 */
import type { CSSProperties } from 'react';

import {
  type Transaction,
  type TxSource,
  fmtCurrency,
  srcLabel,
  toTxSource,
} from './data';

export const BM_TX_PAGE_SIZE = 200;
export const BM_SEARCH_DEBOUNCE_MS = 200;
export const BM_TOAST_MS = 3500;
export const BM_SAVE_MSG_MS = 4000;

/** Source names the server search can't match on text fields — kept local-only (widget parity). */
export const SOURCE_NAMES = ['chase', 'zelle', 'mx', 'stripe'];

type Raw = Record<string, unknown>;

/* ── Raw-field readers ─────────────────────────────────────────────────────── */

export function readStr(v: unknown): string {
  return v == null ? '' : String(v);
}
export function readNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}
export function readBool(v: unknown): boolean {
  return v === true || v === 'true';
}

/* ── View-model ────────────────────────────────────────────────────────────── */

/**
 * The panel row + modal shape. Extends the base `Transaction` (recordId/source/sender/memo/txn/
 * amount/postingDate/time/carrierId/isInvoiceMapped/status) with the extra fields the detail
 * modal and mapping writes need.
 */
export interface TxRow extends Transaction {
  /** Always populated by normalizeTx (narrows the base `status?: string`). */
  status: string;
  /** Fallback display name (widget: `name`) when `sender_name` is empty. */
  name: string;
  /** RAW posting_date (may include a time component) — this is what the writes send back. */
  postingDateRaw: string;
  description: string;
  email: string;
  transactionId: string;
  customerId: string;
  cardBrand: string;
  cardLast4: string;
  receiptUrl: string;
  mappingType: string;
  mappedBy: string;
  mappedAt: string;
  /** Stringified CMP_Ref (single/prepay/legacy mapping); '__remote__' = optimistic placeholder. */
  cmpRef: string;
  /** Stringified Split_Allocations (split mapping). */
  splitAllocationsRaw: string;
  isReturned: boolean;
  returnedAt: string;
  isQuickPay: boolean;
  /** Lower-cased search haystack (sender/name/memo/txn/carrier/amount/source). */
  haystack: string;
}

function buildHaystack(f: {
  sender: string;
  name: string;
  memo: string | null;
  txn: string;
  carrierId: string | null;
  amount: number;
  source: string;
}): string {
  return [f.sender, f.name, f.memo ?? '', f.txn, f.carrierId ?? '', String(f.amount || ''), f.source]
    .join(' ')
    .toLowerCase();
}

/** Date part (yyyy-mm-dd) of a posting_date that may be "yyyy-mm-dd HH:MM:SS" or ISO. */
function datePart(raw: string): string {
  if (!raw) return '';
  if (raw.includes(' ')) return raw.split(' ')[0] ?? raw;
  if (raw.includes('T')) return raw.split('T')[0] ?? raw;
  return raw;
}

/** Port of `_normalizeTxRecords`: one raw record → a typed TxRow. */
export function normalizeTx(raw: Raw): TxRow {
  const source = toTxSource(raw.source);
  const carrierIdVal = readStr(raw.carrier_id) || readStr(raw.Connected_To__s);
  const carrierId = carrierIdVal || null;
  const isInvoiceMapped = readBool(raw.isInvoiceMapped) || readBool(raw.Invoice_Mapped);
  const sender = readStr(raw.sender_name);
  const name = readStr(raw.name);
  const memoStr = readStr(raw.memo);
  const memo = memoStr ? memoStr : null;
  const txn = readStr(raw.transaction_number);
  const amount = readNum(raw.amount);
  const postingDateRaw = readStr(raw.posting_date);
  const postingDate = datePart(postingDateRaw);
  const mxSource = readStr(raw.mx_source) || readStr(raw.Source);

  return {
    recordId: readStr(raw.record_id),
    source,
    sender,
    name,
    memo,
    txn,
    amount,
    postingDate,
    postingDateRaw,
    time: fmtShortDate(postingDate),
    carrierId,
    isInvoiceMapped,
    status: readStr(raw.status),
    description: readStr(raw.description),
    email: readStr(raw.email),
    transactionId: readStr(raw.transaction_id),
    customerId: readStr(raw.customer_id),
    cardBrand: readStr(raw.card_brand),
    cardLast4: readStr(raw.card_last4),
    receiptUrl: readStr(raw.receipt_url),
    mappingType: readStr(raw.mapping_type) || (source === 'mx' && isInvoiceMapped ? 'Auto-Mapped' : ''),
    mappedBy: readStr(raw.mapped_by),
    mappedAt: readStr(raw.mapped_at),
    cmpRef: (readStr(raw.CMP_Ref) || readStr(raw.cmp_ref)).trim(),
    splitAllocationsRaw: (readStr(raw.Split_Allocations) || readStr(raw.split_allocations)).trim(),
    isReturned: readBool(raw.isReturned) || readBool(raw.Is_Returned),
    returnedAt: readStr(raw.returned_at),
    isQuickPay: source === 'mx' && mxSource.toLowerCase() === 'quickpay',
    haystack: buildHaystack({ sender, name, memo, txn, carrierId, amount, source }),
  };
}

/** Rebuild the search haystack after an optimistic map/unmap patch. */
export function rebuildHaystack(t: TxRow): string {
  return buildHaystack(t);
}

/** Extract the record array from the paged/search payload (transactions | records). */
export function extractRecords(data: { transactions?: Raw[]; records?: Raw[] }): Raw[] {
  return data.transactions ?? data.records ?? [];
}

/* ── Carrier-search / invoice / split types ────────────────────────────────── */

export interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  period: string;
  status: string;
  totalAmount: number;
  totalPaid: number;
  remainingAmount: number;
}

export interface CarrierInvoiceSearch {
  carrierId: string;
  summary: string;
  dateRange: string;
  invoices: InvoiceOption[];
}

export interface FuzzyCarrier {
  carrierId: string;
  name: string;
  module: string;
}

export type SplitType = 'invoice' | 'prepay' | 'syncOnly';

export interface SplitAllocation {
  type: SplitType;
  carrierId: string;
  amount: number;
  invoiceId?: string;
  invoiceNumber?: string;
}

export function toInvoiceOption(raw: Raw): InvoiceOption {
  return {
    id: readStr(raw.id),
    invoiceNumber: readStr(raw.invoiceNumber),
    period: readStr(raw.period),
    status: readStr(raw.status),
    totalAmount: readNum(raw.totalAmount),
    totalPaid: readNum(raw.totalPaid),
    remainingAmount: readNum(raw.remainingAmount),
  };
}

/** Map a `/billing/invoices/search` payload → the carrier invoice view-model. */
export function toCarrierInvoiceSearch(data: Raw, fallbackCarrierId: string): CarrierInvoiceSearch {
  const invoicesRaw = Array.isArray(data.invoices) ? (data.invoices as Raw[]) : [];
  return {
    carrierId: readStr(data.carrierId) || fallbackCarrierId,
    summary: readStr(data.summary),
    dateRange: readStr(data.dateRange),
    invoices: invoicesRaw.map(toInvoiceOption),
  };
}

/** Map a `billing.carrier.fuzzy` payload → the suggestion chips (carriers | matches). */
export function toFuzzyCarriers(data: Raw): FuzzyCarrier[] {
  const list = Array.isArray(data.carriers)
    ? (data.carriers as Raw[])
    : Array.isArray(data.matches)
      ? (data.matches as Raw[])
      : [];
  return list
    .map((c) => ({ carrierId: readStr(c.carrierId), name: readStr(c.name), module: readStr(c.module) }))
    .filter((c) => c.carrierId);
}

/* ── Split / CMP_Ref parsers (widget parity) ───────────────────────────────── */

export interface ParsedSplit {
  type?: string;
  carrierId?: string;
  amount?: string | number;
  invoiceNumber?: string;
  invoiceId?: string;
  paymentId?: string;
  status?: string;
}

/** Parse Split_Allocations — a proper JSON array, a single object, or Deluge's bracket-less list. */
export function parseSplitAllocations(raw: string): ParsedSplit[] | null {
  const s = (raw || '').trim();
  if (!s || s === 'null' || s === '[]') return null;
  try {
    const arr: unknown = JSON.parse(s);
    if (Array.isArray(arr) && arr.length > 0) return arr as ParsedSplit[];
    if (arr && typeof arr === 'object') return [arr as ParsedSplit];
  } catch {
    /* fall through */
  }
  try {
    const arr: unknown = JSON.parse('[' + s + ']');
    return Array.isArray(arr) && arr.length > 0 ? (arr as ParsedSplit[]) : null;
  } catch {
    return null;
  }
}

export interface InvoiceRef {
  invoiceNumber?: string | undefined;
  invoiceId?: string | undefined;
  paymentId?: string | undefined;
  amount?: string | number | undefined;
  carrierId?: string | undefined;
}

/** Surface every CMP invoice a tx was mapped to — CMP_Ref (single) + split allocations. */
export function parseInvoiceRefs(cmpRef: string, splits: ParsedSplit[] | null): InvoiceRef[] | null {
  const out: InvoiceRef[] = [];
  const seen = new Set<string>();
  const push = (o: InvoiceRef): void => {
    if (!o.invoiceNumber && !o.invoiceId) return;
    const key = `${o.invoiceNumber ?? ''}|${o.invoiceId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(o);
  };

  const raw = (cmpRef || '').trim();
  if (raw && raw !== 'null' && raw !== '{}' && raw !== '__remote__') {
    let ref: Record<string, unknown> | null = null;
    try {
      const obj: unknown = JSON.parse(raw);
      if (obj && typeof obj === 'object') ref = obj as Record<string, unknown>;
    } catch {
      /* fall through to loose parse */
    }
    if (!ref) {
      ref = {};
      const grab = (key: string): string | undefined => {
        const m = raw.match(new RegExp('"?' + key + '"?\\s*[:=]\\s*"?([^",}]+)"?', 'i'));
        return m && m[1] ? m[1].trim() : undefined;
      };
      ref.invoiceNumber = grab('invoiceNumber');
      ref.invoiceId = grab('invoiceId');
      ref.paymentId = grab('paymentId');
      ref.amount = grab('amount');
    }
    push({
      invoiceNumber: readStr(ref.invoiceNumber) || undefined,
      invoiceId: readStr(ref.invoiceId) || undefined,
      paymentId: readStr(ref.paymentId) || undefined,
      amount: ref.amount as string | number | undefined,
    });
  }

  if (Array.isArray(splits)) {
    for (const a of splits) {
      push({
        invoiceNumber: a.invoiceNumber,
        invoiceId: a.invoiceId,
        paymentId: a.paymentId,
        amount: a.amount,
        carrierId: a.carrierId,
      });
    }
  }

  return out.length ? out : null;
}

/* ── Formatters ────────────────────────────────────────────────────────────── */

function toDate(raw: string): Date | null {
  if (!raw) return null;
  const iso = raw.includes(' ') ? raw.replace(' ', 'T') : raw.length <= 10 ? raw + 'T12:00:00' : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short inline date, e.g. "Jun 9". */
export function fmtShortDate(raw: string): string {
  const d = toDate(raw);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : raw || '—';
}

/** Date + time for audit display, e.g. "Jun 9, 2026, 2:30 PM". */
export function fmtDateTime(raw: string): string {
  const d = toDate(raw);
  if (!d) return raw || '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Row source badge label ("Zelle" / "MX" / …). */
export function txSourceLabel(src: TxSource): string {
  return srcLabel(src);
}

/** Status pill class for MX / Stripe transaction statuses. */
export function txStatusBadgeClass(source: TxSource, status: string): string {
  const s = (status || '').toLowerCase();
  if (source === 'mx') {
    if (s === 'settled' || s === 'approved') return 'bm-badge-success';
    if (s === 'declined') return 'bm-badge-danger';
    return 'bm-badge-muted';
  }
  if (source === 'stripe') {
    if (s === 'succeeded') return 'bm-badge-success';
    if (s === 'failed' || s === 'blocked') return 'bm-badge-danger';
    return 'bm-badge-muted';
  }
  return 'bm-badge-muted';
}

/** Color-coded inline style per mapping type (audit badge). */
export function mappingTypeBadgeStyle(type: string): CSSProperties {
  const map: Record<string, CSSProperties> = {
    Invoice: { color: 'var(--success-text)', background: 'var(--success-bg)', border: '1px solid var(--success-border)' },
    'Prepay Top-Up': { color: 'var(--warning-text)', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' },
    'CRM-Sync (Invoice)': {
      color: 'var(--billing-accent)',
      background: 'var(--accent-bg-strong)',
      border: '1px solid var(--accent-border-strong)',
    },
    'CRM-Sync (Prepay)': {
      color: 'var(--billing-accent)',
      background: 'var(--accent-bg-strong)',
      border: '1px solid var(--accent-border-strong)',
    },
    Split: { color: 'var(--purple-text)', background: 'var(--purple-bg)', border: '1px solid var(--purple-border)' },
  };
  return map[type] ?? { color: 'var(--purple-text)', background: 'var(--purple-bg)', border: '1px solid var(--purple-border)' };
}

/** Zoho CRM datetime with timezone offset (writes/optimistic mapped_at) — "2026-06-09T14:30:00+05:00". */
export function zohoTimestamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
  );
}

/** Initials for the audit avatar. */
export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Chase/Stripe bank descriptors are never learnable senders — skip the memory write for them. */
export function isJunkCompanyName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length < 3) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

export { fmtCurrency };
