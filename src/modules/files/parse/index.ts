/**
 * File parsing for analysis: pdf (unpdf), xlsx (exceljs), csv (csv-parse), docx (mammoth),
 * plain text. Everything is size/row-capped — parsing runs in-process on a small instance.
 * Extracted text is DATA (a trust boundary); callers wrap it UNTRUSTED before the model.
 */
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { AppError } from '../../../lib/errors.js';

export interface ParsedTable {
  name: string;
  columns: string[];
  rows: string[][];
}

export interface ParsedFile {
  text: string;
  tables?: ParsedTable[];
  meta: Record<string, unknown>;
}

const MAX_TEXT_CHARS = 2_000_000; // extracted-text cap (zip-bomb guard)
const MAX_PARSE_ROWS = 50_000;

function capText(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

async function parsePdf(buffer: Buffer): Promise<ParsedFile> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  if (pdf.numPages > 200) {
    throw new AppError('PDF exceeds the 200-page parse limit', { statusCode: 413, code: 'FILE_TOO_LARGE' });
  }
  const { text } = await extractText(pdf, { mergePages: true });
  return { text: capText(text), meta: { pages: pdf.numPages } };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer); // exceljs accepts Buffer at runtime
  const tables: ParsedTable[] = [];
  let totalRows = 0;
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      if (totalRows >= MAX_PARSE_ROWS) return;
      totalRows += 1;
      const values = (row.values as unknown[]).slice(1); // exceljs is 1-indexed
      rows.push(values.map((v) => (v == null ? '' : String(v))));
    });
    const [columns = [], ...body] = rows;
    tables.push({ name: sheet.name, columns, rows: body });
  });
  const text = tables
    .map((t) => `# ${t.name}\n${t.columns.join(', ')}\n${t.rows.map((r) => r.join(', ')).join('\n')}`)
    .join('\n\n');
  return { text: capText(text), tables, meta: { sheets: tables.length, rows: totalRows } };
}

function parseCsv(buffer: Buffer): ParsedFile {
  const records = parseCsvSync(buffer.toString('utf-8'), {
    relax_column_count: true,
    to: MAX_PARSE_ROWS,
  }) as string[][];
  const [columns = [], ...rows] = records;
  const text = records.map((r) => r.join(', ')).join('\n');
  return { text: capText(text), tables: [{ name: 'csv', columns, rows }], meta: { rows: records.length } };
}

async function parseDocx(buffer: Buffer): Promise<ParsedFile> {
  const result = await mammoth.extractRawText({ buffer });
  return { text: capText(result.value), meta: {} };
}

export async function parseFile(buffer: Buffer, mime: string, name: string): Promise<ParsedFile> {
  const lower = name.toLowerCase();
  if (mime.includes('pdf') || lower.endsWith('.pdf')) return parsePdf(buffer);
  if (mime.includes('spreadsheetml') || lower.endsWith('.xlsx')) return parseXlsx(buffer);
  if (mime.includes('csv') || lower.endsWith('.csv')) return parseCsv(buffer);
  if (mime.includes('wordprocessingml') || lower.endsWith('.docx')) return parseDocx(buffer);
  if (mime.startsWith('text/') || lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')) {
    return { text: capText(buffer.toString('utf-8')), meta: {} };
  }
  throw new AppError(`Unsupported file type for analysis: ${mime || name}`, {
    statusCode: 415,
    code: 'UNSUPPORTED_FILE_TYPE',
  });
}
