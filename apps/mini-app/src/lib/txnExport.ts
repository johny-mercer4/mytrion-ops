/**
 * Driver-facing transaction export — CSV / Excel / Text, all dependency-free (no jsPDF/xlsx bundle).
 * Column layout mirrors what the mini-app's Transactions sheet shows, flat one-row-per-line-item,
 * with a totals line. Excel is a `.xls` HTML-table blob (opens natively in Excel; no SheetJS). PDF
 * is intentionally not here yet — it needs a PDF lib (follow-up).
 * Logic ported/simplified from apps/mytrion-crm's txnReportExport.ts.
 */
export type TxnExportFormat = 'csv' | 'excel' | 'text';

export interface TxnExportMeta {
  company: string;
  range: string;
  cardLast4: string;
}

const HEADERS = ['Date', 'Location', 'City', 'State', 'Card', 'Category', 'Qty', 'Amount', 'Discount'] as const;

function s(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}
function n(v: unknown): number {
  const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) ? x : 0;
}
function last4(v: unknown): string {
  const t = s(v);
  return t.length >= 4 ? t.slice(-4) : t;
}

/** Flatten the raw line-item rows into the export grid (header + body rows + totals). */
function toGrid(txns: Array<Record<string, unknown>>): { header: string[]; body: string[][]; totals: string[] } {
  let amt = 0;
  let disc = 0;
  let qty = 0;
  const body = txns.map((t) => {
    const a = n(t['line_item_amount'] ?? t['funded_total'] ?? t['net_total']);
    const d = n(t['line_item_discount_amount']);
    const q = n(t['line_item_fuel_quantity'] ?? t['transaction_fuel_quantity']);
    amt += a;
    disc += d;
    qty += q;
    return [
      s(t['transaction_date']).slice(0, 10),
      s(t['location_name']),
      s(t['location_city']),
      s(t['location_state']),
      `••••${last4(t['card_number'])}`,
      s(t['line_item_category']),
      q ? q.toFixed(2) : '0',
      a.toFixed(2),
      d ? d.toFixed(2) : '0',
    ];
  });
  const totals = ['TOTAL', '', '', '', '', '', qty.toFixed(2), amt.toFixed(2), disc.toFixed(2)];
  return { header: [...HEADERS], body, totals };
}

function safe(part: string): string {
  return (part || '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'export';
}

function deliverBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(grid: ReturnType<typeof toGrid>): string {
  return [grid.header, ...grid.body, grid.totals].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/** A .xls the app can produce with zero deps: an HTML table Excel opens directly. */
function toXlsHtml(grid: ReturnType<typeof toGrid>, meta: TxnExportMeta): string {
  const th = grid.header.map((h) => `<th>${h}</th>`).join('');
  const rows = grid.body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  const totals = `<tr>${grid.totals.map((c) => `<td><b>${escapeHtml(c)}</b></td>`).join('')}</tr>`;
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>
    <p>Transactions — ${escapeHtml(meta.company)} · ${escapeHtml(meta.range)}</p>
    <table border="1"><thead><tr>${th}</tr></thead><tbody>${rows}${totals}</tbody></table>
  </body></html>`;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function toText(grid: ReturnType<typeof toGrid>, meta: TxnExportMeta): string {
  const widths = grid.header.map((h, i) => Math.max(h.length, ...grid.body.map((r) => r[i]!.length), grid.totals[i]!.length));
  const fmtRow = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  const out = [
    `Transactions — ${meta.company}`,
    meta.range,
    '',
    fmtRow(grid.header),
    fmtRow(grid.header.map((_, i) => '-'.repeat(widths[i]!))),
    ...grid.body.map(fmtRow),
    '',
    fmtRow(grid.totals),
  ];
  return out.join('\n');
}

export function exportTransactions(
  txns: Array<Record<string, unknown>>,
  format: TxnExportFormat,
  meta: TxnExportMeta,
): void {
  const grid = toGrid(txns);
  const base = `transactions_${safe(meta.cardLast4)}_${safe(meta.range)}`;
  if (format === 'csv') {
    deliverBlob(new Blob([`\uFEFF${toCsv(grid)}`], { type: 'text/csv;charset=utf-8;' }), `${base}.csv`);
  } else if (format === 'excel') {
    deliverBlob(new Blob([toXlsHtml(grid, meta)], { type: 'application/vnd.ms-excel' }), `${base}.xls`);
  } else {
    deliverBlob(new Blob([toText(grid, meta)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
  }
}
