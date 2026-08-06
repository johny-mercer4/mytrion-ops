/**
 * The opening-balance spreadsheet: template generation and import validation.
 *
 * This is the highest-risk path in the module — it is how real money balances enter the ledger — so the
 * assertions target the failures that would be silent:
 *   • `As Of Date` written as a JS Date instead of a string. ExcelJS serializes a local-midnight Date via
 *     UTC, shifting the day west of Greenwich, which would anchor a balance to the wrong day.
 *   • A round trip that does not survive: the importer must accept exactly what the template emits, or
 *     the pre-filled workflow is worthless.
 *   • A blank amount treated as zero. Blank means "skip this row"; zero is a real balance.
 *   • A row reporting only its FIRST fault, which costs an upload cycle per fault.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const { dwhQuery, findOpenBatch, findLiveBatch, carrierIdsWithLive } = vi.hoisted(() => ({
  dwhQuery: vi.fn(async (_sql: string, _params?: readonly unknown[]) => [] as unknown[]),
  findOpenBatch: vi.fn(async () => new Map<string, { clientType: string }>()),
  findLiveBatch: vi.fn(async () => new Map<string, { id: string; asOfDate: string; amount: string }>()),
  carrierIdsWithLive: vi.fn(async () => new Set<string>()),
}));

vi.mock('../../src/integrations/dwh.js', () => ({ dwh: { query: dwhQuery } }));
vi.mock('../../src/repos/ledgerClientTypeRepo.js', () => ({
  ledgerClientTypeRepo: { findOpenBatch, findOpen: vi.fn(async () => undefined) },
}));
vi.mock('../../src/repos/ledgerOpeningBalanceRepo.js', () => ({
  ledgerOpeningBalanceRepo: { findLiveBatch, carrierIdsWithLive, listLive: vi.fn(async () => ({ rows: [], total: 0 })) },
  num: (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0),
}));

import { buildOpeningTemplate, TEMPLATE_COLUMNS } from '../../src/modules/billing/ledger/excelTemplate.js';
import { validateWorkbook } from '../../src/modules/billing/ledger/import.js';

const dimRow = (carrierId: string, terms = 'Prepay'): Record<string, unknown> => ({
  carrier_id: carrierId,
  company_name: `CO ${carrierId}`,
  payment_terms: terms,
  billing_cycle: 'WEEKLY_MON_SUN',
  is_wex_funded: false,
  is_active: 1,
});

/** Today in the ledger's zone, so "not in the future" assertions do not drift with the clock. */
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

beforeEach(() => {
  vi.clearAllMocks();
  findOpenBatch.mockResolvedValue(new Map());
  findLiveBatch.mockResolvedValue(new Map());
  carrierIdsWithLive.mockResolvedValue(new Set());
  dwhQuery.mockResolvedValue([dimRow('5000001'), dimRow('5000002')]);
});

