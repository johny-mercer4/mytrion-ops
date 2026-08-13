/**
 * Writes a standing report to a styled .xlsx.
 *
 * ExcelJS is dynamically imported so the ~940kB chunk only loads when someone actually exports —
 * the same approach the Billing debtors and Sales transaction exports use.
 *
 * Cells are written with real types, not pre-formatted strings: money/number/percent land as
 * numbers carrying an Excel number format, dates as date cells. A sheet of strings looks identical
 * on screen and is useless the moment someone sorts, filters or SUMs it — which is the whole point
 * of exporting to Excel rather than reading the dashboard.
 */
import type { ReportColumn, ReportResult } from '@/api/analytics';
import { deliverExport } from '@/lib/deliverExport';

const F = 'Arial';
const C = {
  ink: 'FF0F172A',
  muted: 'FF64748B',
  headFill: 'FF1E293B',
  band: 'FFF8FAFC',
  totalFill: 'FFF1F5F9',
  line: 'FFE2E8F0',
  white: 'FFFFFFFF',
  warn: 'FFB45309',
};

const MONEY = '$#,##0.00;[Red]($#,##0.00);"–"';
const NUMBER = '#,##0.##';
const PERCENT = '0.0%';
const DATE = 'yyyy-mm-dd';

function formatFor(type: ReportColumn['type']): string | undefined {
  if (type === 'money') return MONEY;
  if (type === 'number') return NUMBER;
  if (type === 'percent') return PERCENT;
  if (type === 'date') return DATE;
  return undefined;
}

/** YYYY-MM-DD → UTC-anchored Date. Local midnight would shift the day by ±1 on serialisation. */
function ymdToDate(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Excel forbids []:*?/\ in sheet names and caps them at 31 chars. */
function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Report';
}

export interface ReportExportMeta {
  /** Human label for the window, e.g. "Last 7 days" or "2026-06-01 → 2026-06-30". */
  rangeLabel: string;
  /** Agent the view is scoped to, when scoped. */
  agentName?: string | null;
}

/**
 * Build the workbook and return the raw .xlsx bytes.
 *
 * Separate from `exportReportXlsx` so the sheet can be built and read back in a test — the download
 * half touches `document`/`URL`, this half is pure and is where every formatting decision lives.
 */
export async function buildReportWorkbook(
  result: ReportResult,
  meta: ReportExportMeta,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(result.generatedAt);

  const ws = wb.addWorksheet(safeSheetName(result.sheet), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  const cols = result.columns;
  ws.columns = cols.map((c) => ({ width: c.width ?? 16 }));
  const lastCol = String.fromCharCode(64 + Math.min(cols.length, 26));
  const merge = (row: number) => ws.mergeCells(`A${row}:${lastCol}${row}`);

  // ── Title block ────────────────────────────────────────────────────────────
  merge(1);
  const title = ws.getCell('A1');
  title.value = result.title;
  title.font = { name: F, size: 16, bold: true, color: { argb: C.ink } };
  ws.getRow(1).height = 24;

  merge(2);
  const sub = ws.getCell('A2');
  sub.value = [
    meta.rangeLabel,
    meta.agentName ? `Agent: ${meta.agentName}` : 'All agents',
    `Generated ${new Date(result.generatedAt).toLocaleString('en-GB')}`,
    `${result.rows.length.toLocaleString('en-US')} rows`,
  ].join('   ·   ');
  sub.font = { name: F, size: 10, color: { argb: C.muted } };

  if (result.truncated) {
    merge(3);
    const warn = ws.getCell('A3');
    warn.value = `Partial export — capped at ${result.rows.length.toLocaleString('en-US')} rows. Narrow the date range for a complete sheet.`;
    warn.font = { name: F, size: 10, bold: true, color: { argb: C.warn } };
  }

  // ── Header row (row 5; row 4 left as a spacer) ─────────────────────────────
  const HEAD = 5;
  const head = ws.getRow(HEAD);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: c.type === 'text' ? 'left' : 'right',
      wrapText: true,
    };
  });
  head.height = 20;

  // ── Body ───────────────────────────────────────────────────────────────────
  result.rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const raw = r[c.key];
      if (raw == null) {
        cell.value = null;
      } else if (c.type === 'date') {
        const d = ymdToDate(raw);
        cell.value = d ?? String(raw);
      } else if (c.type === 'text') {
        cell.value = String(raw);
      } else {
        cell.value = typeof raw === 'number' ? raw : Number(raw);
      }
      const fmt = formatFor(c.type);
      if (fmt) cell.numFmt = fmt;
      cell.font = { name: F, size: 10, color: { argb: C.ink } };
      cell.alignment = { horizontal: c.type === 'text' ? 'left' : 'right' };
      if (ri % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
      }
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } };
    });
  });

  // ── Totals for summable columns ────────────────────────────────────────────
  const summable = cols
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === 'money' || c.type === 'number');
  if (result.rows.length > 0 && summable.length > 0) {
    const totalRowIdx = HEAD + 1 + result.rows.length;
    const row = ws.getRow(totalRowIdx);
    row.getCell(1).value = 'Total';
    row.getCell(1).font = { name: F, size: 10, bold: true, color: { argb: C.ink } };
    for (const { c, i } of summable) {
      const letter = String.fromCharCode(65 + i);
      const cell = row.getCell(i + 1);
      // Formula + cached result: Excel shows the value before it recalculates, and other
      // spreadsheet apps that ignore formulas still render a correct number.
      const sum = result.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      cell.value = {
        formula: `SUM(${letter}${HEAD + 1}:${letter}${totalRowIdx - 1})`,
        result: Math.round(sum * 100) / 100,
      };
      // Only money/number reach here, so a format always exists; NUMBER is a defensive default.
      cell.numFmt = formatFor(c.type) ?? NUMBER;
      cell.font = { name: F, size: 10, bold: true, color: { argb: C.ink } };
      cell.alignment = { horizontal: 'right' };
    }
    for (let i = 0; i < cols.length; i++) {
      row.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalFill } };
    }
  }

  ws.autoFilter = {
    from: { row: HEAD, column: 1 },
    to: { row: HEAD + Math.max(result.rows.length, 1), column: cols.length },
  };

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Build the sheet and hand it to the browser as a download. */
export async function exportReportXlsx(result: ReportResult, meta: ReportExportMeta): Promise<void> {
  const buf = await buildReportWorkbook(result, meta);
  const stamp = new Date(result.generatedAt).toISOString().slice(0, 10);
  await deliverExport(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${result.reportId}-${stamp}.xlsx`,
  );
}
