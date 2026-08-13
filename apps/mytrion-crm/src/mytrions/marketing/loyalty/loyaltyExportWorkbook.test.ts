/**
 * The workbook's DESIGN, asserted on the cells rather than on a screenshot.
 *
 * Two things here are load-bearing and both fail silently. A picklist column that loses its
 * `dataValidation` still opens fine — it just stops being a picklist, and nobody notices until
 * someone types "GOLD" into it. A swatch that loses its fill still opens fine too; the file is simply
 * grey, which reads as "the export is plain" rather than as a regression. So the colour and the
 * dropdown are pinned per column, from the same `EXPORT_COLUMNS` / swatch maps the writer reads.
 *
 * ExcelJS is imported directly (not through `downloadLoyaltyExport`, which reaches for `Blob` and an
 * anchor click) so the workbook is inspected in memory and nothing is written to disk.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { LoyaltyMonthClient, LoyaltyMonthRoster } from '../../../api/loyalty';
import { EXPORT_COLUMNS, buildExportPayload } from './loyaltyExportModel';
import { buildLoyaltyWorkbook } from './loyaltyExportWorkbook';
import { PERK_ON, TIER_SWATCH } from './loyaltyExportStyle';

const GOLD_T1: LoyaltyMonthClient = {
  carrierId: '5794015',
  companyName: 'KBUFF TRUCKING LTD',
  agentName: 'Diana Rose',
  trucks: 1,
  activeCards: 3,
  currentStoredTierName: 'Gold',
  retainedTierName: '',
  // One transacting card in the basis month → T1, where Gold starts at 2,000 in-network gallons.
  basisActiveCards: 1,
  basisInNetworkGallons: 2400,
  basisTotalGallons: 2500,
  basisTransactions: 30,
  monthActiveCards: 1,
  monthInNetworkGallons: 1800,
  monthTotalGallons: 1900,
  monthTransactions: 22,
  cycleGallons: 2100,
  lastTransactionAt: '2026-07-24',
  loyaltyOverride: null,
};

function roster(over: Partial<LoyaltyMonthRoster> = {}): LoyaltyMonthRoster {
  return {
    month: '2026-07-01',
    basisMonth: '2026-06-01',
    monthLabel: 'July 2026',
    basisMonthLabel: 'June 2026',
    cycleLabel: '26 Jun – 25 Jul 2026',
    monthComplete: true,
    clients: [GOLD_T1],
    total: 1,
    fetchedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

const GENERATED_AT = new Date('2026-08-13T12:00:00.000Z');

function build(over: Partial<LoyaltyMonthRoster> = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  buildLoyaltyWorkbook(wb, buildExportPayload(roster(over), 'all'), GENERATED_AT);
  return wb;
}

/** All text on a sheet, joined — for asserting a sentence appears without pinning its cell. */
function sheetText(ws: ExcelJS.Worksheet): string {
  const parts: string[] = [];
  ws.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'string') parts.push(cell.value);
    });
  });
  return parts.join(' | ');
}

const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;
const columnIndex = (key: string): number =>
  EXPORT_COLUMNS.findIndex((column) => column.key === key) + 1;

describe('workbook structure', () => {
  const wb = build();

  it('ships the three sheets in reading order', () => {
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Overview', 'Clients', 'Legend']);
  });

  it('labels the Clients header from the shared column definition', () => {
    const ws = wb.getWorksheet('Clients')!;
    const labels = EXPORT_COLUMNS.map((_, i) => ws.getCell(HEADER_ROW, i + 1).value);
    expect(labels).toEqual(EXPORT_COLUMNS.map((column) => column.label));
  });

  it('bands the header with a group row above it', () => {
    const ws = wb.getWorksheet('Clients')!;
    expect(ws.getCell(1, 1).value).toBe('PERIOD');
    expect(ws.getCell(1, columnIndex('tier')).value).toBe('TIER');
  });

  it('freezes the header and the identity columns so a wide row stays readable', () => {
    const ws = wb.getWorksheet('Clients')!;
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 4, ySplit: HEADER_ROW });
  });

  it('autofilters from the header row, not from the group band', () => {
    const ws = wb.getWorksheet('Clients')!;
    expect(ws.autoFilter).toMatchObject({ from: { row: HEADER_ROW, column: 1 } });
  });
});

