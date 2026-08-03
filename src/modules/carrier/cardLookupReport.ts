import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { FLEET_CARD_LIMIT, listDwhCards } from '../../integrations/dwhCards.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';

export type CardLookupReportFormat = 'pdf' | 'xlsx';

export interface CardLookupRow {
  cardId: string;
  cardNumber: string;
  unit: string;
  driverId: string;
  driverName: string;
  xRef: string;
  status: string;
  override: string;
}

export interface CardLookupReport {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  rows: number;
}

const HEADERS = [
  'Card ID',
  'Card #',
  'Unit',
  'Driver ID',
  'Driver Name',
  'X-Ref',
  'Status',
  'Override',
] as const;

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, '');
}

function maskedCardNumber(value: unknown): string {
  const card = digits(value);
  if (card.length <= 10) return card;
  return `${card.slice(0, 6)}${'*'.repeat(Math.max(4, card.length - 10))}${card.slice(-4)}`;
}

function yesNo(value: unknown): string {
  if (value === true || value === 1 || text(value).toLowerCase() === 'yes') return 'Yes';
  return 'No';
}

/** EFS is the live source for card state; DWH contributes the stable Card ID used elsewhere. */
export async function listCardLookupRows(carrierId: string): Promise<CardLookupRow[]> {
  const [dwhCards, efsResult] = await Promise.all([
    listDwhCards(carrierId, FLEET_CARD_LIMIT).catch(() => []),
    efsWrapper.listCards(carrierId).catch(() => null),
  ]);
  const dwhByNumber = new Map(
    dwhCards.map((card) => [digits(card.cardNumber), card]),
  );
  const live = efsResult?.data ?? [];
  if (live.length === 0) {
    return dwhCards.map((card) => ({
      cardId: text(card.cardId),
      cardNumber: maskedCardNumber(card.cardNumber),
      unit: '',
      driverId: '',
      driverName: '',
      xRef: '',
      status: text(card.status),
      override: 'No',
    }));
  }
  return live
    .filter((row) => digits(row['cardNumber'] ?? row['card_number']))
    .map((row) => {
      const rawNumber = row['cardNumber'] ?? row['card_number'];
      const dwh = dwhByNumber.get(digits(rawNumber));
      return {
        cardId: text(row['cardId'] ?? row['card_id'] ?? dwh?.cardId),
        cardNumber: maskedCardNumber(rawNumber),
        unit: text(row['unitNumber'] ?? row['unit_number']),
        driverId: text(row['driverId'] ?? row['driver_id']),
        driverName: text(row['driverName'] ?? row['driver_name']),
        xRef: text(row['xRef'] ?? row['x_ref'] ?? row['xref']),
        status: text(row['status'] ?? row['card_status']),
        override: yesNo(row['override']),
      };
    });
}

function rowValues(row: CardLookupRow): string[] {
  return [
    row.cardId,
    row.cardNumber,
    row.unit,
    row.driverId,
    row.driverName,
    row.xRef,
    row.status,
    row.override,
  ];
}

async function buildXlsx(rows: CardLookupRow[], companyName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Octane';
  workbook.title = 'Card Lookup Report';
  workbook.subject = companyName;
  const sheet = workbook.addWorksheet('Card Lookup', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [16, 22, 12, 14, 25, 14, 18, 12].map((width) => ({ width }));
  sheet.mergeCells('A1:H1');
  sheet.getCell('A1').value = `${companyName} · Card Lookup Report`;
  sheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172033' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 32;
  sheet.mergeCells('A2:H2');
  sheet.getCell('A2').value = `Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} cards`;
  sheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } };
  const header = sheet.getRow(3);
  header.values = [...HEADERS];
  header.height = 27;
  header.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF111827' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  rows.forEach((reportRow, index) => {
    const row = sheet.addRow(rowValues(reportRow));
    row.height = 22;
    row.eachCell((cell) => {
      cell.numFmt = '@';
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF111827' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF64748B' } },
        left: { style: 'thin', color: { argb: 'FF64748B' } },
        bottom: { style: 'thin', color: { argb: 'FF64748B' } },
        right: { style: 'thin', color: { argb: 'FF64748B' } },
      };
    });
  });
  sheet.autoFilter = { from: 'A3', to: `H${Math.max(3, rows.length + 3)}` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildPdf(rows: CardLookupRow[], companyName: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const widths = [92, 112, 60, 72, 158, 68, 112, 68];
  const left = 24;
  let y = 24;
  let pageNumber = 1;
  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text(`${companyName} · Card Lookup Report`, left, y);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} cards`, left, y + 18);
    doc.text(`Page ${pageNumber}`, doc.page.width - 84, y + 18, { width: 60, align: 'right', lineBreak: false });
    y += 36;
    let x = left;
    HEADERS.forEach((label, index) => {
      doc.rect(x, y, widths[index] ?? 0, 24).fillAndStroke('#E5E7EB', '#111827');
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8).text(label, x + 3, y + 8, { width: (widths[index] ?? 0) - 6, align: 'center' });
      x += widths[index] ?? 0;
    });
    y += 24;
  };
  drawHeader();
  rows.forEach((reportRow) => {
    const values = rowValues(reportRow);
    const rowHeight = Math.max(
      28,
      ...values.map((value, index) =>
        doc.font('Helvetica').fontSize(8).heightOfString(value, { width: (widths[index] ?? 0) - 6 }),
      ),
    ) + 6;
    if (y + rowHeight > doc.page.height - 30) {
      doc.addPage();
      pageNumber += 1;
      y = 24;
      drawHeader();
    }
    let x = left;
    values.forEach((value, index) => {
      const width = widths[index] ?? 0;
      doc.rect(x, y, width, rowHeight).stroke('#111827');
      doc.fillColor('#111827').font('Helvetica').fontSize(8).text(value, x + 3, y + 4, { width: width - 6, height: rowHeight - 8 });
      x += width;
    });
    y += rowHeight;
  });
  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.once('end', resolve);
    doc.once('error', reject);
  });
  return Buffer.concat(chunks);
}

export async function buildCardLookupReport(
  carrierId: string,
  companyName: string,
  format: CardLookupReportFormat,
): Promise<CardLookupReport> {
  const rows = await listCardLookupRows(carrierId);
  return renderCardLookupReport(rows, companyName, format);
}

/** Separate renderer keeps live-data scoping testable independently from binary layout QA. */
export async function renderCardLookupReport(
  rows: CardLookupRow[],
  companyName: string,
  format: CardLookupReportFormat,
): Promise<CardLookupReport> {
  const safeCompany = companyName.trim() || 'Octane';
  const bytes = format === 'pdf' ? await buildPdf(rows, safeCompany) : await buildXlsx(rows, safeCompany);
  return {
    bytes,
    rows: rows.length,
    fileName: `Octane_Card_Lookup_${new Date().toISOString().slice(0, 10)}.${format}`,
    contentType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
