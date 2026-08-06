/**
 * Opening-balance spreadsheet import — parse and validate. WRITES NOTHING.
 *
 * The preview is the whole point: an opening balance restates every downstream day for that carrier,
 * so an agent must see exactly what will change before anything is written. `validateWorkbook` returns
 * a verdict per row plus the live value it would replace; the route stores that verbatim and commit
 * replays it, which makes commit a pure function of what was actually reviewed.
 *
 * Parsed with `exceljs` DIRECTLY rather than through ../../files/parse/index.ts: that helper
 * stringifies every cell and caps at 50k rows, and we need typed numeric cells plus the real
 * spreadsheet row number for each error message ("fix row 47").
 *
 * ⚠️ ExcelJS `row.values` is 1-INDEXED — index 0 is always empty. Every read below goes through
 * `cell(values, n)` so the off-by-one lives in one place.
 */
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { ValidationError } from '../../../lib/errors.js';
import { ledgerOpeningBalanceRepo, num } from '../../../repos/ledgerOpeningBalanceRepo.js';
import { resolveLedgerCarriers } from './clientType.js';
import type { LedgerImportPreviewRow, LedgerImportSummary } from './importTypes.js';
import { getLedgerSection, isLedgerSectionId, type LedgerSectionId } from './sections.js';
import { SHEET_DATA, SHEET_META, TEMPLATE_COLUMNS, TEMPLATE_VERSION } from './excelTemplate.js';

/** Hard row cap. ~2,847 carriers × 1 section is the realistic worst case. */
export const MAX_IMPORT_ROWS = 10_000;

export interface ValidateResult {
  rows: LedgerImportPreviewRow[];
  summary: LedgerImportSummary;
  fileErrors: string[];
  templateVersion: string | null;
  sha256: string;
}

/** 1-indexed cell read — see the module header. */
function cell(values: unknown, n: number): unknown {
  if (!Array.isArray(values)) return undefined;
  return values[n];
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) {
    // A date-typed cell still yields a usable day; ExcelJS parses to UTC midnight, so read the UTC
    // parts rather than the local ones or the day shifts west of Greenwich.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && v !== null) {
    // Rich text / formula results arrive as objects.
    const o = v as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (typeof o.text === 'string') return o.text.trim();
    if (typeof o.result === 'string' || typeof o.result === 'number') return String(o.result).trim();
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? '').join('').trim();
  }
  return String(v).trim();
}

/** Numeric read that refuses a value it cannot represent exactly, rather than coercing to NaN → 0. */
function asAmount(v: unknown): { ok: true; value: number } | { ok: false; raw: string } {
  if (v === null || v === undefined || v === '') return { ok: false, raw: '' };
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, raw: String(v) };
  }
  const raw = asText(v);
  if (!raw) return { ok: false, raw: '' };
  // Tolerate what people actually paste: $, thousands separators, and (1,234.00) for negative.
  const neg = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false, raw };
  const n = Number(cleaned) * (neg ? -1 : 1);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, raw };
}

/** True only for a real calendar day. `new Date('2026-02-30')` rolls to Mar 2 rather than failing. */
function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface RawRow {
  rowNumber: number;
  carrierId: string;
  companyName: string;
  section: string;
  asOfDate: string;
  amountRaw: unknown;
  note: string;
}

/**
 * Read the workbook into raw rows and collect whole-file problems.
 *
 * A whole-file problem (missing sheet, re-arranged columns, unknown template version) is reported and
 * NOTHING is validated — mis-parsing a re-arranged sheet would produce plausible wrong numbers, which
 * is far worse than refusing the file.
 */
