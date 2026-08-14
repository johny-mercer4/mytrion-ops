/**
 * Log export — the CSV writer and the formula-injection guard.
 *
 * The guard is the reason this file exists. Audit rows carry user-controlled text (display names,
 * company names, tool arguments), and a cell beginning `=`, `+`, `-` or `@` is executed as a
 * formula by Excel and Sheets on open — which would turn "export the audit log" into a code
 * execution path against whoever opens the file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deliverExportMock = vi.fn(async (_blob: Blob, _filename: string) => 'downloaded' as const);
vi.mock('@/lib/deliverExport', () => ({
  deliverExport: (blob: Blob, filename: string) => deliverExportMock(blob, filename),
}));

import { buildCsv, exportRowsCsv, type ExportColumn, type ExportMeta } from './logsExport';

interface Row {
  name: string;
  action: string;
}

const COLUMNS: ReadonlyArray<ExportColumn<Row>> = [
  { header: 'Name', width: 20, value: (r) => r.name },
  { header: 'Action', width: 20, value: (r) => r.action },
];

const META: ExportMeta = {
  title: 'AUDIT LOG',
  subtitle: 'Activity trail',
  filters: ['Logins'],
  filenameStem: 'Audit_Log',
  sheetName: 'Audit Log',
};

/** The CSV document the delivery path wraps in a BOM. */
function csvText(rows: Row[], meta: ExportMeta = META): string {
  return buildCsv(rows, COLUMNS, meta);
}

beforeEach(() => {
  deliverExportMock.mockClear();
});

describe('exportRowsCsv', () => {
  it('writes a header block, the column row, then the data', async () => {
    const text = csvText([{ name: 'Amir', action: 'auth.zoho.login' }]);
    const lines = text.split('\r\n');

    expect(lines[0]).toBe('AUDIT LOG — Activity trail');
    expect(lines[1]).toBe('Filters: Logins');
    expect(lines[3]).toBe('Rows: 1');
    expect(lines[5]).toBe('Name,Action');
    expect(lines[6]).toBe('Amir,auth.zoho.login');
  });

  it('says so plainly when nothing was filtered', async () => {
    const text = csvText([], { ...META, filters: [] });
    expect(text).toContain('Filters: None (unfiltered)');
  });

  it('quotes commas, quotes and newlines, doubling inner quotes', async () => {
    const text = csvText([
      { name: 'Carter, Dina', action: 'said "hello"' },
      { name: 'line\nbreak', action: 'x' },
    ]);

    expect(text).toContain('"Carter, Dina","said ""hello"""');
    expect(text).toContain('"line\nbreak",x');
  });

  it('neutralises formula injection on every leading trigger character', async () => {
    const text = csvText([
      { name: '=1+1', action: 'a' },
      { name: '+cmd', action: 'b' },
      { name: '-2', action: 'c' },
      { name: '@SUM(A1)', action: 'd' },
    ]);

    // Prefixed with an apostrophe, which forces the cell to text and is not displayed.
    expect(text).toContain("'=1+1,a");
    expect(text).toContain("'+cmd,b");
    expect(text).toContain("'-2,c");
    expect(text).toContain("'@SUM(A1),d");
  });

  it('escapes a payload that is BOTH a formula and quoted', async () => {
    // The nasty one: the guard must run before the quoting, or the apostrophe lands outside the
    // quotes and Excel evaluates the cell anyway.
    const text = csvText([{ name: '=HYPERLINK("http://x","go")', action: 'a' }]);
    expect(text).toContain('"\'=HYPERLINK(""http://x"",""go"")",a');
  });

  it('renders a null cell as empty rather than the string "null"', async () => {
    const cols: ReadonlyArray<ExportColumn<Row>> = [
      { header: 'Name', width: 10, value: () => null },
    ];
    const lines = buildCsv([{ name: 'x', action: 'y' }], cols, META).split('\r\n');
    expect(lines[6]).toBe('');
  });

  it('names the file from the stem and a timestamp', async () => {
    await exportRowsCsv([], COLUMNS, META);
    const filename = deliverExportMock.mock.calls[0]![1];
    expect(filename).toMatch(/^Audit_Log_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
  });
});
