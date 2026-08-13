/**
 * The loyalty export WORKBOOK — three sheets, built from `EXPORT_COLUMNS` and the shared palette.
 *
 *   Overview  the narrative: which two months this file is about, whether the reported one has
 *             closed, the scope, the totals, and the tier distribution with its real colours.
 *   Clients   the table. Group band, frozen header and identity columns, autofilter, coloured
 *             picklist cells, a totals row with SUM formulas AND cached results.
 *   Legend    what earns each tier and which perks follow — derived from `_shared/loyalty.ts`, never
 *             retyped, so the legend cannot describe a program the app no longer runs.
 *
 * WHY THE PICKLIST CELLS CARRY A DROPDOWN AS WELL AS A FILL. A fill alone is decoration. Attaching
 * `dataValidation type: 'list'` makes the cell behave like the Zoho picklist it mirrors: the reader
 * can see the closed set of values the column is allowed to hold, and anyone editing the sheet — reps
 * do annotate these files — gets the same set instead of inventing "gold ", "GOLD" and "Gold?".
 *
 * ExcelJS is only ever reached through a dynamic import in `loyaltyExportFile.ts`; the type-only
 * import here costs nothing at runtime. Everything below takes the workbook as a parameter, so this
 * module never loads the library itself.
 */
import type { Workbook, Worksheet } from 'exceljs';
import {
  resolveTier,
  tierRewards,
  trackCaption,
  type TierLevel,
} from '../../_shared/loyalty';
import {
  EXPORT_COLUMNS,
  SCOPE_LABEL,
  type ColumnGroup,
  type ExportColumn,
  type LoyaltyExportPayload,
} from './loyaltyExportModel';
import {
  FMT,
  SHEET,
  TIER_SWATCH,
  listFormula,
  type Swatch,
} from './loyaltyExportStyle';

const ARIAL = SHEET.font;

/** Tints for the group band above the header — neutral, so the picklist colours stay the loudest thing. */
const GROUP_TINT: Record<ColumnGroup, string> = {
  Period: 'FF223454',
  Client: 'FF1B2C48',
  Tier: 'FF2A3F63',
  'Basis month': 'FF1B2C48',
  'Reported month': 'FF223454',
  Perks: 'FF2A3F63',
  Exceptions: 'FF1B2C48',
};

type CellLike = ReturnType<Worksheet['getCell']>;