/** Build a workbook in the template's shape. `rows` are raw cell arrays. */
async function makeWorkbook(rows: unknown[][], opts: { headers?: string[]; sheet?: string; meta?: string | null } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheet ?? 'Opening Balances');
  ws.addRow(opts.headers ?? [...TEMPLATE_COLUMNS]);
  for (const r of rows) ws.addRow(r);
  if (opts.meta !== null) {
    const meta = wb.addWorksheet('__meta');
    meta.addRow(['templateVersion', opts.meta ?? '1']);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('template generation', () => {
  it('writes As Of Date as a STRING, never a Date — the UTC day-shift trap', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-prepay', { id: 'lob_1', asOfDate: '2026-07-13', amount: '1250.50' }]]) as never,
    );
    const wb = await buildOpeningTemplate({ section: 'cb-prepay', includeCarriers: 'all' });
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(wb.bytes as unknown as ArrayBuffer);
    const ws = read.getWorksheet('Opening Balances')!;
    const asOf = ws.getRow(2).getCell(4).value;
    expect(asOf instanceof Date).toBe(false);
    expect(typeof asOf).toBe('string');
    expect(asOf).toBe('2026-07-13');
  });

  it('pre-fills the current value so an agent edits rather than types', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-prepay', { id: 'lob_1', asOfDate: '2026-07-13', amount: '1250.50' }]]) as never,
    );
    const wb = await buildOpeningTemplate({ section: 'cb-prepay', includeCarriers: 'all' });
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(wb.bytes as unknown as ArrayBuffer);
    const ws = read.getWorksheet('Opening Balances')!;
    expect(ws.getRow(2).getCell(5).value).toBe(1250.5);
  });

  it('defaults to the carriers still MISSING a balance — the actual work queue', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-prepay', { id: 'lob_1', asOfDate: '2026-07-13', amount: '10' }]]) as never,
    );
    const wb = await buildOpeningTemplate({ section: 'cb-prepay' });
    // 5000001 already has one, so only 5000002 remains.
    expect(wb.rowCount).toBe(1);
  });

  it('carries the section, an instructions sheet and a hidden meta sheet', async () => {
    const wb = await buildOpeningTemplate({ section: 'cb-prepay', includeCarriers: 'all' });
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(wb.bytes as unknown as ArrayBuffer);
    expect(read.getWorksheet('Instructions')).toBeDefined();
    const meta = read.getWorksheet('__meta');
    expect(meta).toBeDefined();
    expect(meta!.state).toBe('veryHidden');
    expect(read.getWorksheet('Opening Balances')!.getRow(2).getCell(3).value).toBe('cb-prepay');
  });

  it('names the file for the section and is a real xlsx mime', async () => {
    const wb = await buildOpeningTemplate({ section: 'ar', includeCarriers: 'all' });
    expect(wb.fileName).toContain('ar');
    expect(wb.contentType).toContain('spreadsheetml');
  });
});

describe('template → importer round trip', () => {
  it('a generated template, filled in, validates with zero rejects', async () => {
    dwhQuery.mockResolvedValue([dimRow('5000001'), dimRow('5000002')]);
    const tpl = await buildOpeningTemplate({ section: 'cb-prepay', includeCarriers: 'all' });

    // Fill the amounts the way an agent would.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Opening Balances')!;
    ws.getRow(2).getCell(4).value = '2026-07-13';
    ws.getRow(2).getCell(5).value = 1000;
    ws.getRow(3).getCell(4).value = '2026-07-13';
    ws.getRow(3).getCell(5).value = -50.25;
    const filled = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await validateWorkbook(filled);
    expect(res.fileErrors).toEqual([]);
    expect(res.summary.rejected).toBe(0);
    expect(res.summary.accepted).toBe(2);
    // A negative is a real value — an EFS overdraw — and must not be rejected.
    expect(res.rows.find((r) => r.carrierId === '5000002')?.amount).toBe(-50.25);
  });
});

