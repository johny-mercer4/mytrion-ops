/**
 * Turning a `LoyaltyExportPayload` into a downloaded file — the two formats, and nothing else.
 *
 * Both walk the SAME `EXPORT_COLUMNS`, so the .csv and the .xlsx carry identical columns in identical
 * order with identical labels and identical picklist text. That is the point of the column list being
 * data: a reader who reconciles one against the other finds them the same file in two encodings, not
 * two exports that happen to be about the same month.
 *
 * ExcelJS (≈900 KB) is behind a dynamic import, so the Marketing bundle only pays for it when someone
 * actually asks for a workbook — the same treatment the Debtors and Referral exports give it.
 */
import type { LoyaltyExportPayload, LoyaltyExportRow } from './loyaltyExportModel';
import { EXPORT_COLUMNS, exportFileStem } from './loyaltyExportModel';
import { deliverExport } from '@/lib/deliverExport';

export type LoyaltyExportFormat = 'xlsx' | 'csv';

/**
 * CSV rendering of one cell.
 *
 * Dates go out as `YYYY-MM-DD` rather than a locale string: this file gets opened in Excel, Sheets and
 * pandas, and `07/08/2026` is two different days depending on which. Numbers are unformatted — the
 * thousands separators and the `+0.0%` belong to the styled workbook, not to a machine-readable file.
 * Everything is quoted, including numbers, so a company name with a comma cannot shift a row.
 */
function csvCell(value: string | number | Date | null): string {
  if (value == null) return '""';
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildLoyaltyCsv(rows: readonly LoyaltyExportRow[]): string {
  const lines = [
    EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => csvCell(column.value(row))).join(',')),
  ];
  // CRLF + a BOM: without the BOM Excel on Windows reads UTF-8 company names as mojibake.
  return `﻿${lines.join('\r\n')}`;
}

/**
 * Build and download the chosen format.
 *
 * `generatedAt` is a parameter rather than a `new Date()` inside the workbook builder so a test can
 * assert on a fixed stamp, and so the filename and the workbook's own "Generated" line can never
 * disagree by a second across a midnight boundary.
 */
export async function downloadLoyaltyExport(
  payload: LoyaltyExportPayload,
  format: LoyaltyExportFormat,
  generatedAt: Date = new Date(),
): Promise<void> {
  const stem = exportFileStem(payload.roster, payload.scope);
  if (format === 'csv') {
    await deliverExport(
      new Blob([buildLoyaltyCsv(payload.rows)], { type: 'text/csv;charset=utf-8' }),
      `${stem}.csv`,
    );
    return;
  }
  const [{ default: ExcelJS }, { buildLoyaltyWorkbook }] = await Promise.all([
    import('exceljs'),
    import('./loyaltyExportWorkbook'),
  ]);
  const workbook = new ExcelJS.Workbook();
  buildLoyaltyWorkbook(workbook, payload, generatedAt);
  const buffer = await workbook.xlsx.writeBuffer();
  await deliverExport(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${stem}.xlsx`,
  );
}