describe('picklist columns are real picklists', () => {
  const ws = build().getWorksheet('Clients')!;

  it('paints the Tier cell in the tier’s own colour', () => {
    const cell = ws.getCell(FIRST_DATA_ROW, columnIndex('tier'));
    expect(cell.value).toBe('Gold');
    expect(cell.fill).toMatchObject({ fgColor: { argb: TIER_SWATCH.gold.fill } });
    expect(cell.font).toMatchObject({ color: { argb: TIER_SWATCH.gold.ink } });
  });

  it('attaches the closed value set as a dropdown', () => {
    const cell = ws.getCell(FIRST_DATA_ROW, columnIndex('tier'));
    expect(cell.dataValidation).toMatchObject({ type: 'list', allowBlank: false });
    expect(cell.dataValidation?.formulae?.[0]).toContain('Gold');
    expect(cell.dataValidation?.formulae?.[0]).toContain('No Tier');
  });

  it('gives every declared picklist column a dropdown, not just the tier', () => {
    const missing = EXPORT_COLUMNS.filter(
      (column, index) =>
        column.picklist && ws.getCell(FIRST_DATA_ROW, index + 1).dataValidation === undefined,
    ).map((column) => column.key);
    expect(missing).toEqual([]);
  });

  it('colours an included perk as included', () => {
    const cell = ws.getCell(FIRST_DATA_ROW, columnIndex('perk_transaction_fee_waiver'));
    expect(cell.value).toBe(PERK_ON);
    expect(cell.fill).toBeDefined();
  });

  it('keeps Excel’s inline list formula inside its 255-character limit', () => {
    for (const column of EXPORT_COLUMNS) {
      if (!column.picklist) continue;
      const formula = `"${column.picklist.values.join(',')}"`;
      expect(formula.length, column.key).toBeLessThanOrEqual(255);
    }
  });
});

describe('numbers stay numbers', () => {
  const ws = build().getWorksheet('Clients')!;

  it('writes gallons as a formatted number, not a pre-formatted string', () => {
    const cell = ws.getCell(FIRST_DATA_ROW, columnIndex('basisInNetworkGallons'));
    expect(cell.value).toBe(2400);
    expect(cell.numFmt).toBe('#,##0.00');
  });

  it('totals with a SUM formula AND a cached result, for viewers that never recalculate', () => {
    const total = ws.getCell(FIRST_DATA_ROW + 1, columnIndex('basisInNetworkGallons'));
    expect(total.value).toMatchObject({ result: 2400 });
    expect((total.value as { formula: string }).formula).toMatch(/^SUM\(/);
  });
});

describe('the Overview says which two months the file is about', () => {
  it('names the basis month and the reported month', () => {
    const text = sheetText(build().getWorksheet('Overview')!);
    expect(text).toContain('Loyalty Tiers · July 2026');
    expect(text).toContain('Tier earned in June 2026');
    expect(text).toContain('activity reported for July 2026');
  });

  it('warns that a month in progress is partial, and says the tier is not', () => {
    const text = sheetText(build({ monthComplete: false }).getWorksheet('Overview')!);
    expect(text).toContain('still in progress');
    expect(text).toContain('The tier itself is final');
  });

  it('does not warn about a closed month', () => {
    expect(sheetText(build().getWorksheet('Overview')!)).not.toContain('still in progress');
  });
});

describe('the Legend states the program the app actually runs', () => {
  const text = sheetText(build().getWorksheet('Legend')!);

  it('reads the thresholds out of the shared tier definition', () => {
    // T1 Gold is 2,000 gallons in `_shared/loyalty.ts`; the legend must not carry its own copy.
    const ws = build().getWorksheet('Legend')!;
    const goldColumn = 4;
    const values: unknown[] = [];
    ws.eachRow((row) => values.push(row.getCell(goldColumn).value));
    expect(values).toContain(2000);
    expect(values).toContain(23000); // T3 Fleet Gold
  });

  it('describes each track by its transacting-card range', () => {
    expect(text).toContain('Owner-Operator');
    expect(text).toContain('12+ active cards');
  });

  it('explains what a manual exception means for a closed period', () => {
    expect(text).toContain('Exception Set At');
  });
});

describe('an empty export is still a valid workbook', () => {
  it('writes the sheets and skips the totals row rather than emitting SUM over nothing', () => {
    const wb = build({ clients: [], total: 0 });
    const ws = wb.getWorksheet('Clients')!;
    expect(ws.getCell(HEADER_ROW, 1).value).toBe('Reported Month');
    expect(ws.getCell(FIRST_DATA_ROW, 1).value).toBeNull();
  });
});
