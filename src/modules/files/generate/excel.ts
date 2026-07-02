import ExcelJS from 'exceljs';
import { AppError } from '../../../lib/errors.js';
import type { CsvCell } from './csv.js';

export interface ExcelSheetSpec {
  name: string;
  columns: string[];
  rows: CsvCell[][];
}

export const MAX_XLSX_ROWS = 100_000;

export async function generateExcel(sheets: ExcelSheetSpec[]): Promise<Buffer> {
  const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0);
  if (totalRows > MAX_XLSX_ROWS) {
    throw new AppError(`Workbook exceeds ${MAX_XLSX_ROWS} rows`, { statusCode: 413, code: 'FILE_TOO_LARGE' });
  }
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Sheet');
    ws.addRow(sheet.columns);
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
    ws.columns.forEach((col, i) => {
      const header = sheet.columns[i] ?? '';
      col.width = Math.min(Math.max(header.length + 2, 12), 40);
    });
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
