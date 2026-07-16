/**
 * Transactions Report exports — PDF / Excel / CSV / Text.
 * Column layout mirrors EFS Transaction Report (self-service automation-modal.js).
 */
import { deliverBlob, ensureTxnExportLibs } from './txnExportLibs';
import {
  ensureTxnInvoices,
  groupTransactions,
  processTransactions,
  type TxnExportOptions,
  type TxnGrouped,
  type TxnLineItem,
  type TxnReportState,
} from './txnReport';

function efsDiscCode(code: string): string {
  const c = String(code || '').toUpperCase();
  if (c === 'W' || c === 'C') return 'CP';
  if (c === 'D') return 'RM';
  if (c === 'N') return 'ND';
  return '';
}

function efsDiscBucket(code: string): string {
  const s = efsDiscCode(code);
  return s === 'CP' ? 'Cost Plus' : s === 'RM' ? 'Retail Minus' : s === 'ND' ? 'No Deal' : 'Other';
}

function maskCard(num: string, full: boolean): string {
  const t = String(num ?? '—');
  if (full || t === '—' || t.length <= 4) return t;
  return `•••• ${t.slice(-4)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Prefer ISO yyyy-MM-dd prefix so timezone parsing doesn't shift the day. */
function dateOnly(v: string): string {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Literal-first, matching dateOnly: take HH:mm straight from the source string so a row's date
 * and time come from the SAME clock (viewer-local getHours could disagree with the ISO day by a
 * calendar day near midnight). Fallback formats in NY time — the app's canonical timezone.
 */
function timeOnly(v: string): string {
  if (!v) return '';
  const m = String(v).match(/T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function efsSummary(transactions: TxnGrouped[], showDiscount: boolean) {
  const itemMap = new Map<string, { amount: number; qty: number }>();
  const discMap = new Map<string, { amount: number; qty: number }>();
  let fees = 0;
  let totalDisc = 0;
  let totalFuelQty = 0;
  const seenFee = new Set<string>();
  for (const tx of transactions) {
    if (!seenFee.has(tx.id)) {
      fees += Number(tx.carrierFee) || 0;
      seenFee.add(tx.id);
    }
    for (const li of tx.lineItems) {
      const item = String(li.category || '—').toUpperCase();
      const disc = Number(li.discAmount) || 0;
      const qty = Number(li.quantity) || 0;
      const amt = (Number(li.amount) || 0) + (showDiscount ? 0 : disc);
      const it = itemMap.get(item) ?? { amount: 0, qty: 0 };
      it.amount += amt;
      it.qty += qty;
      itemMap.set(item, it);
      totalFuelQty += qty;
      const bucket = efsDiscBucket(li.discTypeCode);
      const db = discMap.get(bucket) ?? { amount: 0, qty: 0 };
      db.amount += disc;
      db.qty += qty;
      discMap.set(bucket, db);
      totalDisc += disc;
    }
  }
  const byItem = Array.from(itemMap.entries())
    .map(([item, v]) => ({
      item,
      amount: v.amount,
      qty: v.qty,
      avgPpu: v.qty > 0 ? v.amount / v.qty : 0,
    }))
    .sort((a, b) => a.item.localeCompare(b.item));
  const totalFuelAmount = byItem.reduce((s, r) => s + r.amount, 0);
  const discounts = ['Cost Plus', 'No Deal', 'Retail Minus'].map((name) => {
    const v = discMap.get(name) ?? { amount: 0, qty: 0 };
    return { name, amount: v.amount, ppu: v.qty > 0 ? v.amount / v.qty : 0, total: v.amount };
  });
  return {
    byItem,
    fees,
    totalsAmount: totalFuelAmount + fees,
    totalFuelAmount,
    totalFuelQty,
    discounts,
    totalDiscount: totalDisc,
    avgDiscount: totalFuelQty > 0 ? totalDisc / totalFuelQty : 0,
  };
}

function efsSummaryBlock(transactions: TxnGrouped[], showDiscount: boolean): unknown[][] {
  const s = efsSummary(transactions, showDiscount);
  const out: unknown[][] = [];
  out.push(['', 'Amount', 'Quantity', 'Avg PPU']);
  s.byItem.forEach((r) => out.push([r.item, r.amount.toFixed(2), r.qty.toFixed(2), r.avgPpu.toFixed(3)]));
  out.push(['Fees', s.fees.toFixed(2), '', '']);
  out.push(['Totals', s.totalsAmount.toFixed(2), '', '']);
  out.push(['Total Fuel', s.totalFuelAmount.toFixed(2), s.totalFuelQty.toFixed(2), '']);
  if (showDiscount) {
    out.push([]);
    out.push(['Discount', 'Discount Amt', 'Discount PPU', 'Total Discount']);
    s.discounts.forEach((d) => out.push([d.name, d.amount.toFixed(2), d.ppu.toFixed(3), d.total.toFixed(2)]));
    out.push(['Total Discount', '', '', s.totalDiscount.toFixed(2)]);
    out.push(['Average Discount', '', '', s.avgDiscount.toFixed(2)]);
  }
  return out;
}

type Col = { h: string; w: number; total?: 'fees' | 'qty' | 'disc' | 'amt'; get: (c: RowCtx) => string };
interface RowCtx {
  card: string;
  date: string;
  time: string;
  tx: TxnGrouped;
  li: TxnLineItem;
  liIdx: number;
  feeForTx: number;
  qty: number;
  amt: number;
  disc: number;
}

function efsColumns(o: TxnExportOptions): Col[] {
  const f2 = (v: number | null | undefined) => (v != null && !Number.isNaN(Number(v)) ? Number(v).toFixed(2) : '');
  const f3 = (v: number | null | undefined) => (v != null && !Number.isNaN(Number(v)) ? Number(v).toFixed(3) : '');
  const showDiscDetail = !o.retailPriceOnly && o.showDiscountDetail;
  const cols: Col[] = [
    { h: 'Card #', w: 20, get: (c) => c.card },
    { h: 'Tran Date', w: 12, get: (c) => c.date },
  ];
  if (o.showTransactionTime) cols.push({ h: 'Tran Time', w: 8, get: (c) => c.time });
  cols.push(
    { h: 'Invoice', w: 12, get: (c) => c.tx.invoiceRef || '' },
    { h: 'Unit', w: 8, get: (c) => c.tx.unitNumber || '' },
    { h: 'Driver Name', w: 18, get: (c) => c.tx.driverName || '' },
    { h: 'Odometer', w: 10, get: () => '' },
    { h: 'Location Name', w: 28, get: (c) => c.tx.locationName || c.tx.location || '—' },
    { h: 'City', w: 16, get: (c) => c.tx.locationCity || '' },
    { h: 'State/Prov', w: 8, get: (c) => c.tx.locationState || '' },
  );
  if (o.addDataCaptureFee) {
    cols.push({ h: 'Fees', w: 7, total: 'fees', get: (c) => (c.liIdx === 0 ? f2(c.feeForTx) : '') });
  }
  cols.push(
    { h: 'Item', w: 6, get: (c) => c.li.category || '—' },
    { h: 'Unit Price', w: 10, get: (c) => f3(c.li.retailPPU) },
  );
  if (showDiscDetail) {
    cols.push(
      { h: 'Disc PPU', w: 9, get: (c) => f3(c.li.ppu) },
      { h: 'Disc Cost', w: 9, get: (c) => f3(c.li.discPerUnit) },
    );
  }
  cols.push({ h: 'Qty', w: 9, total: 'qty', get: (c) => (c.qty ? c.qty.toFixed(2) : '') });
  if (o.showDiscount) {
    cols.push({ h: 'Disc Amt', w: 9, total: 'disc', get: (c) => (c.disc ? c.disc.toFixed(2) : '') });
  }
  cols.push(
    { h: 'Disc Type', w: 9, get: (c) => efsDiscCode(c.li.discTypeCode) },
    {
      h: 'Amt',
      w: 11,
      total: 'amt',
      get: (c) => (o.showDiscount ? c.amt : c.amt + c.disc).toFixed(2),
    },
    { h: 'Currency', w: 12, get: () => 'USD/Gallons' },
  );
  return cols;
}

function efsDetailRows(list: TxnGrouped[], o: TxnExportOptions): unknown[][] {
  const cols = efsColumns(o);
  const rows: unknown[][] = [];
  const seenFeeTx = new Set<string>();
  for (const tx of list) {
    const card = maskCard(tx.cardNumber, o.showEntireCardNumber);
    const date = dateOnly(tx.transactionDate);
    const time = timeOnly(tx.transactionDate);
    const feeForTx = !seenFeeTx.has(tx.id) ? Number(tx.carrierFee) || 0 : 0;
    seenFeeTx.add(tx.id);
    const items =
      tx.lineItems.length > 0
        ? tx.lineItems
        : [
            {
              category: '—',
              quantity: tx.fuelQuantity,
              ppu: null,
              retailPPU: null,
              amount: tx.fundedTotal,
              discAmount: tx.discAmount,
              discPerUnit: null,
              discType: '',
              discTypeCode: '',
            },
          ];
    items.forEach((li, liIdx) => {
      const ctx: RowCtx = {
        card,
        date,
        time,
        tx,
        li,
        liIdx,
        feeForTx,
        qty: Number(li.quantity) || 0,
        amt: Number(li.amount) || 0,
        disc: Number(li.discAmount) || 0,
      };
      rows.push(cols.map((c) => c.get(ctx)));
    });
  }
  return rows;
}

function safeFilePart(s: string): string {
  return String(s ?? '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function buildGroupedAoa(list: TxnGrouped[], opts: TxnExportOptions): unknown[][] {
  const aoa: unknown[][] = [];
  aoa.push(efsColumns(opts).map((c) => c.h));
  const groups = groupTransactions(list, opts.groupBy);
  groups.forEach((g, gi) => {
    efsDetailRows(g.transactions, opts).forEach((r) => aoa.push(r));
    aoa.push([]);
    const label = g.isCard ? maskCard(g.cardNumber, opts.showEntireCardNumber) : g.label;
    aoa.push([`Group ${gi + 1}: ${label}`]);
    efsSummaryBlock(g.transactions, opts.showDiscount).forEach((r) => aoa.push(r));
    aoa.push([]);
  });
  aoa.push(['GRAND TOTALS']);
  efsSummaryBlock(list, opts.showDiscount).forEach((r) => aoa.push(r));
  return aoa;
}

export async function downloadTxnReport(
  state: TxnReportState,
  opts: TxnExportOptions,
): Promise<void> {
  const withInv = await ensureTxnInvoices(state);
  const list = processTransactions(withInv.transactions, opts);
  if (!list.length) throw new Error('No transaction data available to export.');

  await ensureTxnExportLibs();
  const carrierId = withInv.carrierId || 'carrier';
  const filenameBase = `transactions_${safeFilePart(carrierId)}_${safeFilePart(withInv.from)}_${safeFilePart(withInv.to)}`;

  if (opts.format === 'pdf') {
    await window.MytrionPdfUtils!.generateTransactionsPdf({
      carrierId,
      startDate: withInv.from,
      endDate: withInv.to,
      summary: {
        totalTransactions: list.length,
        totalFundedAmount: list.reduce((s, t) => s + (t.fundedTotal || 0), 0),
        totalDiscount: list.reduce((s, t) => s + (t.discAmount || 0), 0),
        totalGallons: list.reduce((s, t) => s + (t.fuelQuantity || 0), 0),
        totalCarrierFee: list.reduce((s, t) => s + (t.carrierFee || 0), 0),
        dateRange: withInv.summary.dateRange,
      },
      ai: {},
      transactions: list,
      logoUrl: '',
      options: {
        pageBreak: opts.pageBreak,
        removeDetails: opts.removeDetails,
        grandTotalOnly: opts.grandTotalOnly,
        removeGroupSummary: opts.removeGroupSummary,
        fullCardNumber: opts.showEntireCardNumber,
        showTime: opts.showTransactionTime,
        retailOnly: opts.retailPriceOnly,
        showDiscount: opts.showDiscount,
        showDiscountDetail: opts.showDiscountDetail,
        addDataCaptureFee: opts.addDataCaptureFee,
        groupBy: opts.groupBy,
        showDriverColumns: true,
        quantityUnitLabel: 'Qty',
      },
    });
    return;
  }

  if (opts.format === 'excel') {
    await window.MytrionExcelUtils!.aoaToXlsx(
      buildGroupedAoa(list, opts),
      `${filenameBase}.xlsx`,
      efsColumns(opts).map((c) => c.w),
    );
    return;
  }

  if (opts.format === 'csv') {
    const aoa = buildGroupedAoa(list, opts);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = aoa.map((r) => r.map(esc).join(',')).join('\r\n');
    deliverBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' }), `${filenameBase}.csv`);
    return;
  }

  const out: string[] = [];
  out.push(`Transaction Report — Carrier ${carrierId}`);
  out.push(withInv.summary.dateRange || '');
  out.push(`Group by: ${opts.groupBy}`);
  out.push('');
  const groups = groupTransactions(list, opts.groupBy);
  groups.forEach((g, gi) => {
    const label = g.isCard ? maskCard(g.cardNumber, opts.showEntireCardNumber) : g.label;
    out.push(`Group ${gi + 1}: ${label}  (${g.transactions.length} txn${g.transactions.length !== 1 ? 's' : ''})`);
    if (!opts.removeDetails) {
      g.transactions.forEach((tx) => {
        const date = dateOnly(tx.transactionDate);
        const time = opts.showTransactionTime ? ` ${timeOnly(tx.transactionDate)}` : '';
        const items = tx.lineItems.length
          ? tx.lineItems
          : [{ category: '—', quantity: tx.fuelQuantity, amount: tx.fundedTotal, discAmount: tx.discAmount, discTypeCode: '', ppu: null, retailPPU: null, discPerUnit: null, discType: '' }];
        items.forEach((li, i) => {
          const head =
            i === 0
              ? `${date}${time}  inv ${tx.invoiceRef || '—'}  unit ${tx.unitNumber || '—'}  ${tx.driverName || '—'}  ${tx.locationName || tx.location || '—'}, ${tx.locationCity || ''} ${tx.locationState || ''}`
              : `${' '.repeat(10)}`;
          const qty = Number(li.quantity) || 0;
          const discPart =
            opts.showDiscount && Number(li.discAmount) > 0 ? `  disc ${Number(li.discAmount).toFixed(2)}` : '';
          const lineAmt = (Number(li.amount) || 0) + (opts.showDiscount ? 0 : Number(li.discAmount) || 0);
          out.push(
            `  ${head}  ${li.category || '—'}  qty ${qty ? qty.toFixed(2) : '0'}  $${lineAmt.toFixed(2)}  ${efsDiscCode(li.discTypeCode)}${discPart}`,
          );
        });
      });
    }
    out.push('');
    efsSummaryBlock(g.transactions, opts.showDiscount).forEach((row) => {
      out.push(`  ${row.map((c) => String(c ?? '')).join('  ')}`);
    });
    out.push('');
  });
  out.push('GRAND TOTALS');
  efsSummaryBlock(list, opts.showDiscount).forEach((row) => {
    out.push(row.map((c) => String(c ?? '')).join('  '));
  });
  deliverBlob(new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' }), `${filenameBase}.txt`);
}
