import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { ReportResult } from '@/api/analytics';

import { buildReportWorkbook, type ReportExportMeta } from './reportsExport';

/**
 * Builds a real workbook and reads it back with ExcelJS. The point of exporting to a spreadsheet is
 * that the numbers are numbers — a sheet of pre-formatted strings looks identical on screen and
 * breaks the moment anyone sorts or SUMs it, so these assertions are on cell TYPES and formats,
 * not on rendered text.
 */
const RESULT: ReportResult = {
  reportId: 'fuel-volume',
  title: 'Fuel volume',
  sheet: 'Fuel volume',
  generatedAt: '2026-08-03T10:00:00.000Z',
  truncated: false,
  columns: [
    { key: 'company_name', label: 'Company', type: 'text', width: 30 },
    { key: 'gallons', label: 'Gallons', type: 'number' },
    { key: 'spend', label: 'Spend', type: 'money' },
    { key: 'to_cards_pct', label: 'To cards %', type: 'percent' },
    { key: 'last_transaction', label: 'Last swipe', type: 'date' },
  ],
  rows: [
    { company_name: 'KBUFF TRUCKING LTD', gallons: 29579.77, spend: 103498.29, to_cards_pct: 0.1944, last_transaction: '2026-08-03' },
    { company_name: 'MAGA TRUCKING CORP', gallons: 27385.5, spend: 98000.5, to_cards_pct: 0.5, last_transaction: '2026-07-30' },
    { company_name: 'NULLS INC', gallons: null, spend: null, to_cards_pct: null, last_transaction: null },
  ],
};

async function readBack(
  result: ReportResult,
  meta: ReportExportMeta = { rangeLabel: 'Last 7 days', agentName: null },
) {
  const buf = await buildReportWorkbook(result, meta);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe('report .xlsx export', () => {
  it('produces a loadable workbook with the report sheet', async () => {
    const wb = await readBack(RESULT);
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.getWorksheet('Fuel volume')).toBeTruthy();
  });

  it('writes numbers as numbers and dates as dates — not strings', async () => {
    const ws = (await readBack(RESULT)).getWorksheet('Fuel volume')!;
    const firstDataRow = 6; // title(1) sub(2) spacer(3,4) header(5)
    const row = ws.getRow(firstDataRow);
    expect(row.getCell(1).value).toBe('KBUFF TRUCKING LTD');
    expect(typeof row.getCell(2).value).toBe('number');
    expect(row.getCell(3).value).toBe(103498.29);
    expect(typeof row.getCell(4).value).toBe('number');
    expect(row.getCell(5).value).toBeInstanceOf(Date);
  });

  it('anchors dates to UTC so the day does not shift', async () => {
    const ws = (await readBack(RESULT)).getWorksheet('Fuel volume')!;
    const d = ws.getRow(6).getCell(5).value as Date;
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('applies money / percent number formats', async () => {
    const ws = (await readBack(RESULT)).getWorksheet('Fuel volume')!;
    const row = ws.getRow(6);
    expect(row.getCell(3).numFmt).toContain('$');
    expect(row.getCell(4).numFmt).toBe('0.0%');
  });

  it('leaves null cells empty rather than writing "null"', async () => {
    const ws = (await readBack(RESULT)).getWorksheet('Fuel volume')!;
    const row = ws.getRow(8); // the NULLS INC row
    expect(row.getCell(1).value).toBe('NULLS INC');
    for (const col of [2, 3, 4, 5]) {
      expect(row.getCell(col).value ?? null).toBeNull();
    }
  });

  it('totals summable columns with a formula and a cached result', async () => {
    const ws = (await readBack(RESULT)).getWorksheet('Fuel volume')!;
    const totalRow = ws.getRow(6 + RESULT.rows.length);
    expect(totalRow.getCell(1).value).toBe('Total');
    const spend = totalRow.getCell(3).value as { formula: string; result: number };
    expect(spend.formula).toBe('SUM(C6:C8)');
    expect(spend.result).toBeCloseTo(201498.79, 2);
    // Text columns get no total.
    expect(totalRow.getCell(1).value).not.toHaveProperty('formula');
  });

  it('says so in the sheet when the row cap truncated the export', async () => {
    const ws = (await readBack({ ...RESULT, truncated: true })).getWorksheet('Fuel volume')!;
    expect(String(ws.getCell('A3').value)).toMatch(/partial export/i);
  });

  it('carries the window and agent scope into the header so a saved file is self-describing', async () => {
    const wb = await readBack(RESULT, { rangeLabel: '2026-06-01 → 2026-06-30', agentName: 'Daniel Brown' });
    const sub = String(wb.getWorksheet('Fuel volume')!.getCell('A2').value);
    expect(sub).toContain('2026-06-01 → 2026-06-30');
    expect(sub).toContain('Daniel Brown');
  });

  it('sanitises sheet names Excel would reject', async () => {
    const wb = await readBack({ ...RESULT, sheet: 'A/B:C*D?E[F]' });
    expect(wb.worksheets[0]!.name).not.toMatch(/[[\]:*?/\\]/);
  });
});
