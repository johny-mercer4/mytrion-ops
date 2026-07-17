/**
 * Client-facing transaction report — CSV / XLSX / PDF.
 *
 * These files go to carriers, so they are branded documents rather than raw dumps. Delivery is via
 * Telegram (see the export route): a Telegram WebApp has no reliable "save file" affordance, so the
 * document lands in the bot chat where it persists and can be forwarded.
 *
 * Brand: the amber→orange logo gradient (`--brand-amber`/`--brand-orange` in the mini-app's
 * global.css). Note the v2 rebrand moved UI *buttons* to blue (`--primary: #2451ff`) but explicitly
 * kept the gradient as the mark — so a document, which carries the mark rather than a button, uses
 * the gradient. (DESIGN_SPEC.md §8 still describes the pre-v2 amber CTA and is stale on that point.)
 *
 * Deliberately not built on modules/files/generate/{excel,pdf}.ts: those render agent-emitted specs
 * with equal-width columns and left-aligned everything, which is fine for a data dump and wrong for
 * a client document with 9 columns and money in three of them.
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AppError } from '../../lib/errors.js';

export type TxnReportFormat = 'csv' | 'xlsx' | 'pdf';

export interface TxnReportMeta {
  company: string;
  /** Human label for the window, e.g. "2026-07-01 → 2026-07-17". */
  range: string;
  cardLast4: string;
  /** Set for a driver export — the report then states it covers a single card. */
  scopedToCard?: boolean | undefined;
}