async function readWorkbook(
  buffer: Buffer,
): Promise<{ rows: RawRow[]; fileErrors: string[]; templateVersion: string | null }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (e) {
    throw new ValidationError(
      `That file could not be read as an .xlsx workbook. ${(e as Error).message}`,
      { code: 'LEDGER_IMPORT_UNREADABLE' },
    );
  }

  const fileErrors: string[] = [];

  let templateVersion: string | null = null;
  const meta = wb.getWorksheet(SHEET_META);
  if (meta) {
    meta.eachRow((row) => {
      const k = asText(cell(row.values, 1));
      if (k === 'templateVersion') templateVersion = asText(cell(row.values, 2));
    });
  }
  if (templateVersion && templateVersion !== TEMPLATE_VERSION) {
    fileErrors.push(
      `This file was made from template version ${templateVersion}; the current version is ${TEMPLATE_VERSION}. Download a fresh template and re-enter the amounts.`,
    );
  }

  const ws = wb.getWorksheet(SHEET_DATA) ?? wb.worksheets[0];
  if (!ws) {
    fileErrors.push('The workbook has no sheets.');
    return { rows: [], fileErrors, templateVersion };
  }
  if (ws.name !== SHEET_DATA) {
    // Tolerated, but say so — a renamed sheet is usually a hand-built file, which is where
    // column-order faults come from.
    fileErrors.push(`Expected a sheet named "${SHEET_DATA}"; reading "${ws.name}" instead.`);
  }

  const header = ws.getRow(1);
  const actual = TEMPLATE_COLUMNS.map((_, i) => asText(cell(header.values, i + 1)).toLowerCase());
  const expected = TEMPLATE_COLUMNS.map((c) => c.toLowerCase());
  if (actual.join('|') !== expected.join('|')) {
    fileErrors.push(
      `Column headers do not match the template. Expected: ${TEMPLATE_COLUMNS.join(', ')}. Found: ${actual.filter(Boolean).join(', ') || '(empty)'}.`,
    );
    return { rows: [], fileErrors, templateVersion };
  }

  const rows: RawRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const v = row.values;
    const carrierId = asText(cell(v, 1));
    const amountRaw = cell(v, 5);
    // A row with neither a carrier nor an amount is just spreadsheet whitespace.
    if (!carrierId && (amountRaw === null || amountRaw === undefined || amountRaw === '')) return;
    rows.push({
      rowNumber,
      carrierId,
      companyName: asText(cell(v, 2)),
      section: asText(cell(v, 3)),
      asOfDate: asText(cell(v, 4)),
      amountRaw,
      note: asText(cell(v, 6)),
    });
  });

  if (rows.length > MAX_IMPORT_ROWS) {
    fileErrors.push(
      `The file has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it and import in batches.`,
    );
    return { rows: [], fileErrors, templateVersion };
  }

  return { rows, fileErrors, templateVersion };
}

/**
 * Validate an uploaded workbook against the carrier book and the currently-saved balances.
 *
 * Every failing row collects EVERY reason, not just the first — a row can be both an unknown carrier
 * and a bad date, and reporting one at a time costs the agent an upload cycle per fault.
 */