describe('per-row validation', () => {
  it('reports EVERY reason, not just the first', async () => {
    const buf = await makeWorkbook([['9999999', 'GHOST', 'cb-prepay', '2026-02-30', 'abc', '']]);
    const res = await validateWorkbook(buf);
    const row = res.rows[0]!;
    expect(row.verdict).toBe('reject');
    // Unknown carrier AND an impossible date AND a non-numeric amount — all three.
    expect(row.reasons.length).toBeGreaterThanOrEqual(3);
    expect(row.reasons.join(' ')).toMatch(/No ledger carrier/i);
    expect(row.reasons.join(' ')).toMatch(/not a real date/i);
    expect(row.reasons.join(' ')).toMatch(/not a number/i);
  });

  it('rejects a calendar-invalid date instead of rolling it over', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-02-30', '100', '']]);
    const res = await validateWorkbook(buf);
    // new Date('2026-02-30') silently becomes March 2 — that must never anchor a balance.
    expect(res.rows[0]!.reasons.join(' ')).toMatch(/not a real date/i);
  });

  it('rejects a future as-of date', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2099-01-01', '100', '']]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.reasons.join(' ')).toMatch(/future/i);
  });

  it('rejects a section the carrier’s client type does not own', async () => {
    dwhQuery.mockResolvedValue([dimRow('5000001', 'Prepay')]);
    const buf = await makeWorkbook([['5000001', 'CO', 'ar', '2026-07-13', '100', '']]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.verdict).toBe('reject');
    expect(res.rows[0]!.reasons.join(' ')).toMatch(/applies to LOC carriers/i);
  });

  it('rejects an in-file duplicate and names the row it collides with', async () => {
    const buf = await makeWorkbook([
      ['5000001', 'CO', 'cb-prepay', '2026-07-13', '100', ''],
      ['5000001', 'CO', 'cb-prepay', '2026-07-13', '200', ''],
    ]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.verdict).toBe('accept');
    expect(res.rows[1]!.verdict).toBe('reject');
    expect(res.rows[1]!.reasons.join(' ')).toContain('row 2');
  });

  it('rejects an implausibly large amount', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-07-13', '1000000000', '']]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.reasons.join(' ')).toMatch(/implausibly large/i);
  });

  it('accepts an explicit zero as a real balance', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-07-13', 0, '']]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.verdict).toBe('accept');
    expect(res.rows[0]!.amount).toBe(0);
  });

  it('SKIPS a blank amount rather than writing zero', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-07-13', '', '']]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.verdict).toBe('unchanged');
    expect(res.rows[0]!.amount).toBeNull();
    expect(res.rows[0]!.reasons.join(' ')).toMatch(/left blank/i);
  });

  it('tolerates the formats people actually paste', async () => {
    const buf = await makeWorkbook([
      ['5000001', 'CO', 'cb-prepay', '2026-07-13', '$1,234.56', ''],
      ['5000002', 'CO', 'cb-prepay', '2026-07-13', '(500.00)', ''],
    ]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.amount).toBe(1234.56);
    // Accounting-style parentheses mean negative.
    expect(res.rows[1]!.amount).toBe(-500);
  });

  it('marks a row matching the live value as unchanged, not a rewrite', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-prepay', { id: 'lob_1', asOfDate: '2026-07-13', amount: '100.00' }]]) as never,
    );
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-07-13', '100', '']]);
    const res = await validateWorkbook(buf);
    expect(res.rows[0]!.verdict).toBe('unchanged');
    expect(res.rows[0]!.changeKind).toBe('unchanged');
  });

  it('marks a differing value as a CHANGE and carries the previous revision id for concurrency', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-prepay', { id: 'lob_1', asOfDate: '2026-07-13', amount: '100.00' }]]) as never,
    );
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-07-13', '250', '']]);
    const res = await validateWorkbook(buf);
    const row = res.rows[0]!;
    expect(row.verdict).toBe('accept');
    expect(row.changeKind).toBe('changed');
    expect(row.previousAmount).toBe(100);
    expect(row.delta).toBe(150);
    // Commit re-checks this against the live row, so a concurrent edit aborts instead of clobbering.
    expect(row.previousRevisionId).toBe('lob_1');
  });

  it('reports the SPREADSHEET row number so an error names the row to fix', async () => {
    const buf = await makeWorkbook([
      ['5000001', 'CO', 'cb-prepay', '2026-07-13', '100', ''],
      ['9999999', 'GHOST', 'cb-prepay', '2026-07-13', '100', ''],
    ]);
    const res = await validateWorkbook(buf);
    // Header is row 1, so the data starts at 2.
    expect(res.rows[0]!.rowNumber).toBe(2);
    expect(res.rows[1]!.rowNumber).toBe(3);
  });
});

describe('whole-file problems stop validation instead of mis-parsing', () => {
  it('refuses a re-arranged header row', async () => {
    const buf = await makeWorkbook(
      [['cb-prepay', '5000001', 'CO', '2026-07-13', '100', '']],
      { headers: ['Section', 'Carrier ID', 'Company Name', 'As Of Date', 'Amount', 'Note'] },
    );
    const res = await validateWorkbook(buf);
    expect(res.fileErrors.join(' ')).toMatch(/Column headers do not match/i);
    // And validates NOTHING, rather than reading the columns in the wrong order.
    expect(res.rows).toEqual([]);
  });

  it('flags a stale template version', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', '2026-07-13', '100', '']], { meta: '0' });
    const res = await validateWorkbook(buf);
    expect(res.fileErrors.join(' ')).toMatch(/template version 0/i);
  });

  it('throws a clear ValidationError on bytes that are not a workbook', async () => {
    await expect(validateWorkbook(Buffer.from('this is not xlsx'))).rejects.toThrow(
      /could not be read as an .xlsx/i,
    );
  });

  it('is stable under repeated validation — the sha is content-addressed', async () => {
    const buf = await makeWorkbook([['5000001', 'CO', 'cb-prepay', today, '100', '']]);
    const a = await validateWorkbook(buf);
    const b = await validateWorkbook(buf);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
