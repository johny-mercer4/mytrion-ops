/**
 * PDF generation from a structured document spec (title/sections/tables) — agents emit specs,
 * not layout code. pdfkit streams into memory; no browser engine involved.
 */
import PDFDocument from 'pdfkit';
import { AppError } from '../../../lib/errors.js';
import type { CsvCell } from './csv.js';

export interface PdfSectionSpec {
  heading?: string;
  text?: string;
  table?: { columns: string[]; rows: CsvCell[][] };
}

export interface PdfSpec {
  title: string;
  sections: PdfSectionSpec[];
}

const MAX_TABLE_ROWS = 2_000;

function drawTable(doc: PDFKit.PDFDocument, table: { columns: string[]; rows: CsvCell[][] }): void {
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usable / Math.max(table.columns.length, 1);
  const drawRow = (cells: CsvCell[], bold: boolean): void => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let maxHeight = 0;
    cells.forEach((cell, i) => {
      const text = cell == null ? '' : String(cell);
      const x = doc.page.margins.left + i * colWidth;
      doc.text(text, x, y, { width: colWidth - 6 });
      maxHeight = Math.max(maxHeight, doc.heightOfString(text, { width: colWidth - 6 }));
    });
    doc.y = y + maxHeight + 4;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
  };
  drawRow(table.columns, true);
  for (const row of table.rows) drawRow(row, false);
  doc.moveDown(0.5);
}

export async function generatePdf(spec: PdfSpec): Promise<Buffer> {
  const totalRows = spec.sections.reduce((n, s) => n + (s.table?.rows.length ?? 0), 0);
  if (totalRows > MAX_TABLE_ROWS) {
    throw new AppError(`PDF tables exceed ${MAX_TABLE_ROWS} rows — use Excel/CSV for large exports`, {
      statusCode: 413,
      code: 'FILE_TOO_LARGE',
    });
  }
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text(spec.title);
    doc.moveDown();
    for (const section of spec.sections) {
      if (section.heading) {
        doc.font('Helvetica-Bold').fontSize(13).text(section.heading);
        doc.moveDown(0.3);
      }
      if (section.text) {
        doc.font('Helvetica').fontSize(10).text(section.text);
        doc.moveDown(0.5);
      }
      if (section.table) drawTable(doc, section.table);
    }
    doc.end();
  });
}
