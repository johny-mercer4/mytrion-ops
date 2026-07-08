import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';

vi.mock('../../src/repos/fileRepo.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/repos/fileRepo.js')>();
  return {
    ...original,
    fileRepo: {
      ...original.fileRepo,
      create: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => ({ ...input })),
    },
  };
});

import { generateCsv } from '../../src/modules/files/generate/csv.js';
import { generateExcel } from '../../src/modules/files/generate/excel.js';
import { generatePdf } from '../../src/modules/files/generate/pdf.js';
import { parseFile } from '../../src/modules/files/parse/index.js';
import { setStorageForTests, type ObjectStorage } from '../../src/modules/files/storage/index.js';
import { storeFile } from '../../src/modules/files/fileService.js';
import { fileRepo } from '../../src/repos/fileRepo.js';
import { makeContext } from '../fixtures/seed.js';

function mockStorage(): { storage: ObjectStorage; puts: Array<{ key: string; size: number }> } {
  const puts: Array<{ key: string; size: number }> = [];
  return {
    puts,
    storage: {
      put: async (key, body) => void puts.push({ key, size: body.length }),
      getStream: async () => {
        throw new Error('not used');
      },
      getBuffer: async () => Buffer.alloc(0),
      presignGet: async (key) => ({ url: `https://minio.test/${key}?sig=x`, expiresAt: new Date(Date.now() + 900_000) }),
      delete: async () => undefined,
    },
  };
}

afterEach(() => {
  setStorageForTests(null);
  vi.clearAllMocks();
});

describe('generators produce valid artifacts', () => {
  it('csv round-trips through csv-parse', () => {
    const buf = generateCsv(['name', 'debt'], [['Acme', 1200], ['Beta', null]]);
    const rows = parseCsvSync(buf.toString('utf-8')) as string[][];
    expect(rows[0]).toEqual(['name', 'debt']);
    expect(rows[1]).toEqual(['Acme', '1200']);
    expect(rows).toHaveLength(3);
  });

  it('csv row cap rejects oversized exports', () => {
    const rows = new Array(100_001).fill(['x']);
    expect(() => generateCsv(['col'], rows)).toThrow(/rows/);
  });

  it('xlsx round-trips through exceljs', async () => {
    const buf = await generateExcel([{ name: 'Debtors', columns: ['carrier', 'debt'], rows: [['Acme', 99]] }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Debtors')!;
    expect(ws.getRow(1).values).toContain('carrier');
    expect(ws.getRow(2).values).toContain('Acme');
  });

  it('pdf output is a real PDF document', async () => {
    const buf = await generatePdf({
      title: 'Debtor Report',
      sections: [
        { heading: 'Summary', text: 'Three debtors this week.' },
        { table: { columns: ['carrier', 'debt'], rows: [['Acme', 1200]] } },
      ],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe('parseFile', () => {
  it('parses csv into text + table', async () => {
    const parsed = await parseFile(Buffer.from('a,b\n1,2\n'), 'text/csv', 'data.csv');
    expect(parsed.tables?.[0]?.columns).toEqual(['a', 'b']);
    expect(parsed.text).toContain('1, 2');
  });

  it('passes plain text through', async () => {
    const parsed = await parseFile(Buffer.from('hello world'), 'text/plain', 'note.txt');
    expect(parsed.text).toBe('hello world');
  });

  it('rejects unsupported types', async () => {
    await expect(parseFile(Buffer.from('x'), 'application/zip', 'a.zip')).rejects.toThrow(/Unsupported/);
  });
});

describe('storeFile', () => {
  it('stores under a tenant-prefixed sanitized key and returns a presigned link', async () => {
    const { storage, puts } = mockStorage();
    setStorageForTests(storage);
    const ctx = makeContext({ tenantId: 'octane', departments: ['billing'], allDepartmentAccess: false });
    const stored = await storeFile(ctx, {
      name: '../..//evil report<>.csv',
      mime: 'text/csv',
      buffer: Buffer.from('a,b\n'),
      kind: 'generated',
      createdBy: 'file.generate_csv',
      department: 'billing',
    });
    expect(puts[0]!.key.startsWith('octane/generated/')).toBe(true);
    expect(puts[0]!.key).not.toContain('..');
    expect(stored.url).toContain('https://minio.test/');
    const created = vi.mocked(fileRepo.create).mock.calls[0]![1];
    expect(created).toMatchObject({ departmentAccess: 'billing', kind: 'generated' });
  });

  it('customer uploads never carry a department tag (owner-scoped only)', async () => {
    const { storage } = mockStorage();
    setStorageForTests(storage);
    const customer = makeContext({
      role: 'viewer',
      audience: 'customer',
      departments: ['5758544'],
      allDepartmentAccess: false,
    });
    await storeFile(customer, {
      name: 'statement.csv',
      mime: 'text/csv',
      buffer: Buffer.from('a\n'),
      kind: 'upload',
      createdBy: 'files.upload',
      department: 'finance', // hostile: must be ignored for customers
    });
    const created = vi.mocked(fileRepo.create).mock.calls[0]![1];
    expect(created).toMatchObject({ departmentAccess: null });
  });

  it('rejects empty and oversized files', async () => {
    const { storage } = mockStorage();
    setStorageForTests(storage);
    const ctx = makeContext({});
    await expect(
      storeFile(ctx, { name: 'x.csv', mime: 'text/csv', buffer: Buffer.alloc(0), kind: 'generated', createdBy: 't' }),
    ).rejects.toThrow(/empty/i);
    await expect(
      storeFile(ctx, {
        name: 'big.bin',
        mime: 'application/octet-stream',
        buffer: Buffer.alloc(26 * 1024 * 1024),
        kind: 'upload',
        createdBy: 't',
      }),
    ).rejects.toThrow(/limit/i);
  });
});
