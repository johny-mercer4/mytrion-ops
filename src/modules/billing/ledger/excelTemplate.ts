/**
 * Opening-balance Excel template and export.
 *
 * The template is built HERE, server-side, because the importer must parse exactly what the template
 * emits. One source of truth for the column order, the section list and the instructions means the
 * two cannot drift, and `ledger-excel-template.test.ts` round-trips a generated template through the
 * importer with zero rejects to keep it that way.
 *
 * ⚠️ EVERY DATE IS WRITTEN AS A STRING, never a JS `Date`. ExcelJS serializes a local-midnight Date
 * via UTC and silently shifts the day west of Greenwich — the trap documented at
 * ../../carrier/txnReport.ts:139. An as-of date that lands a day early anchors the whole ledger to the
 * wrong day, so this is not a cosmetic concern.
 *
 * The sheet is pre-filled with the carriers in scope AND their current live value, so an agent EDITS
 * rather than types — the single biggest lever on the rejected-row rate. Locked identity columns stop
 * the other common fault: a re-arranged or hand-retyped carrier id.
 */
import ExcelJS from 'exceljs';
import { listLedgerCarriers } from './clientType.js';
import { getLedgerSection, type LedgerSectionId } from './sections.js';
import { ledgerOpeningBalanceRepo, num } from '../../../repos/ledgerOpeningBalanceRepo.js';

/**
 * Bump when the column order or sheet names change. The importer refuses a workbook whose
 * `templateVersion` it does not recognize, with a message telling the agent to re-download —
 * far better than mis-parsing a re-arranged file into plausible wrong numbers.
 */
export const TEMPLATE_VERSION = '1';

export const SHEET_DATA = 'Opening Balances';
export const SHEET_INSTRUCTIONS = 'Instructions';
export const SHEET_META = '__meta';

/** Column order. The importer reads by POSITION after verifying the header row matches. */
export const TEMPLATE_COLUMNS = [
  'Carrier ID',
  'Company Name',
  'Section',
  'As Of Date',
  'Amount',
  'Note',
] as const;

const MONEY_FMT = '#,##0.00;[Red](#,##0.00)';

const C = {
  headFill: 'FF1E293B',
  headFont: 'FFFFFFFF',
  lockedFill: 'FFF1F5F9',
  band: 'FFF8FAFC',
  muted: 'FF64748B',
  ink: 'FF0F172A',
} as const;

export type TemplateAudience = 'all' | 'missing' | 'with-value';

export interface TemplateOptions {
  section: LedgerSectionId;
  /** 'missing' (default) = only carriers with no live opening balance for this section. */
  includeCarriers?: TemplateAudience | undefined;
}

export interface GeneratedWorkbook {
  bytes: Buffer;
  fileName: string;
  contentType: string;
  rowCount: number;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** yyyy-mm-dd in the ledger's reporting zone. */
function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function styleHeader(ws: ExcelJS.Worksheet, rowNumber: number, columnCount: number): void {
  const row = ws.getRow(rowNumber);
  row.font = { bold: true, color: { argb: C.headFont }, size: 10 };
  row.alignment = { vertical: 'middle' };
  for (let c = 1; c <= columnCount; c += 1) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
  }
  row.height = 20;
}

/**
 * Build the fill-in template for one section.
 *
 * Default audience is `missing`: the actual migration workflow is "give me the carriers I still owe a
 * balance for", and that list shrinks as the work completes. `all` stays available for a full audit.
 */
