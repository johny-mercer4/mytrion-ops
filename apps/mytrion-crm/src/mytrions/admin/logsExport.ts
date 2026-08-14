/**
 * CSV / XLSX export for the Admin log tabs (Audit Log, Automation Logs).
 *
 * Generic over the row type so both feeds declare their own columns and share the delivery, the
 * escaping and the workbook styling. ExcelJS is a dynamic import — it only loads when someone
 * actually exports — and delivery goes through `deliverExport`, so an export started inside the
 * Telegram WebView is sent to the worker's Horizon chat rather than dying as a dead download.
 */
import { deliverExport } from '@/lib/deliverExport';

export interface ExportColumn<T> {
  header: string;
  /** Excel column width, in characters. */
  width: number;
  value: (row: T) => string | number | null;
}

export interface ExportMeta {
  /** Workbook/sheet title, e.g. 'AUDIT LOG'. */
  title: string;
  subtitle: string;
  /** Human-readable description of the filters this export was taken under. */
  filters: string[];
  /** Filename stem — the timestamp and extension are appended. */
  filenameStem: string;
  sheetName: string;
}

const F = 'Arial';
const C = {
  ink: 'FF0F172A', body: 'FF334155', muted: 'FF64748B',
  headFill: 'FF1E293B', band: 'FFF8FAFC', line: 'FFE2E8F0', white: 'FFFFFFFF',
};

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function filterLine(meta: ExportMeta): string {
  return meta.filters.length > 0 ? meta.filters.join(' · ') : 'None (unfiltered)';
}

/**
 * Neutralise spreadsheet formula injection.
 *
 * Audit rows carry user-controlled text (display names, company names, tool arguments). A cell
 * beginning `=`, `+`, `-`, `@`, or a lone tab/CR is executed as a formula by Excel and Sheets on
 * open, which turns "export the audit log" into an code-execution vector against whoever opens the
 * file. Prefixing with an apostrophe forces the cell to text; the apostrophe is not displayed.
 */
function deFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(raw: string | number | null): string {
  if (raw === null || raw === undefined) return '';
  const text = deFormula(String(raw));
  // Quote when the value contains a delimiter, a quote, or a newline; double any inner quotes.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The CSV document as a string — exported separately from the delivery so the escaping rules can
 * be tested directly. (jsdom's Blob has no `.text()`, so asserting through the blob is not an
 * option, and the escaping is the part worth pinning.)
 */
export function buildCsv<T>(
  rows: readonly T[],
  columns: ReadonlyArray<ExportColumn<T>>,
  meta: ExportMeta,
): string {
  const lines: string[] = [
    `${meta.title} — ${meta.subtitle}`,
    `Filters: ${filterLine(meta)}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Rows: ${rows.length}`,
    '',
    columns.map((c) => csvCell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** Filtered rows as CSV. Excel needs the BOM to read the file as UTF-8 rather than as ANSI. */
export async function exportRowsCsv<T>(
  rows: readonly T[],
  columns: ReadonlyArray<ExportColumn<T>>,
  meta: ExportMeta,
): Promise<void> {
  const blob = new Blob([`﻿${buildCsv(rows, columns, meta)}`], {
    type: 'text/csv;charset=utf-8',
  });
  await deliverExport(blob, `${meta.filenameStem}_${stamp()}.csv`);
}

/** Filtered rows as a styled single-sheet workbook: title block, dark header, bands, autofilter. */
export async function exportRowsXlsx<T>(
  rows: readonly T[],
  columns: ReadonlyArray<ExportColumn<T>>,
  meta: ExportMeta,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(meta.sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = columns.map((c) => ({ width: c.width }));
  const lastCol = columns.length;
  let r = 1;
  const merge = (row: number): void => {
    if (lastCol > 1) ws.mergeCells(row, 1, row, lastCol);
  };

  merge(r);
  ws.getCell(r, 1).value = meta.title;
  ws.getCell(r, 1).font = { name: F, size: 9, bold: true, color: { argb: C.muted } };
  r++;

  merge(r);
  ws.getCell(r, 1).value = meta.subtitle;
  ws.getCell(r, 1).font = { name: F, size: 16, bold: true, color: { argb: C.ink } };
  ws.getRow(r).height = 22;
  r++;

  merge(r);
  ws.getCell(r, 1).value = [
    `Filters: ${filterLine(meta)}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Rows: ${rows.length}`,
  ].join('   ·   ');
  ws.getCell(r, 1).font = { name: F, size: 9, color: { argb: C.muted } };
  r++;

  ws.getRow(r).height = 6;
  r++; // spacer

  const headerRow = r;
  columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  ws.getRow(headerRow).height = 20;
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: lastCol } };
  r++;

  rows.forEach((row, i) => {
    const sheetRow = ws.getRow(r);
    columns.forEach((c, ci) => {
      const raw = c.value(row);
      const cell = sheetRow.getCell(ci + 1);
      // Same formula-injection guard as the CSV path — ExcelJS writes a leading '=' as a formula.
      cell.value = typeof raw === 'number' ? raw : raw === null ? '' : deFormula(String(raw));
      cell.font = { name: F, size: 10, color: { argb: C.body } };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } };
    });
    r++;
  });

  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await deliverExport(blob, `${meta.filenameStem}_${stamp()}.xlsx`);
}