export async function validateWorkbook(
  buffer: Buffer,
): Promise<ValidateResult> {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const { rows: raw, fileErrors, templateVersion } = await readWorkbook(buffer);

  if (!raw.length) {
    return {
      rows: [],
      summary: { rowCount: 0, accepted: 0, rejected: 0, changed: 0, new: 0, unchanged: 0 },
      fileErrors,
      templateVersion,
      sha256,
    };
  }

  // Two batch lookups for the whole file — never one per row.
  const carrierIds = [...new Set(raw.map((r) => r.carrierId).filter(Boolean))];
  const [carriers, live] = await Promise.all([
    resolveLedgerCarriers(carrierIds),
    ledgerOpeningBalanceRepo.findLiveBatch(carrierIds),
  ]);

  const today = todayCentral();
  /** Guards against the same (carrier, section) appearing twice in one file. */
  const seen = new Map<string, number>();
  const out: LedgerImportPreviewRow[] = [];

  for (const r of raw) {
    const reasons: string[] = [];

    if (!r.carrierId) reasons.push('Carrier ID is missing.');

    const sectionOk = isLedgerSectionId(r.section);
    if (!r.section) reasons.push('Section is missing.');
    else if (!sectionOk) reasons.push(`"${r.section}" is not a ledger section.`);

    const carrier = carriers.get(r.carrierId);
    if (r.carrierId && !carrier) {
      // resolveLedgerCarriers drops WEX-Funded and untyped carriers, so this covers all three cases.
      reasons.push(
        `No ledger carrier for ${r.carrierId} — it may not exist, be WEX-Funded, or have no LOC/Prepay type set.`,
      );
    }

    if (carrier && sectionOk) {
      const def = getLedgerSection(r.section as LedgerSectionId);
      if (def.clientType !== carrier.clientType) {
        reasons.push(
          `${def.label} applies to ${def.clientType} carriers; ${r.carrierId} is ${carrier.clientType}.`,
        );
      }
    }

    const amount = asAmount(r.amountRaw);
    const blank = !amount.ok && amount.raw === '';
    if (!amount.ok && !blank) reasons.push(`"${amount.raw}" is not a number.`);
    if (amount.ok && Math.abs(amount.value) >= 1e9) reasons.push('Amount is implausibly large.');

    if (!r.asOfDate && !blank) reasons.push('As Of Date is missing.');
    else if (r.asOfDate && !isRealDay(r.asOfDate)) {
      reasons.push(`"${r.asOfDate}" is not a real date (expected yyyy-mm-dd).`);
    } else if (r.asOfDate && r.asOfDate > today) {
      reasons.push('As Of Date cannot be in the future.');
    }

    const dupKey = `${r.carrierId}:${r.section}`;
    const firstAt = seen.get(dupKey);
    if (firstAt !== undefined) {
      reasons.push(`Duplicate of row ${firstAt} — the same carrier and section appears twice.`);
    } else if (r.carrierId && sectionOk) {
      seen.set(dupKey, r.rowNumber);
    }

    const existing = sectionOk ? live.get(dupKey) : undefined;
    const previousAmount = existing ? num(existing.amount) : null;

    let verdict: LedgerImportPreviewRow['verdict'];
    let changeKind: LedgerImportPreviewRow['changeKind'];

    if (blank && reasons.length === 0) {
      // A blank amount is a deliberate skip, not an error and not a zero.
      verdict = 'unchanged';
      changeKind = 'unchanged';
      reasons.push('Amount left blank — this row will be skipped.');
    } else if (reasons.length > 0) {
      verdict = 'reject';
      changeKind = previousAmount === null ? 'new' : 'changed';
    } else if (
      previousAmount !== null &&
      amount.ok &&
      previousAmount === amount.value &&
      existing?.asOfDate === r.asOfDate
    ) {
      verdict = 'unchanged';
      changeKind = 'unchanged';
    } else {
      verdict = 'accept';
      changeKind = previousAmount === null ? 'new' : 'changed';
    }

    out.push({
      rowNumber: r.rowNumber,
      carrierId: r.carrierId,
      companyName: carrier?.companyName ?? r.companyName,
      clientType: carrier?.clientType ?? '',
      section: sectionOk ? (r.section as LedgerSectionId) : '',
      asOfDate: r.asOfDate,
      amount: amount.ok ? amount.value : null,
      note: r.note || null,
      verdict,
      changeKind,
      reasons,
      previousAmount,
      previousAsOfDate: existing?.asOfDate ?? null,
      previousRevisionId: existing?.id ?? null,
      delta: amount.ok && previousAmount !== null ? amount.value - previousAmount : null,
    });
  }

  const summary: LedgerImportSummary = {
    rowCount: out.length,
    accepted: out.filter((r) => r.verdict === 'accept').length,
    rejected: out.filter((r) => r.verdict === 'reject').length,
    changed: out.filter((r) => r.verdict === 'accept' && r.changeKind === 'changed').length,
    new: out.filter((r) => r.verdict === 'accept' && r.changeKind === 'new').length,
    unchanged: out.filter((r) => r.verdict === 'unchanged').length,
  };

  return { rows: out, summary, fileErrors, templateVersion, sha256 };
}
