/**
 * EFS (money code) report — the "EFS report" half of the weekly accounting ritual ("fuel and EFS
 * report, both retail and with discount, pdf and xlsx" — 72 asks in the 9-group chat analysis;
 * display_features_prioritet.md P0-2). Source is the local money_code_requests journal (the same
 * table the money_code.list touchpoint reads), grouped per PHYSICAL draw: a multi-invoice
 * waterfall shares batch_id and one EFS code = Σ money_code_amount, so a draw here is the primary
 * row (batch_id IS NULL) plus its siblings.
 *
 * THE CODE VALUE IS NEVER IN A REPORT — efs_money_code stays server-side (the same rule as
 * notifications and bot replies). Owner-only at the route: money codes are company finances.
 *
 * Branding mirrors txnReport.ts (amber→orange mark, light-theme tokens) so the two documents in
 * the accounting bundle read as one set.
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { moneyCodeRequests } from '../../db/schema/index.js';
import type { BuiltTxnReport, TxnReportFormat } from './txnReport.js';

export interface MoneyCodeDraw {
  /** Primary money_code_requests row id of the draw — the void handle. */
  id: number;
  /** NY-date of the draw (requested_ny_date, falling back to created_at in NY). */
  date: string;
  amount: number;
  used: number;
  status: string;
  reason: string;
  unit: string;
  requestedBy: string;
  validUntil: string;
}

export interface MoneyCodeReportMeta {
  company: string;
  /** Human label for the window, e.g. "2026-07-01 → 2026-07-17". */
  range: string;
}

const BRAND = {
  amber: 'FFD200',
  orange: 'FF5A00',
  ink: '111318',
  muted: '7A8091',
  border: 'E5E8EC',
  zebra: 'F4F5F7',
} as const;
const hex = (h: string) => `#${h}`;
const argb = (h: string) => `FF${h}`;

/** Draws for one carrier inside a [from, to] NY-date window (YYYY-MM-DD, inclusive). */
export async function listMoneyCodeDraws(carrierId: string, from: string, to: string): Promise<MoneyCodeDraw[]> {
  const cid = Number(carrierId);
  if (!Number.isFinite(cid)) return [];
  const rows = await db
    .select()
    .from(moneyCodeRequests)
    .where(
      sql`${moneyCodeRequests.carrierId} = ${cid}
        AND coalesce(${moneyCodeRequests.requestedNyDate}, (${moneyCodeRequests.createdAt} AT TIME ZONE 'America/New_York')::date)
            BETWEEN ${from}::date AND ${to}::date`,
    )
    .orderBy(sql`${moneyCodeRequests.createdAt} asc`);

  // Group per physical draw: key = batch primary id. Sibling rows point batch_id at the primary.
  const byDraw = new Map<number, typeof rows>();
  for (const r of rows) {
    const key = r.batchId ?? r.id;
    const list = byDraw.get(key);
    if (list) list.push(r);
    else byDraw.set(key, [r]);
  }
  const draws: MoneyCodeDraw[] = [];
  for (const group of byDraw.values()) {
    const primary = group.find((r) => r.batchId == null) ?? group[0];
    if (!primary) continue;
    const amount = group.reduce((s, r) => s + (Number(r.moneyCodeAmount ?? 0) || 0), 0);
    const used = group.reduce((s, r) => s + (Number(r.usedAmount ?? 0) || 0), 0);
    draws.push({
      id: primary.id,
      date: primary.requestedNyDate ?? primary.createdAt.toISOString().slice(0, 10),
      amount,
      used,
      status: primary.status,
      reason: primary.moneycodeReason ?? '',
      unit: primary.unitNumber ?? '',
      requestedBy: primary.requestedBy ?? '',
      validUntil: primary.validUntil ? primary.validUntil.toISOString().slice(0, 10) : '',
    });
  }
  draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return draws;
}

const COLUMNS = [
  { header: 'Date', xlsxWidth: 13, weight: 12, align: 'left' as const },
  { header: 'Amount', xlsxWidth: 13, weight: 12, align: 'right' as const, money: true },
  { header: 'Used', xlsxWidth: 13, weight: 11, align: 'right' as const, money: true },
  { header: 'Status', xlsxWidth: 11, weight: 11, align: 'left' as const },
  { header: 'Reason', xlsxWidth: 20, weight: 18, align: 'left' as const },
  { header: 'Unit', xlsxWidth: 10, weight: 9, align: 'left' as const },
  { header: 'Requested by', xlsxWidth: 22, weight: 17, align: 'left' as const },
  { header: 'Valid until', xlsxWidth: 13, weight: 12, align: 'left' as const },
];

function cells(d: MoneyCodeDraw): Array<string | number> {
  return [d.date, d.amount, d.used, d.status, d.reason, d.unit, d.requestedBy, d.validUntil];
}

