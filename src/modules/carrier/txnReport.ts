/**
 * Server-side transaction report builder — CSV / Excel / Text, dependency-free.
 *
 * A port of the mini-app's `lib/txnExport.ts` minus the browser blob-download half. It exists
 * server-side because the report is delivered as a Telegram document: a Telegram WebApp has no
 * reliable "save file" affordance (an in-app WebView download either silently no-ops or escapes to
 * an external browser), whereas a document in the bot chat is durable, shareable, and re-openable.
 *
 * The column grid mirrors the mini-app's Transactions sheet on purpose — the file a driver receives
 * must match the rows they were just looking at.
 */
export type TxnReportFormat = 'csv' | 'excel' | 'text';

export interface TxnReportMeta {
  company: string;
  /** Human label for the window, e.g. "month" or "2026-05-01 → 2026-06-01". */
  range: string;
  cardLast4: string;
}

export interface BuiltTxnReport {
  fileName: string;
  contentType: string;
  body: string;
}

const HEADERS = ['Date', 'Location', 'City', 'State', 'Card', 'Category', 'Qty', 'Amount', 'Discount'] as const;

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) ? x : 0;
};
const last4 = (v: unknown): string => {
  const t = s(v);
  return t.length >= 4 ? t.slice(-4) : t;
};

/**
 * 'YYYY-MM-DD' from whatever the row carries.
 *
 * `pg` hands back a `timestamp without time zone` as a JS Date, and String()-ing that yields
 * "Thu Jul 16 2026 …" — slicing 10 chars off it drops the year entirely. The mini-app never hit
 * this because JSON serialises Dates to ISO on the way to the browser; this builder reads the rows
 * before that happens. Read the Date's local parts (not toISOString, which would shift the naive
 * timestamp by the server's UTC offset and can roll the day backwards).
 */
function dateCell(v: unknown): string {
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return s(v).slice(0, 10);
}

interface Grid {
  header: string[];
  body: string[][];
  totals: string[];
}

/** Flatten raw line-item rows into the report grid. Field fallbacks mirror the mini-app's sheet,
 *  which reads the mart's `line_item_*` names but tolerates CMP's `funded_total` / `net_total`. */
function toGrid(txns: ReadonlyArray<Record<string, unknown>>): Grid {
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
      dateCell(t['transaction_date']),
      s(t['location_name']),
      s(t['location_city']),
      s(t['location_state']),
      `****${last4(t['card_number'])}`,
      s(t['line_item_category']),
      q ? q.toFixed(2) : '0',
      a.toFixed(2),
      d ? d.toFixed(2) : '0',
    ];
  });
  return {
    header: [...HEADERS],
    body,
    totals: ['TOTAL', '', '', '', '', '', qty.toFixed(2), amt.toFixed(2), disc.toFixed(2)],
  };
}

/** Filename-safe slug. Also the reason a report can't smuggle a path separator into sendDocument. */
function safe(part: string): string {
  return (part || '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'export';
}

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const escapeHtml = (v: string): string => v.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

function toCsv(grid: Grid): string {
  return [grid.header, ...grid.body, grid.totals].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/** A .xls with zero deps: an HTML table Excel opens natively. */
function toXlsHtml(grid: Grid, meta: TxnReportMeta): string {
  const th = grid.header.map((h) => `<th>${h}</th>`).join('');
  const rows = grid.body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  const totals = `<tr>${grid.totals.map((c) => `<td><b>${escapeHtml(c)}</b></td>`).join('')}</tr>`;
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>
    <p>Transactions — ${escapeHtml(meta.company)} · ${escapeHtml(meta.range)}</p>
    <table border="1"><thead><tr>${th}</tr></thead><tbody>${rows}${totals}</tbody></table>
  </body></html>`;
}

function toText(grid: Grid, meta: TxnReportMeta): string {
  const widths = grid.header.map((h, i) =>
    Math.max(h.length, ...grid.body.map((r) => (r[i] ?? '').length), (grid.totals[i] ?? '').length),
  );
  const fmtRow = (r: string[]) => r.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  return [
    `Transactions — ${meta.company}`,
    meta.range,
    '',
    fmtRow(grid.header),
    fmtRow(grid.header.map((_, i) => '-'.repeat(widths[i] ?? 0))),
    ...grid.body.map(fmtRow),
    '',
    fmtRow(grid.totals),
  ].join('\n');
}

export function buildTxnReport(
  txns: ReadonlyArray<Record<string, unknown>>,
  format: TxnReportFormat,
  meta: TxnReportMeta,
): BuiltTxnReport {
  const grid = toGrid(txns);
  const base = `transactions_${safe(meta.cardLast4)}_${safe(meta.range)}`;
  if (format === 'csv') {
    // Leading BOM so Excel reads the UTF-8 bytes as UTF-8 rather than the local ANSI codepage.
    return { fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: `\uFEFF${toCsv(grid)}` };
  }
  if (format === 'excel') {
    return { fileName: `${base}.xls`, contentType: 'application/vnd.ms-excel', body: toXlsHtml(grid, meta) };
  }
  return { fileName: `${base}.txt`, contentType: 'text/plain; charset=utf-8', body: toText(grid, meta) };
}
