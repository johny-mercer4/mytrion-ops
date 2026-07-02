import { stringify } from 'csv-stringify/sync';
import { AppError } from '../../../lib/errors.js';

export type CsvCell = string | number | boolean | null;

export const MAX_CSV_ROWS = 100_000;

export function generateCsv(columns: string[], rows: CsvCell[][]): Buffer {
  if (rows.length > MAX_CSV_ROWS) {
    throw new AppError(`CSV exceeds ${MAX_CSV_ROWS} rows`, { statusCode: 413, code: 'FILE_TOO_LARGE' });
  }
  const text = stringify([columns, ...rows]);
  return Buffer.from(text, 'utf-8');
}