export async function buildOpeningTemplate(opts: TemplateOptions): Promise<GeneratedWorkbook> {
  const section = getLedgerSection(opts.section);
  const audience = opts.includeCarriers ?? 'missing';

  // One DWH scope query, then one Postgres lookup for this section's live rows — the live lookup
  // needs the carrier list, so these are sequential rather than parallel.
  const { carriers } = await listLedgerCarriers({ clientType: section.clientType });
  const live = await ledgerOpeningBalanceRepo.findLiveBatch(
    carriers.map((c) => c.carrierId),
    [opts.section],
  );

  const rows = carriers.filter((c) => {
    const has = live.has(`${c.carrierId}:${opts.section}`);
    if (audience === 'missing') return !has;
    if (audience === 'with-value') return has;
    return true;
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mytrion Billing';
  wb.created = new Date();

  // ── Sheet 1: the fill-in grid ────────────────────────────────────────────
  const ws = wb.addWorksheet(SHEET_DATA, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 12 },
    { width: 34 },
    { width: 14 },
    { width: 13 },
    { width: 14 },
    { width: 30 },
  ];
  ws.addRow([...TEMPLATE_COLUMNS]);
  styleHeader(ws, 1, TEMPLATE_COLUMNS.length);

  const today = todayCentral();
  for (const [i, carrier] of rows.entries()) {
    const existing = live.get(`${carrier.carrierId}:${opts.section}`);
    const row = ws.addRow([
      carrier.carrierId,
      carrier.companyName,
      opts.section,
      // STRING, never a Date — see the module header.
      existing ? existing.asOfDate : '',
      existing ? num(existing.amount) : null,
      '',
    ]);
    row.getCell(1).numFmt = '@'; // keep a leading zero if a carrier id ever has one
    row.getCell(5).numFmt = MONEY_FMT;
    row.getCell(4).numFmt = '@';
    for (let c = 1; c <= 3; c += 1) {
      row.getCell(c).protection = { locked: true };
      row.getCell(c).font = { color: { argb: C.muted }, size: 10 };
    }
    // The three cells the agent is meant to touch.
    for (const c of [4, 5, 6]) row.getCell(c).protection = { locked: false };
    if (i % 2 === 1) {
      for (let c = 1; c <= TEMPLATE_COLUMNS.length; c += 1) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
      }
    }
  }

  /**
   * Lock the identity columns. Cell-level `locked` is inert until the SHEET is protected, so both
   * halves are required — and `protect()` is the real API for it (`addWorksheet`'s options type has no
   * `protection` field). Password-less protection is a guardrail, not security: it stops the
   * accidental retype of a carrier id, which is the fault that actually happens. Everything it
   * prevents is also caught by the header-match and carrier-resolution checks in ./import.ts, so a
   * determined agent unprotecting the sheet loses nothing but the early warning.
   */
  await ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    insertRows: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
  });

  // ── Sheet 2: instructions, including the sign convention ─────────────────
  const info = wb.addWorksheet(SHEET_INSTRUCTIONS);
  info.columns = [{ width: 22 }, { width: 96 }];
  const line = (k: string, v: string): void => {
    const r = info.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10, color: { argb: C.ink } };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };
  line('Section', `${section.label} (${section.clientType} carriers)`);
  line('Positive means', section.positiveMeans);
  line('Debit', section.debit);
  line('Credit', section.credit);
  line('As Of Date', `The balance is carried from this date forward, INCLUSIVE. Format yyyy-mm-dd (e.g. ${today}). It cannot be in the future.`);
  line('Amount', 'Numbers only — no $ sign, no thousands separators. Negatives are allowed (an EFS overdraw, or over-invoicing on Unbilled).');
  line('Leave blank', 'A row with an empty Amount is SKIPPED, not zeroed. Delete nothing — blank rows are fine.');
  line('Carrier ID', 'Locked. Do not retype or re-order the columns — the importer rejects a re-arranged sheet rather than guess.');
  line('Overwriting', 'If a carrier already has a balance, your value REPLACES it as a new revision. The previous value is kept in the revision history and can be restored.');
  line('Reconciled against', section.externalSource);
  if (section.shouldTrendToZero) {
    line('Note', 'This section should trend to zero — a persistent balance is itself a signal.');
  }
  info.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  // ── Sheet 3: machine metadata, so a re-arranged file fails loudly ────────
  const meta = wb.addWorksheet(SHEET_META, { state: 'veryHidden' });
  meta.addRow(['templateVersion', TEMPLATE_VERSION]);
  meta.addRow(['section', opts.section]);
  meta.addRow(['generatedAt', new Date().toISOString()]);
  meta.addRow(['columns', TEMPLATE_COLUMNS.join('|')]);

  const out = await wb.xlsx.writeBuffer();
  return {
    bytes: Buffer.from(out),
    fileName: `opening-balances-${opts.section}-${today}.xlsx`,
    contentType: XLSX_MIME,
    rowCount: rows.length,
  };
}

