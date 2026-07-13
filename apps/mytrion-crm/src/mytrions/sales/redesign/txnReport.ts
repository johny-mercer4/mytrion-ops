/**
 * Transactions Report — fetch / group / filter DWH line items.
 * Export generators live in txnReportExport.ts (mirrors self-service automation-modal.js).
 */
import { callTouchpoint } from '@/api/touchpoints';

export type TxnFormat = 'pdf' | 'excel' | 'csv' | 'text';
export type TxnGroupBy = 'card_number' | 'driver' | 'state_province';
export type TxnSortBy = 'transaction_date' | 'state_province';

export interface TxnLineItem {
  category: string;
  quantity: number | null;
  ppu: number | null;
  retailPPU: number | null;
  amount: number | null;
  discAmount: number | null;
  discPerUnit: number | null;
  discType: string;
  discTypeCode: string;
}

export interface TxnGrouped {
  id: string;
  transactionId: string;
  transactionDate: string;
  transactionTimeMs: number;
  cardNumber: string;
  driverName: string;
  driverId: string;
  unitNumber: string;
  location: string;
  invoiceRef: string;
  locationId: string;
  locationName: string;
  locationCity: string;
  locationState: string;
  locationCountry: string;
  chainCode: string;
  chainName: string;
  fundedTotal: number;
  discAmount: number;
  carrierFee: number;
  fuelQuantity: number;
  lineItems: TxnLineItem[];
  lineItem: TxnLineItem | null;
}

export interface TxnSummary {
  totalTransactions: number;
  totalFundedAmount: number;
  totalDiscount: number;
  totalGallons: number | null;
  totalCarrierFee: number;
  dateRange: string;
}

export interface TxnReportState {
  carrierId: string;
  range: string;
  from: string;
  to: string;
  transactions: TxnGrouped[];
  summary: TxnSummary;
  moreRecords: boolean;
  invoicesLoaded: boolean;
}

export interface TxnMatchFilters {
  cardNumber: string;
  locationId: string;
  driverName: string;
  driverId: string;
  unit: string;
  city: string;
  invoice: string;
}

export interface TxnExportOptions {
  format: TxnFormat;
  groupBy: TxnGroupBy;
  sortBy: TxnSortBy;
  pageBreak: boolean;
  removeDetails: boolean;
  grandTotalOnly: boolean;
  removeGroupSummary: boolean;
  showEntireCardNumber: boolean;
  showTransactionTime: boolean;
  retailPriceOnly: boolean;
  showDiscount: boolean;
  showDiscountDetail: boolean;
  addDataCaptureFee: boolean;
  negativeOnly: boolean;
  exactMatch: boolean;
  stateProvince: string;
  chainNames: string[];
  product: string;
  match: TxnMatchFilters;
}

export const DEFAULT_TXN_OPTS: TxnExportOptions = {
  format: 'pdf',
  groupBy: 'card_number',
  sortBy: 'transaction_date',
  pageBreak: false,
  removeDetails: false,
  grandTotalOnly: false,
  removeGroupSummary: false,
  showEntireCardNumber: false,
  showTransactionTime: true,
  retailPriceOnly: false,
  showDiscount: true,
  showDiscountDetail: true,
  addDataCaptureFee: false,
  negativeOnly: false,
  exactMatch: false,
  stateProvince: '',
  chainNames: [],
  product: '',
  match: {
    cardNumber: '',
    locationId: '',
    driverName: '',
    driverId: '',
    unit: '',
    city: '',
    invoice: '',
  },
};

/** Same presets as self-service automation-modal.js txnRangePresets. */
export const TXN_RANGE_PRESETS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'half_year', label: 'Past 6 Months' },
  { value: 'year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
] as const;

export const TXN_GROUP_BY_OPTIONS = [
  { value: 'card_number' as const, label: 'Card Number' },
  { value: 'driver' as const, label: 'Driver' },
  { value: 'state_province' as const, label: 'State / Province (IFTA)' },
];

export const TXN_SORT_BY_OPTIONS = [
  { value: 'transaction_date' as const, label: 'Transaction Date' },
  { value: 'state_province' as const, label: 'State / Province (IFTA)' },
];

export const TXN_FORMAT_OPTIONS = [
  { value: 'pdf' as const, label: 'PDF' },
  { value: 'excel' as const, label: 'Excel' },
  { value: 'csv' as const, label: 'CSV' },
  { value: 'text' as const, label: 'Text' },
];