export interface BuiltTxnReport {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

/** Brand + document palette, mirroring the mini-app's light-theme tokens. */
const BRAND = {
  amber: 'FFD200',
  amberMid: 'FFBA18',
  orange: 'FF5A00',
  ink: '111318', // --secondary-foreground (light)
  muted: '7A8091', // --muted-foreground (light)
  border: 'E5E8EC', // --border (light)
  zebra: 'F4F5F7', // --background (light)
} as const;

const hex = (h: string) => `#${h}`;
const argb = (h: string) => `FF${h}`;

interface ColumnSpec {
  header: string;
  /** Relative width — used for PDF layout and scaled to the XLSX character grid. */
  weight: number;
  align: 'left' | 'right' | 'center';
  /** Excel number format; presence also marks the column as numeric for alignment/summing. */
  numFmt?: string;
}

const COLUMNS: ColumnSpec[] = [
  { header: 'Date', weight: 9, align: 'left' },
  { header: 'Location', weight: 24, align: 'left' },
  { header: 'City', weight: 14, align: 'left' },
  { header: 'State', weight: 5, align: 'center' },
  { header: 'Card', weight: 9, align: 'left' },
  { header: 'Category', weight: 8, align: 'left' },
  { header: 'Qty', weight: 7, align: 'right', numFmt: '#,##0.00' },
  { header: 'Amount', weight: 9, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount', weight: 9, align: 'right', numFmt: '#,##0.00' },
];

const MAX_PDF_ROWS = 2_000;

/**
 * Excel's default row is ~15pt, which packs the table tight enough to read as a dump. These give
 * every row real vertical air; `vertical: 'middle'` on the cells is what actually uses it.
 */
const XLSX_ROW_H = 20;
const XLSX_HEAD_H = 24;

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
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return s(v).slice(0, 10);
}

/** A row as typed cells — strings stay strings, money/quantity stay numbers so Excel can sum them. */
type Cell = string | number;

interface Grid {
  rows: Cell[][];
  totals: { qty: number; amount: number; discount: number };
}

/** Field fallbacks mirror the mini-app's Transactions sheet: the mart's `line_item_*` names, with
 *  CMP's `funded_total`/`net_total` tolerated. */
function toGrid(txns: ReadonlyArray<Record<string, unknown>>): Grid {
  let qty = 0;
  let amount = 0;
  let discount = 0;
  const rows = txns.map((t) => {
    const a = n(t['line_item_amount'] ?? t['funded_total'] ?? t['net_total']);
    const d = n(t['line_item_discount_amount']);
    const q = n(t['line_item_fuel_quantity'] ?? t['transaction_fuel_quantity']);
    qty += q;
    amount += a;
    discount += d;
    return [
      dateCell(t['transaction_date']),
      s(t['location_name']),
      s(t['location_city']),
      s(t['location_state']),
      `•••• ${last4(t['card_number'])}`,
      s(t['line_item_category']),
      q,
      a,
      d,
    ] as Cell[];
  });
  return { rows, totals: { qty, amount, discount } };
}

/** Filename-safe slug. Also what stops a report smuggling a path separator into sendDocument. */
function safe(part: string): string {
  return (part || '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'export';
}

const subtitle = (meta: TxnReportMeta): string =>
  meta.scopedToCard ? `Card •••• ${meta.cardLast4} · ${meta.range}` : `All cards · ${meta.range}`;

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────
// No branding possible in CSV — it is the machine-readable option. Kept faithful to the grid.

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function toCsv(grid: Grid): string {
  const fmt = (c: Cell, i: number) => (typeof c === 'number' ? (COLUMNS[i]?.numFmt ? c.toFixed(2) : String(c)) : c);
  const body = grid.rows.map((r) => r.map((c, i) => csvEscape(fmt(c, i))).join(','));
  const totals = ['TOTAL', '', '', '', '', '', grid.totals.qty.toFixed(2), grid.totals.amount.toFixed(2), grid.totals.discount.toFixed(2)];
  return [COLUMNS.map((c) => c.header).join(','), ...body, totals.join(',')].join('\r\n');
}

// ── XLSX ───────────────────────────────────────────────────────────────────────────────────────

async function toXlsx(grid: Grid, meta: TxnReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Octane Fuel Cards';
  wb.created = new Date();
  const ws = wb.addWorksheet('Transactions', {
    views: [{ state: 'frozen', ySplit: 4 }], // title block + header stay put while scrolling
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = COLUMNS.length;
  const colLetter = (i: number) => String.fromCharCode(64 + i);

  // Title block — brand ink band with the wordmark, then the report subject.
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = 'OCTANE  ·  Transaction Report';
  title.font = { bold: true, size: 16, color: { argb: argb('FFFFFF') } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.ink) } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = `${meta.company}  ·  ${subtitle(meta)}`;
  sub.font = { bold: true, size: 11, color: { argb: argb(BRAND.ink) } };
  // The logo gradient, as the accent rule under the wordmark.
  sub.fill = {
    type: 'gradient',
    gradient: 'angle',
    degree: 0,
    stops: [
      { position: 0, color: { argb: argb(BRAND.amber) } },
      { position: 0.5, color: { argb: argb(BRAND.amberMid) } },
      { position: 1, color: { argb: argb(BRAND.orange) } },
    ],
  };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 6; // breathing room

  // Header.
  const headerRow = ws.getRow(4);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10, color: { argb: argb('FFFFFF') } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.ink) } };
    cell.alignment = { horizontal: c.align, vertical: 'middle', indent: 1 };
  });
  headerRow.height = XLSX_HEAD_H;

  // Body.
  grid.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    r.forEach((v, i) => {
      const spec = COLUMNS[i];
      if (!spec) return;
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.alignment = { horizontal: spec.align, vertical: 'middle', indent: spec.align === 'right' ? 0 : 1 };
      cell.font = { size: 10, color: { argb: argb(BRAND.ink) } };
      if (spec.numFmt) cell.numFmt = spec.numFmt;
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.zebra) } };
      cell.border = { bottom: { style: 'hair', color: { argb: argb(BRAND.border) } } };
    });
    row.height = XLSX_ROW_H;
  });

  // Totals — real SUM formulas, so the sheet stays correct if a client filters or edits rows.
  const first = 5;
  const lastRow = first + grid.rows.length - 1;
  const totalRow = ws.getRow(lastRow + 1);
  totalRow.getCell(1).value = 'TOTAL';
  [7, 8, 9].forEach((i) => {
    const cell = totalRow.getCell(i);
    cell.value = grid.rows.length ? { formula: `SUM(${colLetter(i)}${first}:${colLetter(i)}${lastRow})` } : 0;
    cell.numFmt = COLUMNS[i - 1]?.numFmt ?? '#,##0.00';
  });
  totalRow.eachCell((cell, i) => {
    cell.font = { bold: true, size: 10, color: { argb: argb(BRAND.ink) } };
    cell.alignment = { horizontal: COLUMNS[i - 1]?.align ?? 'left' };
    cell.border = { top: { style: 'medium', color: { argb: argb(BRAND.orange) } } };
  });
  totalRow.height = XLSX_ROW_H + 3;

  if (grid.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastRow, column: lastCol } };
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(c.header.length + 4, c.weight + 2);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ────────────────────────────────────────────────────────────────────────────────────────

