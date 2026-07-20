/**
 * Returns & Chargebacks view-model + CMP-outcome logic — shared by Returns.tsx (the panel) and
 * ReturnMatchModal.tsx (the manual-match modal). Ports the widget returns-panel.js data mapping,
 * the cmpStatus / cmpCategory / rowStatus derivations (all parsed from the `match_note` text), and
 * the type/date formatters. Raw records arrive as loose `Record<string, unknown>` (the touchpoints
 * unwrap permissively), so every field is read defensively and mapped onto a typed view-model.
 */
import { fmtCurrency } from './data';
import { readBool, readNum, readStr } from './transactionModel';

export { fmtCurrency };

type Raw = Record<string, unknown>;

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ── View-models ─────────────────────────────────────────────────────────────── */

/** One row of the Mx_Merchant_Returns module (an ACH/Wire return or a card chargeback). */
export interface ReturnRow {
  recordId: string;
  /** Raw return date — `return_date`, falling back to `created_time`; may carry a time component. */
  returnDate: string;
  /** 'ACH' | 'Wire' | 'Card-Chargeback' | other (raw module value). */
  returnType: string;
  customerName: string;
  referenceNumber: string;
  last4: string;
  returnReason: string;
  /** The workflow/retry note — the CMP outcome (cmpStatus/cmpCategory) is derived from this text. */
  matchNote: string;
  amount: number;
  /** Whether the return has been linked to its original transaction (auto- or manually). */
  matched: boolean;
  originalTransactionId: string;
  originalTransactionName: string;
}

/** One MX transaction candidate returned by the manual-match search. */
export interface Candidate {
  recordId: string;
  customerName: string;
  /** MX payment id / name — rendered as `#{name}`. */
  name: string;
  reference: string;
  carrierId: string;
  amount: number;
  createdDate: string;
  /** Already consumed by another return — cannot be selected. */
  isReturned: boolean;
  isInvoiceMapped: boolean;
}

/** Raw return record → typed ReturnRow (port of the widget's row field reads). */
export function mapReturn(raw: Raw): ReturnRow {
  return {
    recordId: readStr(raw.record_id),
    returnDate: readStr(raw.return_date) || readStr(raw.created_time),
    returnType: readStr(raw.return_type),
    customerName: readStr(raw.customer_name),
    referenceNumber: readStr(raw.reference_number),
    last4: readStr(raw.last4),
    returnReason: readStr(raw.return_reason),
    matchNote: readStr(raw.match_note),
    amount: readNum(raw.amount),
    matched: readBool(raw.matched),
    originalTransactionId: readStr(raw.original_transaction_id),
    originalTransactionName: readStr(raw.original_transaction_name),
  };
}

/** Raw candidate record → typed Candidate. */
export function mapCandidate(raw: Raw): Candidate {
  return {
    recordId: readStr(raw.record_id),
    customerName: readStr(raw.customer_name),
    name: readStr(raw.name),
    reference: readStr(raw.reference),
    carrierId: readStr(raw.carrier_id),
    amount: readNum(raw.amount),
    createdDate: readStr(raw.created_date),
    isReturned: readBool(raw.isReturned) || readBool(raw.Is_Returned),
    isInvoiceMapped: readBool(raw.isInvoiceMapped) || readBool(raw.Invoice_Mapped),
  };
}

/* ── CMP-outcome derivation (parsed from match_note; widget parity) ────────────── */

export interface CmpStatus {
  label: string;
  cls?: string;
  quiet?: boolean;
}

/**
 * CMP reversal outcome, derived from the workflow/retry notes. "Reconcile CMP" (amber) is the one
 * that needs a human — automatic resolution gave up (or errored) and CMP must be adjusted by hand.
 */
export function cmpStatus(ret: ReturnRow): CmpStatus | null {
  const n = ret.matchNote.toLowerCase();
  if (!n) return null;
  if (n.includes('retry exhausted') || n.includes('reconcile manually') || n.includes('failed'))
    return { label: 'Reconcile CMP', cls: 'rt-pill--warning' };
  if (n.includes('applied by retry') || n.includes('reversal(s) applied'))
    return { label: 'CMP Reversed', cls: 'rt-pill--ok' };
  if (n.includes('cmp-retry') || n.includes('no cmp reference stored'))
    return { label: 'CMP Pending', cls: 'rt-pill--partial' };
  // "not mapped — no CMP payment to reverse": the bounced payment was never posted to CMP, so
  // there is genuinely nothing to reverse.
  if (n.includes('not mapped')) return { label: 'no CMP action', quiet: true };
  return null;
}

export type CmpCategory = 'action' | 'pending' | 'reversed' | 'none';

/**
 * Work-queue category for a return: what (if anything) a human must do.
 *   action   → unmatched, reconcile-exhausted, or reversal errors
 *   pending  → hourly auto-retry still resolving (ACH not settled yet)
 *   reversed → money already pulled back out of CMP
 *   none     → matched but no CMP money involved / legacy notes
 */
export function cmpCategory(ret: ReturnRow): CmpCategory {
  if (!ret.matched) return 'action';
  const s = cmpStatus(ret);
  if (!s) return 'none';
  if (s.label === 'Reconcile CMP') return 'action';
  if (s.label === 'CMP Pending') return 'pending';
  if (s.label === 'CMP Reversed') return 'reversed';
  return 'none';
}

export interface RowStatus {
  label: string;
  cls?: string;
  quiet?: boolean;
}

/** The single status pill per row — the state that matters, not two stacked badges. */
export function rowStatus(ret: ReturnRow): RowStatus {
  if (!ret.matched) return { label: 'Unmatched', cls: 'rt-pill--danger' };
  const s = cmpStatus(ret);
  if (!s) return { label: 'Matched', quiet: true };
  if (s.quiet) return { label: 'Matched · no CMP action', quiet: true };
  return s.cls ? { label: s.label, cls: s.cls } : { label: s.label };
}

/* ── Formatters ────────────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD…' → 'Jul 8, 2026' without Date() UTC-parse day shifts (widget formatDay). */
export function formatDay(raw: string): string {
  if (!raw) return '—';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !m[1] || !m[2] || !m[3]) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString();
  }
  const month = MONTHS[parseInt(m[2], 10) - 1] ?? m[2];
  return `${month} ${parseInt(m[3], 10)}, ${m[1]}`;
}

/** "Card-Chargeback" → "Chargeback"; otherwise the raw type (or an em dash). */
export function typeLabel(t: string): string {
  return t === 'Card-Chargeback' ? 'Chargeback' : t || '—';
}

/** Type-column chip colour (design typeChip): Chargeback → purple, else → accent. */
export function typeBadgeClass(t: string): string {
  return t === 'Card-Chargeback' ? 'bm-badge-purple' : 'bm-badge-info';
}

/** Whether a candidate's amount equals the return amount, to the cent. */
export function sameAmount(candidateAmount: number, returnAmount: number): boolean {
  return Math.round(candidateAmount * 100) === Math.round(returnAmount * 100);
}
