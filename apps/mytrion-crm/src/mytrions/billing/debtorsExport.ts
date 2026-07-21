/**
 * Styled Debtors .xlsx export — matches the billing Prepay ledger workbook conventions
 * (title block, summary, dark banded table, totals row with SUM formulas + cached results,
 * frozen header, autofilter). NOT a default column dump: two styled sheets —
 *   • "Debtors"  — one row per carrier (company, cycle, status, age, counts, owed/remaining)
 *   • "Invoices" — the flattened invoice detail behind those debtors
 * ExcelJS is code-split (dynamic import) so it only loads when someone actually exports.
 */
import type { Debtor } from './data';
import { fmtCycle } from './data';

const F = 'Arial';
const C = {
  ink: 'FF0F172A', body: 'FF334155', muted: 'FF64748B', faint: 'FF94A3B8',
  headFill: 'FF1E293B', band: 'FFF8FAFC', totalFill: 'FFF1F5F9',
  red: 'FFDC2626', amber: 'FFB45309', line: 'FFE2E8F0', white: 'FFFFFFFF',
};
const MONEY = '$#,##0.00;[Red]($#,##0.00);"–"';
const num = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** YYYY-MM-DD → UTC-anchored Date (ExcelJS serialises via UTC; local midnight would shift ±1 day). */
function ymdToDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function fmtDay(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return s || '—';
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

export interface DebtorsExportMeta {
  statusLabel: string;
  ageLabel: string;
  search: string;
}

export async function exportDebtorsXlsx(rows: Debtor[], meta: DebtorsExportMeta): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const totalRemaining = num(rows.reduce((s, d) => s + d.totalRemaining, 0));
  const totalOwed = num(rows.reduce((s, d) => s + d.totalOwed, 0));
  const hardCount = rows.filter((d) => d.isHard).length;

  // ─────────────────────── Sheet 1: Debtors ───────────────────────
  const ws = wb.addWorksheet('Debtors', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 34 }, { width: 13 }, { width: 16 }, { width: 12 },
    { width: 11 }, { width: 12 }, { width: 10 }, { width: 15 }, { width: 16 },
  ];
  const LAST = 'I';
  let r = 1;
  const merge = (row: number) => ws.mergeCells(`A${row}:${LAST}${row}`);

  merge(r);
  ws.getCell(`A${r}`).value = 'DEBTORS REPORT';
  ws.getCell(`A${r}`).font = { name: F, size: 9, bold: true, color: { argb: C.muted } };
  r++;

  merge(r);
  ws.getCell(`A${r}`).value = 'Billing · Outstanding Invoices';
  ws.getCell(`A${r}`).font = { name: F, size: 16, bold: true, color: { argb: C.ink } };
  ws.getRow(r).height = 22;
  r++;

  merge(r);
  const filters: string[] = [];
  if (meta.statusLabel && meta.statusLabel !== 'All Statuses') filters.push(meta.statusLabel);
  if (meta.ageLabel && meta.ageLabel !== 'All Ages') filters.push(meta.ageLabel);
  if (meta.search.trim()) filters.push(`Search: "${meta.search.trim()}"`);
  const metaBits = [
    `Filters: ${filters.length ? filters.join(' · ') : 'None (full book)'}`,
    `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
  ];
  ws.getCell(`A${r}`).value = metaBits.join('   ·   ');
  ws.getCell(`A${r}`).font = { name: F, size: 9, color: { argb: C.muted } };
  r++;

  ws.getRow(r).height = 6;
  r++; // spacer

  // Summary block
  const summary: [string, number | string][] = [
    ['Total Debtors', rows.length],
    ['Total Outstanding', totalRemaining],
    ['Hard Debt (≥15d)', `${hardCount} carrier${hardCount === 1 ? '' : 's'}`],
  ];
  for (const [label, val] of summary) {
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { name: F, size: 10, bold: true, color: { argb: C.body } };
    const bc = ws.getCell(`B${r}`);
    bc.value = val;
    if (typeof val === 'number' && label === 'Total Outstanding') bc.numFmt = MONEY;
    bc.font = { name: F, size: 11, bold: true, color: { argb: label === 'Hard Debt (≥15d)' ? C.red : C.ink } };
    r++;
  }

  ws.getRow(r).height = 6;
  r++; // spacer

  // Table header
  const headerRow = r;
  const header = ['Company', 'Carrier ID', 'Billing Cycle', 'Status', 'Age (days)', 'Hard Debt', 'Invoices', 'Total Owed', 'Total Remaining'];
  header.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
    cell.alignment = { horizontal: i === 0 ? 'left' : i >= 4 ? 'right' : 'left', vertical: 'middle' };
  });
  ws.getRow(headerRow).height = 20;
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: 9 } };
  r++;

  const dataStart = r;
  rows.forEach((d, i) => {
    const row = ws.getRow(r);
    row.getCell(1).value = d.company;
    row.getCell(2).value = d.carrierId;
    row.getCell(3).value = fmtCycle(d.cycle) || '—';
    row.getCell(4).value = d.worstStatus === 'partially_paid' ? 'Partial' : 'Pending';
    row.getCell(5).value = d.age;
    row.getCell(6).value = d.isHard ? 'Yes' : 'No';
    row.getCell(7).value = d.invoiceCount;
    row.getCell(8).value = num(d.totalOwed);
    row.getCell(8).numFmt = MONEY;
    row.getCell(9).value = num(d.totalRemaining);
    row.getCell(9).numFmt = MONEY;
    for (let c = 1; c <= 9; c++) {
      const cell = row.getCell(c);
      cell.font = { name: F, size: 10, color: { argb: C.body } };
      cell.alignment = { horizontal: c === 1 || c === 3 || c === 4 ? 'left' : c === 2 ? 'left' : 'right', vertical: 'middle' };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } };
    }
    // Emphasise risk: hard-debt age + status get colour.
    if (d.isHard) {
      row.getCell(5).font = { name: F, size: 10, bold: true, color: { argb: C.red } };
      row.getCell(6).font = { name: F, size: 10, bold: true, color: { argb: C.red } };
    }
    if (d.worstStatus === 'partially_paid') {
      row.getCell(4).font = { name: F, size: 10, bold: true, color: { argb: C.amber } };
    }
    r++;
  });
  const dataEnd = r - 1;

  // Totals row — SUM formulas with cached results (viewers that never recalc still see totals).
  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = `Total · ${rows.length} debtor${rows.length === 1 ? '' : 's'}`;
  totalRow.getCell(8).value = dataEnd >= dataStart ? { formula: `SUM(H${dataStart}:H${dataEnd})`, result: totalOwed } : 0;
  totalRow.getCell(9).value = dataEnd >= dataStart ? { formula: `SUM(I${dataStart}:I${dataEnd})`, result: totalRemaining } : 0;
  totalRow.getCell(8).numFmt = MONEY;
  totalRow.getCell(9).numFmt = MONEY;
  for (let c = 1; c <= 9; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.ink } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalFill } };
    cell.border = { top: { style: 'medium', color: { argb: C.headFill } } };
    if (c >= 5) cell.alignment = { horizontal: 'right' };
  }
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  // ─────────────────────── Sheet 2: Invoices ───────────────────────
  const wi = wb.addWorksheet('Invoices', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  wi.columns = [
    { width: 13 }, { width: 30 }, { width: 18 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 15 },
  ];
  const iHead = ['Carrier ID', 'Company', 'Invoice #', 'Created', 'Age (days)', 'Total', 'Remaining'];
  iHead.forEach((h, i) => {
    const cell = wi.getCell(1, i + 1);
    cell.value = h;
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
    cell.alignment = { horizontal: i >= 4 ? 'right' : 'left', vertical: 'middle' };
  });
  wi.getRow(1).height = 20;

  let ir = 2;
  let band = 0;
  const invStart = ir;
  for (const d of rows) {
    for (const inv of d.invoices) {
      const row = wi.getRow(ir);
      row.getCell(1).value = d.carrierId;
      row.getCell(2).value = d.company;
      row.getCell(3).value = inv.num || '—';
      const dt = ymdToDate(inv.created);
      if (dt) { row.getCell(4).value = dt; row.getCell(4).numFmt = 'mmm d, yyyy'; }
      else row.getCell(4).value = fmtDay(inv.created);
      row.getCell(5).value = inv.age;
      row.getCell(6).value = num(inv.total);
      row.getCell(6).numFmt = MONEY;
      row.getCell(7).value = num(inv.remaining);
      row.getCell(7).numFmt = MONEY;
      for (let c = 1; c <= 7; c++) {
        const cell = row.getCell(c);
        cell.font = { name: F, size: 10, color: { argb: C.body } };
        cell.alignment = { horizontal: c >= 5 ? 'right' : 'left', vertical: 'middle' };
        if (band % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
        cell.border = { bottom: { style: 'hair', color: { argb: C.line } } };
      }
      if (inv.age >= 15) row.getCell(5).font = { name: F, size: 10, bold: true, color: { argb: C.red } };
      ir++;
    }
    band++;
  }
  const invEnd = ir - 1;
  if (invEnd >= invStart) {
    wi.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  }
  wi.views = [{ state: 'frozen', ySplit: 1 }];

  wb.calcProperties.fullCalcOnLoad = true;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const fname = `Debtors_Report_${stamp}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
