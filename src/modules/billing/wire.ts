/**
 * Billing wire mappers — turn the Drizzle rows from the payments repos into the loose snake_case
 * shapes the frontend normalizers (transactionModel.normalizeTx, returnsModel.mapReturn /
 * mapCandidate) already consume. Keeping the mapping here means the React panels are unchanged when
 * their backend moves from the Zoho `deluge` touchpoints to these Postgres routes.
 */
import type { PaymentReturn, PaymentTransaction } from '../../db/schema/index.js';

function iso(d: Date | null): string {
  return d ? d.toISOString() : '';
}
function num(v: string | null): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
/** MX rows carry a `Source` sub-type (e.g. "quickpay") in `raw`; normalizeTx reads `mx_source`. */
function rawSource(raw: Record<string, unknown> | null): string {
  if (!raw) return '';
  const v = raw.Source ?? raw.source;
  return typeof v === 'string' ? v : '';
}

/** PaymentTransaction → the raw shape normalizeTx() reads. */
export function toTxWire(row: PaymentTransaction): Record<string, unknown> {
  return {
    record_id: String(row.id),
    source: row.source,
    carrier_id: row.carrierId ?? '',
    amount: num(row.amount),
    sender_name: row.senderName ?? '',
    name: row.name ?? '',
    memo: row.memo ?? '',
    transaction_number: row.externalTxnId ?? '',
    transaction_id: row.externalTxnId ?? '',
    posting_date: iso(row.occurredAt),
    status: row.status ?? '',
    description: row.description ?? '',
    email: row.email ?? '',
    customer_id: row.customerRef ?? '',
    card_brand: row.cardBrand ?? '',
    card_last4: row.cardLast4 ?? '',
    receipt_url: row.receiptUrl ?? '',
    mapping_type: row.mappingType ?? '',
    mapped_by: row.mappedBy ?? '',
    mapped_at: iso(row.mappedAt),
    // Stored as jsonb; normalizeTx expects a JSON string it can parse (widget parity).
    cmp_ref: row.cmpRef ? JSON.stringify(row.cmpRef) : '',
    split_allocations: row.splitAllocations ? JSON.stringify(row.splitAllocations) : '',
    proposed_carrier_ids: row.proposedCarrierIds ?? '',
    isInvoiceMapped: row.isInvoiceMapped,
    Invoice_Mapped: row.isInvoiceMapped,
    isReturned: row.isReturned,
    returned_at: iso(row.returnedAt),
    mx_source: rawSource(row.raw),
  };
}

/** PaymentReturn → the raw shape returnsModel.mapReturn() reads. */
export function toReturnWire(row: PaymentReturn): Record<string, unknown> {
  return {
    record_id: String(row.id),
    return_date: iso(row.returnDate),
    return_type: row.returnType ?? '',
    customer_name: row.customerName ?? '',
    reference_number: row.referenceNumber ?? row.sourceRecordId,
    last4: row.last4 ?? '',
    return_reason: row.reason ?? '',
    match_note: row.matchNote ?? '',
    amount: num(row.amount),
    matched: row.matched,
    original_transaction_id: row.originalTransactionId != null ? String(row.originalTransactionId) : '',
    original_transaction_name: '',
  };
}

/** PaymentTransaction → the raw shape returnsModel.mapCandidate() reads (manual-match search). */
export function toCandidateWire(row: PaymentTransaction): Record<string, unknown> {
  return {
    record_id: String(row.id),
    customer_name: row.senderName || row.name || '',
    name: row.externalTxnId || row.name || '',
    reference: row.externalTxnId ?? '',
    carrier_id: row.carrierId ?? '',
    amount: num(row.amount),
    created_date: iso(row.occurredAt),
    isReturned: row.isReturned,
    isInvoiceMapped: row.isInvoiceMapped,
  };
}