export async function buildMoneyCodeReport(
  draws: MoneyCodeDraw[],
  format: TxnReportFormat,
  meta: MoneyCodeReportMeta,
): Promise<BuiltTxnReport> {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `Octane_EFS_MoneyCodes_${stamp}`;
  const totalAmount = draws.reduce((s, d) => s + d.amount, 0);
  const totalUsed = draws.reduce((s, d) => s + d.used, 0);

  if (format === 'csv') {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [COLUMNS.map((c) => c.header).join(',')];
    for (const d of draws) lines.push(cells(d).map(esc).join(','));
    lines.push(['TOTAL', totalAmount.toFixed(2), totalUsed.toFixed(2), '', '', '', '', ''].join(','));
    return { fileName: `${base}.csv`, contentType: 'text/csv', bytes: Buffer.from(lines.join('\n'), 'utf8') };
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Money Codes', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = COLUMNS.map((c) => ({ width: c.xlsxWidth }));
    ws.mergeCells(1, 1, 1, COLUMNS.length);
    const title = ws.getCell(1, 1);
    title.value = `${meta.company} — EFS Money Code Report`;
    title.font = { bold: true, size: 14, color: { argb: argb(BRAND.ink) } };
    ws.mergeCells(2, 1, 2, COLUMNS.length);
    const sub = ws.getCell(2, 1);
    sub.value = `${meta.range} · ${draws.length} draw(s)`;
    sub.font = { size: 10, color: { argb: argb(BRAND.muted) } };
    ws.getRow(3).height = 4;
    ws.getRow(3).eachCell({ includeEmpty: true }, () => undefined);
    const head = ws.getRow(4);
    COLUMNS.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, size: 10, color: { argb: argb(BRAND.ink) } };
      cell.fill = { type: 'gradient', gradient: 'angle', degree: 0, stops: [{ position: 0, color: { argb: argb(BRAND.amber) } }, { position: 1, color: { argb: argb(BRAND.orange) } }] };
      cell.alignment = { horizontal: c.align };
      cell.border = { bottom: { style: 'thin', color: { argb: argb(BRAND.border) } } };
    });
    draws.forEach((d, ri) => {
      const row = ws.getRow(5 + ri);
      cells(d).forEach((v, i) => {
        const col = COLUMNS[i];
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.alignment = { horizontal: col?.align ?? 'left' };
        if (col?.money) cell.numFmt = '#,##0.00';
        cell.font = { size: 10, color: { argb: argb(BRAND.ink) } };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.zebra) } };
      });
    });
    const totalRow = ws.getRow(5 + draws.length);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(1).font = { bold: true, size: 10, color: { argb: argb(BRAND.ink) } };
    totalRow.getCell(2).value = totalAmount;
    totalRow.getCell(3).value = totalUsed;
    for (const i of [2, 3]) {
      const c = totalRow.getCell(i);
      c.numFmt = '#,##0.00';
      c.font = { bold: true, size: 10, color: { argb: argb(BRAND.ink) } };
      c.alignment = { horizontal: 'right' };
      c.border = { top: { style: 'thin', color: { argb: argb(BRAND.orange) } } };
    }
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    return { fileName: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes };
  }

  // PDF — landscape table matching the fuel report's document language.
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width - 72;
  const totalWeight = COLUMNS.reduce((s, c) => s + c.weight, 0);
  const colW = COLUMNS.map((c) => (c.weight / totalWeight) * pageW);
  const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  doc.rect(36, 36, pageW, 4).fill(hex(BRAND.orange));
  doc.fillColor(hex(BRAND.ink)).font('Helvetica-Bold').fontSize(15).text(`${meta.company} — EFS Money Code Report`, 36, 50);
  doc.fillColor(hex(BRAND.muted)).font('Helvetica').fontSize(9).text(`${meta.range} · ${draws.length} draw(s)`, 36, 70);

  let y = 92;
  const drawHeader = () => {
    let x = 36;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(hex(BRAND.ink));
    COLUMNS.forEach((c, i) => {
      doc.text(c.header, x + 2, y, { width: (colW[i] ?? 40) - 4, align: c.align });
      x += colW[i] ?? 40;
    });
    y += 14;
    doc.moveTo(36, y - 3).lineTo(36 + pageW, y - 3).lineWidth(0.5).strokeColor(hex(BRAND.border)).stroke();
  };
  drawHeader();
  doc.font('Helvetica').fontSize(8);
  draws.forEach((d, ri) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 50;
      drawHeader();
      doc.font('Helvetica').fontSize(8);
    }
    if (ri % 2 === 1) doc.rect(36, y - 2, pageW, 13).fill(hex(BRAND.zebra));
    doc.fillColor(hex(BRAND.ink));
    let x = 36;
    const vals = [d.date, money(d.amount), money(d.used), d.status, d.reason, d.unit, d.requestedBy, d.validUntil];
    vals.forEach((v, i) => {
      doc.text(String(v), x + 2, y, { width: (colW[i] ?? 40) - 4, align: COLUMNS[i]?.align ?? 'left', lineBreak: false });
      x += colW[i] ?? 40;
    });
    y += 13;
  });
  y += 4;
  doc.moveTo(36, y).lineTo(36 + pageW, y).lineWidth(1).strokeColor(hex(BRAND.orange)).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(hex(BRAND.ink))
    .text(`TOTAL  ${money(totalAmount)} issued · ${money(totalUsed)} used`, 36, y + 6);
  doc.end();
  const bytes = await done;
  return { fileName: `${base}.pdf`, contentType: 'application/pdf', bytes };
}