/**
 * Export the balances already saved. Separate from the template on purpose: the template's job is to
 * be filled in (locked identity, blank amounts where missing), this one's job is to be read.
 */
export async function buildOpeningExport(opts: {
  section?: LedgerSectionId | undefined;
}): Promise<GeneratedWorkbook> {
  const { rows } = await ledgerOpeningBalanceRepo.listLive({
    section: opts.section,
    limit: 500,
    offset: 0,
  });
  // listLive caps at 500 per page; walk the rest so an export is never silently truncated.
  const all = [...rows];
  let offset = rows.length;
  for (;;) {
    const next = await ledgerOpeningBalanceRepo.listLive({
      section: opts.section,
      limit: 500,
      offset,
    });
    if (!next.rows.length) break;
    all.push(...next.rows);
    offset += next.rows.length;
    if (all.length >= next.total) break;
  }

  const carriers = await listLedgerCarriers({ includeInactive: true });
  const nameOf = new Map(carriers.carriers.map((c) => [c.carrierId, c.companyName]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mytrion Billing';
  const ws = wb.addWorksheet('Opening Balances', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = [
    'Carrier ID',
    'Company Name',
    'Section',
    'As Of Date',
    'Amount',
    'Revision',
    'Source',
    'Entered By',
    'Entered At',
    'Note',
  ];
  ws.columns = [
    { width: 12 },
    { width: 34 },
    { width: 14 },
    { width: 13 },
    { width: 14 },
    { width: 10 },
    { width: 11 },
    { width: 22 },
    { width: 21 },
    { width: 30 },
  ];
  ws.addRow(cols);
  styleHeader(ws, 1, cols.length);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  for (const [i, r] of all.entries()) {
    const row = ws.addRow([
      r.carrierId,
      nameOf.get(r.carrierId) ?? '',
      r.section,
      r.asOfDate, // string
      num(r.amount),
      r.revision,
      r.source,
      r.createdByName ?? '',
      r.createdAt.toISOString().slice(0, 19).replace('T', ' '),
      r.note ?? '',
    ]);
    row.getCell(1).numFmt = '@';
    row.getCell(4).numFmt = '@';
    row.getCell(5).numFmt = MONEY_FMT;
    if (i % 2 === 1) {
      for (let c = 1; c <= cols.length; c += 1) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
      }
    }
  }

  const out = await wb.xlsx.writeBuffer();
  const suffix = opts.section ? `-${opts.section}` : '';
  return {
    bytes: Buffer.from(out),
    fileName: `opening-balances-saved${suffix}-${todayCentral()}.xlsx`,
    contentType: XLSX_MIME,
    rowCount: all.length,
  };
}

/**
 * Annotate the rejected rows of a preview so an agent can fix a 400-row file without hunting. This is
 * how a bulk load actually converges.
 */
export async function buildRejectedRowsWorkbook(
  rows: readonly {
    rowNumber: number;
    carrierId: string;
    companyName: string;
    section: string;
    asOfDate: string;
    amount: number | null;
    reasons: string[];
  }[],
): Promise<GeneratedWorkbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rejected Rows', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = ['Sheet Row', 'Carrier ID', 'Company Name', 'Section', 'As Of Date', 'Amount', 'Reason'];
  ws.columns = [
    { width: 11 },
    { width: 12 },
    { width: 32 },
    { width: 14 },
    { width: 13 },
    { width: 14 },
    { width: 70 },
  ];
  ws.addRow(cols);
  styleHeader(ws, 1, cols.length);
  for (const r of rows) {
    const row = ws.addRow([
      r.rowNumber,
      r.carrierId,
      r.companyName,
      r.section,
      r.asOfDate,
      r.amount,
      r.reasons.join('; '),
    ]);
    row.getCell(2).numFmt = '@';
    row.getCell(5).numFmt = '@';
    row.getCell(6).numFmt = MONEY_FMT;
    row.getCell(7).alignment = { wrapText: true, vertical: 'top' };
  }
  return {
    bytes: Buffer.from(await wb.xlsx.writeBuffer()),
    fileName: `opening-balances-rejected-${todayCentral()}.xlsx`,
    contentType: XLSX_MIME,
    rowCount: rows.length,
  };
}