/** Landscape: nine columns (three of them money) do not read on portrait A4. */
const PDF_MARGIN = 36;

/**
 * Row metrics. Rows are given real vertical padding rather than being packed at font height — a
 * client reads and often prints this, and tightly-set rows are what make a table look like a dump.
 * The body font sits ~1pt under the header's so the header still leads.
 */
const ROW_H = 19;
const HEAD_H = 23;
const BODY_PT = 8.5;
const HEAD_PT = 9;

/**
 * pdfkit's built-in Helvetica is WinAnsi-encoded, so a character outside that set silently renders
 * as garbage rather than failing — `→` (U+2192) came out as `!'` in the range subtitle. Map the
 * arrows we emit to an en-dash (which WinAnsi has) and drop anything else unencodable, keeping the
 * typographic characters the report actually uses (• · – — …). Embedding a Unicode TTF would be the
 * alternative, but it is not worth ~300KB per PDF for one arrow.
 */
function pdfSafe(text: string): string {
  return text
    .replace(/[\u2192\u21D2\u279C]/g, '\u2013')
    .replace(/[^\x20-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, '');
}

function pdfHeader(doc: PDFKit.PDFDocument, meta: TxnReportMeta): void {
  const { left, right } = doc.page.margins;
  const w = doc.page.width - left - right;

  doc.rect(left, PDF_MARGIN, w, 34).fill(hex(BRAND.ink));
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text('OCTANE', left + 12, PDF_MARGIN + 10);
  doc.font('Helvetica').fontSize(10).fillColor('#C9CDD6')
    .text('Transaction Report', left + 12, PDF_MARGIN + 13, { width: w - 24, align: 'right' });

  // The logo gradient as the accent rule — the mark's amber→orange, not the v2 button blue.
  const grad = doc.linearGradient(left, 0, left + w, 0);
  grad.stop(0, hex(BRAND.amber)).stop(0.5, hex(BRAND.amberMid)).stop(1, hex(BRAND.orange));
  doc.rect(left, PDF_MARGIN + 34, w, 3).fill(grad);

  doc.fillColor(hex(BRAND.ink)).font('Helvetica-Bold').fontSize(12).text(pdfSafe(meta.company), left, PDF_MARGIN + 48);
  doc.font('Helvetica').fontSize(9).fillColor(hex(BRAND.muted)).text(pdfSafe(subtitle(meta)), left, PDF_MARGIN + 64);
  doc.y = PDF_MARGIN + 84;
}

function pdfTableHeader(doc: PDFKit.PDFDocument, widths: number[]): void {
  const { left } = doc.page.margins;
  const y = doc.y;
  const h = HEAD_H;
  doc.rect(left, y, widths.reduce((a, b) => a + b, 0), h).fill(hex(BRAND.ink));
  doc.font('Helvetica-Bold').fontSize(HEAD_PT).fillColor('#FFFFFF');
  let x = left;
  COLUMNS.forEach((c, i) => {
    const w = widths[i] ?? 0;
    doc.text(pdfSafe(c.header), x + 6, y + (HEAD_H - HEAD_PT) / 2, { width: w - 12, align: c.align });
    x += w;
  });
  doc.y = y + h;
}

async function toPdf(grid: Grid, meta: TxnReportMeta): Promise<Buffer> {
  if (grid.rows.length > MAX_PDF_ROWS) {
    throw new AppError(`That period has ${grid.rows.length} rows — too many for a PDF. Choose Excel or CSV, or a shorter period.`, {
      statusCode: 413,
      code: 'TXN_EXPORT_TOO_LARGE',
      expose: true,
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    // bufferPages is what makes the footer pass below possible: without it pages are flushed as
    // they are finished, so switchToPage() cannot reach page 1 again and only the LAST page ends up
    // with a footer. A one-page report hides that — the last page is also the first.
    const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A4', layout: 'landscape', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const usable = doc.page.width - PDF_MARGIN * 2;
    const totalWeight = COLUMNS.reduce((a, c) => a + c.weight, 0);
    const widths = COLUMNS.map((c) => (c.weight / totalWeight) * usable);

    pdfHeader(doc, meta);
    pdfTableHeader(doc, widths);

    const bottom = doc.page.height - PDF_MARGIN - 24;
    grid.rows.forEach((r, ri) => {
      const rowH = ROW_H;
      if (doc.y + rowH > bottom) {
        doc.addPage();
        pdfHeader(doc, meta);
        pdfTableHeader(doc, widths); // repeat the header on every page — a client may print this
      }
      const y = doc.y;
      if (ri % 2 === 1) doc.rect(PDF_MARGIN, y, usable, rowH).fill(hex(BRAND.zebra));
      doc.font('Helvetica').fontSize(BODY_PT).fillColor(hex(BRAND.ink));
      let x = PDF_MARGIN;
      r.forEach((v, i) => {
        const spec = COLUMNS[i];
        if (!spec) return;
        const w = widths[i] ?? 0;
        const text = typeof v === 'number' ? v.toFixed(2) : v;
        doc.text(pdfSafe(text), x + 6, y + (ROW_H - BODY_PT) / 2, { width: w - 12, align: spec.align, lineBreak: false, ellipsis: true });
        x += w;
      });
      doc.y = y + rowH;
    });

    // Totals. The row loop breaks pages for itself, but this runs after it — without its own check
    // a table ending flush against the bottom would draw the totals over the footer or off-page.
    if (doc.y + ROW_H > bottom) {
      doc.addPage();
      pdfHeader(doc, meta);
      pdfTableHeader(doc, widths);
    }
    const ty = doc.y;
    doc.rect(PDF_MARGIN, ty, usable, 1.5).fill(hex(BRAND.orange));
    doc.font('Helvetica-Bold').fontSize(HEAD_PT).fillColor(hex(BRAND.ink));
    const cells = ['TOTAL', '', '', '', '', '', grid.totals.qty.toFixed(2), grid.totals.amount.toFixed(2), grid.totals.discount.toFixed(2)];
    let tx = PDF_MARGIN;
    cells.forEach((v, i) => {
      const w = widths[i] ?? 0;
      doc.text(pdfSafe(v), tx + 6, ty + (ROW_H - HEAD_PT) / 2 + 2, { width: w - 12, align: COLUMNS[i]?.align ?? 'left', lineBreak: false });
      tx += w;
    });

    // Footer on every page — generated stamp + page numbers.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7).fillColor(hex(BRAND.muted));
      doc.text(
        `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC  ·  Octane Fuel Cards`,
        PDF_MARGIN,
        doc.page.height - PDF_MARGIN - 10,
        { width: usable / 2, align: 'left' },
      );
      doc.text(`Page ${i + 1} of ${range.count}`, PDF_MARGIN + usable / 2, doc.page.height - PDF_MARGIN - 10, {
        width: usable / 2,
        align: 'right',
      });
    }

    doc.end();
  });
}

export async function buildTxnReport(
  txns: ReadonlyArray<Record<string, unknown>>,
  format: TxnReportFormat,
  meta: TxnReportMeta,
): Promise<BuiltTxnReport> {
  const grid = toGrid(txns);
  const base = `Octane_Transactions_${safe(meta.cardLast4)}_${safe(meta.range)}`;
  if (format === 'csv') {
    // Leading BOM so Excel reads the UTF-8 bytes as UTF-8 rather than the local ANSI codepage.
    return { fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8', bytes: Buffer.from(`\uFEFF${toCsv(grid)}`, 'utf8') };
  }
  if (format === 'xlsx') {
    return {
      fileName: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: await toXlsx(grid, meta),
    };
  }
  return { fileName: `${base}.pdf`, contentType: 'application/pdf', bytes: await toPdf(grid, meta) };
}