function text(
  cell: CellLike,
  value: string | number | Date | null,
  opts: {
    size?: number;
    bold?: boolean;
    color?: string;
    fill?: string;
    align?: 'left' | 'right' | 'center';
    numFmt?: string;
  } = {},
): void {
  cell.value = value;
  cell.font = {
    name: ARIAL,
    size: opts.size ?? 10,
    bold: opts.bold ?? false,
    color: { argb: opts.color ?? SHEET.body },
  };
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  cell.alignment = { horizontal: opts.align ?? 'left', vertical: 'middle' };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

/** A picklist cell: the value's own fill + ink, and the column's closed value set as a dropdown. */
function picklistCell(cell: CellLike, value: string, column: ExportColumn): void {
  const spec = column.picklist;
  const swatch: Swatch | undefined = spec?.swatches[value];
  text(cell, value, {
    bold: true,
    color: swatch?.ink ?? SHEET.body,
    // A value with no swatch keeps the row's default background rather than being painted a
    // guessed colour — an unknown picklist value should look unstyled, not look like a tier.
    ...(swatch ? { fill: swatch.fill } : {}),
    align: column.align,
  });
  if (spec) {
    cell.dataValidation = { type: 'list', allowBlank: false, formulae: [listFormula(spec)] };
  }
}

/* ── Overview ────────────────────────────────────────────────────────────────────────────────── */

function buildOverview(wb: Workbook, payload: LoyaltyExportPayload, generatedAt: Date): void {
  const { roster, summary, scope } = payload;
  const ws = wb.addWorksheet('Overview', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 30 }, { width: 17 }, { width: 13 }, { width: 22 }, { width: 22 }];
  const LAST = 'E';
  let r = 1;
  const span = (): void => ws.mergeCells(`A${r}:${LAST}${r}`);

  span();
  text(ws.getCell(`A${r}`), 'MYTRION MARKETING · LOYALTY PROGRAM', {
    size: 9,
    bold: true,
    color: SHEET.muted,
  });
  r += 1;

  span();
  text(ws.getCell(`A${r}`), `Loyalty Tiers · ${roster.monthLabel}`, {
    size: 18,
    bold: true,
    color: SHEET.ink,
  });
  ws.getRow(r).height = 25;
  r += 1;

  span();
  text(
    ws.getCell(`A${r}`),
    `Tier earned in ${roster.basisMonthLabel} · activity reported for ${roster.monthLabel} · billing cycle ${roster.cycleLabel}`,
    { size: 10, color: SHEET.body },
  );
  r += 1;

  span();
  text(
    ws.getCell(`A${r}`),
    `Scope: ${SCOPE_LABEL[scope]}   ·   Warehouse snapshot: ${roster.fetchedAt.slice(0, 16).replace('T', ' ')} UTC   ·   Generated: ${generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
    { size: 9, color: SHEET.muted },
  );
  r += 2;

  // The single most important caveat, and it gets a banner rather than a footnote: an export of the
  // month in progress reports a PARTIAL month. Its tier is still final — the basis month has closed.
  if (!roster.monthComplete) {
    span();
    text(
      ws.getCell(`A${r}`),
      `${roster.monthLabel} is still in progress — the reported-month gallons, cards and transactions are partial. The tier itself is final: ${roster.basisMonthLabel} has closed.`,
      { size: 10, bold: true, color: SHEET.warn, fill: SHEET.warnFill },
    );
    ws.getRow(r).height = 30;
    ws.getCell(`A${r}`).alignment = { vertical: 'middle', wrapText: true };
    r += 2;
  }

  const totals: [string, number, string][] = [
    ['Carriers exported', summary.carriers, FMT.count],
    ['Holding a tier', summary.tierHolders, FMT.count],
    [`In-network gallons · ${roster.basisMonthLabel} (tier basis)`, summary.basisInNetworkGallons, FMT.gallons],
    [`In-network gallons · ${roster.monthLabel}`, summary.monthInNetworkGallons, FMT.gallons],
    [`Total gallons · ${roster.monthLabel}`, summary.monthTotalGallons, FMT.gallons],
    ['Carriers with a manual exception', summary.exceptions, FMT.count],
  ];
  for (const [label, value, fmt] of totals) {
    text(ws.getCell(`A${r}`), label, { bold: true, color: SHEET.body });
    text(ws.getCell(`B${r}`), value, { size: 11, bold: true, color: SHEET.ink, align: 'right', numFmt: fmt });
    r += 1;
  }
  r += 1;

  span();
  text(ws.getCell(`A${r}`), 'TIER DISTRIBUTION', { size: 9, bold: true, color: SHEET.muted });
  r += 1;

  const distHeader = ['Tier', 'Carriers', 'Share', `${roster.basisMonthLabel} in-network gal`, `${roster.monthLabel} in-network gal`];
  distHeader.forEach((label, i) => {
    text(ws.getCell(r, i + 1), label, {
      bold: true,
      color: SHEET.headInk,
      fill: SHEET.headFill,
      align: i === 0 ? 'left' : 'right',
    });
  });
  ws.getRow(r).height = 19;
  r += 1;

  for (const bucket of summary.buckets) {
    const sw = TIER_SWATCH[bucket.bucket];
    text(ws.getCell(r, 1), bucket.label, { bold: true, color: sw.ink, fill: sw.fill });
    text(ws.getCell(r, 2), bucket.count, { color: SHEET.body, align: 'right', numFmt: FMT.count });
    text(ws.getCell(r, 3), bucket.share, { color: SHEET.body, align: 'right', numFmt: '0.0%' });
    text(ws.getCell(r, 4), bucket.basisInNetworkGallons, {
      color: SHEET.body,
      align: 'right',
      numFmt: FMT.gallons,
    });
    text(ws.getCell(r, 5), bucket.monthInNetworkGallons, {
      color: SHEET.body,
      align: 'right',
      numFmt: FMT.gallons,
    });
    r += 1;
  }
}

/* ── Clients ─────────────────────────────────────────────────────────────────────────────────── */

/** Row 1 is the group band, row 2 the header, row 3 the first carrier. Frozen at 2 rows / 4 columns. */
const GROUP_ROW = 1;
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;
/** Reported Month, Tier Basis Month, Carrier ID, Company — the identity you need while scrolling right. */
const FROZEN_COLUMNS = 4;

function buildClients(wb: Workbook, payload: LoyaltyExportPayload): void {
  const ws = wb.addWorksheet('Clients', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = EXPORT_COLUMNS.map((column) => ({ width: column.width }));

  // Group band — one merged cell per run of columns sharing a group.
  let start = 1;
  EXPORT_COLUMNS.forEach((column, index) => {
    const next = EXPORT_COLUMNS[index + 1];
    if (next && next.group === column.group) return;
    const end = index + 1;
    if (end > start) ws.mergeCells(GROUP_ROW, start, GROUP_ROW, end);
    text(ws.getCell(GROUP_ROW, start), column.group.toUpperCase(), {
      size: 9,
      bold: true,
      color: SHEET.headInk,
      fill: GROUP_TINT[column.group],
      align: 'center',
    });
    start = end + 1;
  });
  ws.getRow(GROUP_ROW).height = 17;

  EXPORT_COLUMNS.forEach((column, index) => {
    const cell = ws.getCell(HEADER_ROW, index + 1);
    text(cell, column.label, {
      bold: true,
      color: SHEET.headInk,
      fill: SHEET.headFill,
      align: column.align === 'right' ? 'right' : 'left',
    });
    cell.alignment = {
      horizontal: column.align === 'right' ? 'right' : 'left',
      vertical: 'middle',
      wrapText: true,
    };
  });
  ws.getRow(HEADER_ROW).height = 30;

  payload.rows.forEach((row, rowIndex) => {
    const excelRow = FIRST_DATA_ROW + rowIndex;
    const banded = rowIndex % 2 === 1;
    EXPORT_COLUMNS.forEach((column, index) => {
      const cell = ws.getCell(excelRow, index + 1);
      const value = column.value(row);
      if (column.picklist) {
        picklistCell(cell, String(value ?? ''), column);
      } else {
        text(cell, value, {
          color: SHEET.body,
          align: column.align,
          ...(column.numFmt ? { numFmt: column.numFmt } : {}),
          ...(banded ? { fill: SHEET.band } : {}),
        });
      }
      cell.border = { bottom: { style: 'hair', color: { argb: SHEET.rule } } };
    });
  });

  const lastDataRow = FIRST_DATA_ROW + payload.rows.length - 1;
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: EXPORT_COLUMNS.length },
  };
  ws.views = [{ state: 'frozen', xSplit: FROZEN_COLUMNS, ySplit: HEADER_ROW }];

  if (payload.rows.length === 0) return;

  /**
   * Totals row. SUM formulas so a filtered/edited sheet stays live, WITH a cached `result` so a
   * viewer that never recalculates (Numbers, Google Sheets on import, Quick Look) still shows a
   * number rather than a blank.
   */
  const totalRow = lastDataRow + 1;
  const summable = new Set([
    'basisActiveCards',
    'basisInNetworkGallons',
    'basisTotalGallons',
    'basisTransactions',
    'monthActiveCards',
    'monthInNetworkGallons',
    'monthTotalGallons',
    'monthTransactions',
    'cycleGallons',
    'perksIncluded',
  ]);
  EXPORT_COLUMNS.forEach((column, index) => {
    const cell = ws.getCell(totalRow, index + 1);
    if (index === 0) {
      text(cell, `Total · ${payload.rows.length.toLocaleString('en-US')} carriers`, {
        bold: true,
        color: SHEET.ink,
      });
    } else if (summable.has(column.key)) {
      const letter = cell.address.replace(/\d+/g, '');
      const cached = payload.rows.reduce((sum, row) => {
        const value = column.value(row);
        return sum + (typeof value === 'number' ? value : 0);
      }, 0);
      cell.value = {
        formula: `SUM(${letter}${FIRST_DATA_ROW}:${letter}${lastDataRow})`,
        result: Math.round(cached * 100) / 100,
      };
      cell.numFmt = column.numFmt ?? FMT.count;
      cell.font = { name: ARIAL, size: 10, bold: true, color: { argb: SHEET.ink } };
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = { top: { style: 'medium', color: { argb: SHEET.headFill } } };
  });
}

/* ── Legend ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Representative transacting-card counts, one per track/segment. The THRESHOLDS are not written here:
 * `resolveTier(cards, 0).thresholds` reads them out of the shared program definition, so the legend
 * always states the thresholds the app is actually applying.
 */
const LEGEND_CARD_COUNTS = [1, 2, 4, 7, 9, 11, 12];
/** The three earnable levels — `none` is excluded so these double as `Thresholds` keys. */
const LEGEND_LEVELS: Exclude<TierLevel, 'none'>[] = ['bronze', 'silver', 'gold'];

function buildLegend(wb: Workbook, payload: LoyaltyExportPayload): void {
  const ws = wb.addWorksheet('Legend', { pageSetup: { orientation: 'portrait' } });
  ws.columns = [{ width: 40 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 44 }];
  let r = 1;

  text(ws.getCell(`A${r}`), 'HOW A TIER IS EARNED', { size: 9, bold: true, color: SHEET.muted });
  r += 1;
  ws.mergeCells(`A${r}:E${r}`);
  text(
    ws.getCell(`A${r}`),
    `The track comes from the distinct cards that transacted in ${payload.roster.basisMonthLabel}; the tier from that same month's ULSR + ULSD gallons. There is no grace period and no rounding. Enterprise (12+ cards) has no automatic gallon tier — it qualifies only through a manual exception.`,
    { color: SHEET.body },
  );
  ws.getRow(r).height = 44;
  ws.getCell(`A${r}`).alignment = { vertical: 'top', wrapText: true };
  r += 2;

  ['Track · basis-month transacting cards', 'Bronze', 'Silver', 'Gold', ''].forEach((label, i) => {
    text(ws.getCell(r, i + 1), label, {
      bold: true,
      color: SHEET.headInk,
      fill: SHEET.headFill,
      align: i === 0 || i === 4 ? 'left' : 'right',
    });
  });
  r += 1;
  for (const cards of LEGEND_CARD_COUNTS) {
    const tier = resolveTier(cards, 0);
    text(ws.getCell(r, 1), trackCaption(tier), { color: SHEET.body });
    LEGEND_LEVELS.forEach((level, i) => {
      const threshold = tier.thresholds?.[level] ?? null;
      text(ws.getCell(r, i + 2), threshold, {
        color: threshold === null ? SHEET.muted : SHEET.body,
        align: 'right',
        numFmt: FMT.count,
      });
      if (threshold === null) text(ws.getCell(r, i + 2), 'manual', { color: SHEET.muted, align: 'right' });
    });
    r += 1;
  }
  r += 1;

  text(ws.getCell(`A${r}`), 'TIER COLOURS', { size: 9, bold: true, color: SHEET.muted });
  r += 1;
  for (const bucket of payload.summary.buckets) {
    const sw = TIER_SWATCH[bucket.bucket];
    text(ws.getCell(r, 1), bucket.label, { bold: true, color: sw.ink, fill: sw.fill });
    text(ws.getCell(r, 2), bucket.count, { color: SHEET.body, align: 'right', numFmt: FMT.count });
    ws.mergeCells(r, 3, r, 5);
    text(
      ws.getCell(r, 3),
      bucket.bucket === 'building'
        ? 'Transacting, still under the Bronze threshold'
        : bucket.bucket === 'idle'
          ? 'No tier earned in the basis month'
          : bucket.bucket === 'enterprise'
            ? '12+ transacting cards · qualifies by manual exception'
            : `Cleared the ${bucket.label} gallon threshold`,
      { color: SHEET.muted },
    );
    r += 1;
  }
  r += 1;

  text(ws.getCell(`A${r}`), 'PERKS BY TIER', { size: 9, bold: true, color: SHEET.muted });
  r += 1;
  ['Perk', 'Bronze', 'Silver', 'Gold', 'Detail'].forEach((label, i) => {
    text(ws.getCell(r, i + 1), label, {
      bold: true,
      color: SHEET.headInk,
      fill: SHEET.headFill,
      align: i === 0 || i === 4 ? 'left' : 'center',
    });
  });
  r += 1;
  // The matrix comes from `tierRewards` per level — the same function that decides the perk columns.
  const byLevel = new Map(LEGEND_LEVELS.map((level) => [level, tierRewards(level)]));
  tierRewards('gold').forEach((reward, index) => {
    text(ws.getCell(r, 1), reward.title, { bold: true, color: SHEET.ink });
    LEGEND_LEVELS.forEach((level, i) => {
      const entry = byLevel.get(level)?.[index];
      const on = entry?.active === true;
      text(ws.getCell(r, i + 2), on ? (entry?.value ?? '✓') : '—', {
        bold: on,
        color: on ? SHEET.ink : SHEET.muted,
        align: 'center',
      });
    });
    text(ws.getCell(r, 5), reward.desc, { color: SHEET.muted });
    r += 1;
  });
  r += 1;

  ws.mergeCells(`A${r}:E${r}`);
  text(
    ws.getCell(`A${r}`),
    'A "Manual exception" perk source means the checklist was set per client in the Loyalty workspace and no longer follows the tier defaults above. The Exception Set At column dates that decision — compare it to the reported month before relying on it for a closed period.',
    { size: 9, color: SHEET.muted },
  );
  ws.getRow(r).height = 40;
  ws.getCell(`A${r}`).alignment = { vertical: 'top', wrapText: true };
}

/** Assemble all three sheets into `wb`. `generatedAt` is passed in so callers stay deterministic. */
export function buildLoyaltyWorkbook(
  wb: Workbook,
  payload: LoyaltyExportPayload,
  generatedAt: Date,
): void {
  wb.creator = 'Mytrion Marketing';
  wb.created = generatedAt;
  buildOverview(wb, payload, generatedAt);
  buildClients(wb, payload);
  buildLegend(wb, payload);
  wb.calcProperties.fullCalcOnLoad = true;
}