/** Map UI range → DWH touchpoint params (half_year → custom; custom needs from/to). */
export function txnRangeParams(
  sel: string,
  custom?: { from: string; to: string },
): { range: string; from?: string; to?: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (sel === 'custom') {
    if (!custom?.from || !custom?.to) throw new Error('Pick a start and end date for the custom range.');
    return { range: 'custom', from: custom.from, to: custom.to };
  }
  if (sel === 'half_year') {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 6);
    return { range: 'custom', from: iso(from), to: iso(to) };
  }
  return { range: sel };
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function groupTxnRows(rows: Array<Record<string, unknown>>): TxnGrouped[] {
  const txMap = new Map<string, TxnGrouped>();
  rows.forEach((row, index) => {
    const txId = String(row.transaction_id ?? `tx-${index}`);
    const date = String(row.transaction_date ?? '');
    const lineItem: TxnLineItem = {
      category: String(row.line_item_category ?? '—'),
      quantity: num(row.line_item_fuel_quantity),
      ppu: num(row.line_item_price_per_unit),
      retailPPU: num(row.line_item_retail_price_per_unit),
      amount: num(row.line_item_amount),
      discAmount: num(row.line_item_discount_amount),
      discPerUnit: num(row.line_item_disc_amount_per_unit),
      discType: String(row.disc_type_description ?? ''),
      discTypeCode: String(row.disc_type_code ?? ''),
    };
    if (!txMap.has(txId)) {
      const timeMs = date ? new Date(date).getTime() : 0;
      const locationName = String(row.location_name ?? '');
      const locationState = String(row.location_state ?? '');
      txMap.set(txId, {
        id: txId,
        transactionId: txId,
        transactionDate: date,
        transactionTimeMs: Number.isNaN(timeMs) ? 0 : timeMs,
        cardNumber: String(row.card_number ?? '—'),
        driverName: String(row.driver_card_name ?? ''),
        driverId: String(row.driver_id ?? ''),
        unitNumber: String(row.driver_unit ?? ''),
        location: [locationName, locationState].filter(Boolean).join(', ') || '—',
        invoiceRef: row.invoice_ref != null ? String(row.invoice_ref) : '',
        locationId: row.location_id != null ? String(row.location_id) : '',
        locationName: locationName || '—',
        locationCity: String(row.location_city ?? ''),
        locationState,
        locationCountry: String(row.location_country ?? ''),
        chainCode: String(row.chain_code ?? ''),
        chainName: String(row.chain_name ?? ''),
        fundedTotal: 0,
        discAmount: 0,
        carrierFee: 0,
        fuelQuantity: 0,
        lineItems: [],
        lineItem: null,
      });
    }
    const tx = txMap.get(txId)!;
    tx.lineItems.push(lineItem);
    if (!tx.lineItem) tx.lineItem = lineItem;
    tx.fundedTotal += Number(row.line_item_amount ?? 0);
    tx.discAmount += Number(row.line_item_discount_amount ?? 0);
    tx.fuelQuantity += Number(row.line_item_fuel_quantity ?? 0);
    if (row.carrier_fee != null) tx.carrierFee = Number(row.carrier_fee) || 0;
  });
  return Array.from(txMap.values()).sort((a, b) => (b.transactionTimeMs || 0) - (a.transactionTimeMs || 0));
}

export async function fetchTxnReport(
  carrierId: string,
  rangeSel: string,
  custom?: { from: string; to: string },
): Promise<TxnReportState> {
  const rp = txnRangeParams(rangeSel, custom);
  const res = await callTouchpoint('dwh.transactions', {
    carrierId,
    range: rp.range,
    ...(rp.from ? { from: rp.from } : {}),
    ...(rp.to ? { to: rp.to } : {}),
    limit: 5000,
  });
  const rows = (res.data ?? []) as Array<Record<string, unknown>>;
  const transactions = groupTxnRows(rows);
  const totals = (res.totals ?? {}) as Record<string, number | string | null | undefined>;
  const rangeMeta = (res.range ?? {}) as Record<string, unknown>;
  const label = TXN_RANGE_PRESETS.find((p) => p.value === rangeSel)?.label ?? rangeSel;
  const from =
    rangeMeta.from != null ? String(rangeMeta.from).slice(0, 10) : (rp.from ?? '');
  const to = rangeMeta.to != null ? String(rangeMeta.to).slice(0, 10) : (rp.to ?? '');
  const dateRange = from && to ? `${from} — ${to}` : label;
  const summary: TxnSummary = {
    totalTransactions: Number(totals.transactions ?? transactions.length),
    totalFundedAmount: Number(
      totals.funded_total ?? transactions.reduce((s, t) => s + t.fundedTotal, 0),
    ),
    totalDiscount: Number(
      totals.discount_amount ?? transactions.reduce((s, t) => s + t.discAmount, 0),
    ),
    totalGallons: totals.fuel_quantity != null ? Number(totals.fuel_quantity) : null,
    totalCarrierFee: Number(
      totals.carrier_fee ?? transactions.reduce((s, t) => s + (t.carrierFee || 0), 0),
    ),
    dateRange,
  };
  const pg = (res.pagination ?? {}) as Record<string, unknown>;
  const moreRecords =
    pg.more_records === true ||
    pg.has_more === true ||
    (pg.total != null && rows.length < Number(pg.total)) ||
    summary.totalTransactions > transactions.length;

  return {
    carrierId,
    range: rp.range,
    from,
    to,
    transactions,
    summary,
    moreRecords,
    invoicesLoaded: false,
  };
}

export async function ensureTxnInvoices(state: TxnReportState): Promise<TxnReportState> {
  if (state.invoicesLoaded || !state.transactions.length) {
    return { ...state, invoicesLoaded: true };
  }
  try {
    const res = await callTouchpoint('dwh.transaction_invoices', {
      carrierId: state.carrierId,
      range: state.range,
      ...(state.from ? { from: state.from } : {}),
      ...(state.to ? { to: state.to } : {}),
    });
    const map = new Map<string, string>();
    for (const r of res.data ?? []) {
      const row = r as Record<string, unknown>;
      const k = String(row.transaction_id ?? '');
      if (k && row.invoice_ref != null && row.invoice_ref !== '') {
        map.set(k, String(row.invoice_ref));
      }
    }
    const transactions = state.transactions.map((tx) => {
      const inv = map.get(String(tx.transactionId));
      return inv ? { ...tx, invoiceRef: inv } : tx;
    });
    return { ...state, transactions, invoicesLoaded: true };
  } catch {
    return { ...state, invoicesLoaded: true };
  }
}

/** Client-side filters + sort — same rules as processedTransactions in the reference. */
export function processTransactions(
  transactions: TxnGrouped[],
  o: TxnExportOptions,
): TxnGrouped[] {
  let list = transactions.slice();
  if (o.negativeOnly) list = list.filter((t) => Number(t.fundedTotal) < 0);
  if (o.stateProvince) {
    const want = String(o.stateProvince).toUpperCase();
    list = list.filter((t) => String(t.locationState || '').toUpperCase() === want);
  }
  if (o.chainNames.length) {
    const want = new Set(o.chainNames);
    list = list.filter((t) => want.has(String(t.chainName || '')));
  }
  if (o.product) {
    const want = String(o.product).toUpperCase();
    list = list.filter((t) =>
      (t.lineItems || []).some((li) => String(li.category || '').toUpperCase() === want),
    );
  }
  const m = o.match;
  const cmp = (val: string, q: string) => {
    if (!q) return true;
    const a = String(val || '').toLowerCase().trim();
    const b = String(q).toLowerCase().trim();
    return o.exactMatch ? a === b : a.includes(b);
  };
  if (m.cardNumber) list = list.filter((t) => cmp(t.cardNumber, m.cardNumber));
  if (m.locationId) list = list.filter((t) => cmp(t.locationId, m.locationId));
  if (m.driverName) list = list.filter((t) => cmp(t.driverName, m.driverName));
  if (m.driverId) list = list.filter((t) => cmp(t.driverId, m.driverId));
  if (m.unit) list = list.filter((t) => cmp(t.unitNumber, m.unit));
  if (m.city) list = list.filter((t) => cmp(t.locationCity, m.city));
  if (m.invoice) list = list.filter((t) => cmp(t.invoiceRef, m.invoice));
  if (o.sortBy === 'state_province') {
    list.sort(
      (a, b) =>
        String(a.locationState || '').localeCompare(String(b.locationState || '')) ||
        Number(b.transactionTimeMs || 0) - Number(a.transactionTimeMs || 0),
    );
  } else {
    list.sort((a, b) => Number(b.transactionTimeMs || 0) - Number(a.transactionTimeMs || 0));
  }
  return list;
}

export function groupTransactions(
  transactions: TxnGrouped[],
  groupBy: TxnGroupBy,
): Array<{ key: string; label: string; isCard: boolean; cardNumber: string; transactions: TxnGrouped[] }> {
  const map = new Map<string, TxnGrouped[]>();
  for (const t of transactions) {
    let key: string;
    if (groupBy === 'state_province') {
      key = String(t.locationState || '').toUpperCase() || '—';
    } else if (groupBy === 'driver') {
      const id = String(t.driverId || '').trim();
      const name = String(t.driverName || '').trim();
      key = id || name || '—';
    } else {
      key = String(t.cardNumber || '—');
    }
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([key, list]) => {
    const first = list[0]!;
    const isCard = groupBy === 'card_number';
    const label =
      groupBy === 'driver'
        ? [first.driverName, first.driverId && `#${first.driverId}`].filter(Boolean).join(' ') || '—'
        : groupBy === 'state_province'
          ? key
          : first.cardNumber;
    return { key, label, isCard, cardNumber: isCard ? key : '', transactions: list };
  });
}
