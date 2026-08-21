/**
 * Data Center Blacklist search — three labeled probes, run in parallel.
 *
 * Not Phase 3 and not a stop-at-first-hit fallback. Ban list, duplicates, and debtors each
 * answer independently. A down probe is `{ available: false }`, never a clear and never a 403.
 * Nothing here writes the case.
 *
 * | Probe | Source |
 * | --- | --- |
 * | Ban | `verification_blacklist_entries` + Credit Platform `blacklist_entries` |
 * | Duplicates | other `verification_cases` + Zoho Deals COQL (no invented phone query) |
 * | Debtors | DWH `dim_company` → `cmp_invoice` roll-up, outstanding > $100 |
 */
import { dwh } from '../../integrations/dwh.js';
import { matchCreditPlatformBanList } from '../../integrations/creditPlatformBlacklist.js';
import { screenDealsForCase } from '../../integrations/verificationDealScreening.js';
import { errorMessage } from '../../lib/errors.js';
import { jsonFields, jsonValue, type JsonValue } from '../../lib/jsonFields.js';
import { logger } from '../../lib/logger.js';
import {
  clampDebtorPage,
  clampDebtorPageSize,
  searchVerificationDebtors,
} from '../../repos/dwhVerificationDebtorRepo.js';
import { verificationScreeningRepo } from '../../repos/verificationScreeningRepo.js';
import type { VerificationIdentifierType } from '../../db/schema/verification_flow.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildIdentifier } from './screening.js';

export type BlacklistSearchBy = 'dot' | 'mc' | 'email' | 'phone' | 'name';

const BY_TO_TYPE: Record<BlacklistSearchBy, VerificationIdentifierType> = {
  dot: 'usdot',
  mc: 'mc',
  email: 'email',
  phone: 'phone',
  name: 'name',
};

export interface BlacklistBanHit {
  list: 'own' | 'credit_platform';
  entryType: VerificationIdentifierType;
  display: string;
  reason: string | null;
  sourceCaseId: string | null;
  date: string | null;
  fields?: Record<string, JsonValue>;
}

export interface BlacklistDuplicateHit {
  source: 'case' | 'deal';
  matchedField: string;
  id: string;
  label: string;
  stage: string | null;
  date: string | null;
  fields?: Record<string, JsonValue>;
}

export interface BlacklistDebtorRecord {
  carrierId: string;
  companyName: string;
  computedDebt: number;
  computedDebtDays: number;
  openInvoices: number;
  fields?: Record<string, JsonValue>;
}

export interface ProbeSlice<T> {
  available: boolean;
  error: string | null;
  hits: T[];
  truncated?: boolean;
}

export interface SearchPagination {
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DebtorSlice {
  available: boolean;
  error: string | null;
  records: BlacklistDebtorRecord[];
  truncated: boolean;
  pagination: SearchPagination;
}

export interface BlacklistSearchResult {
  matchedOn: BlacklistSearchBy;
  ban: ProbeSlice<BlacklistBanHit> & { ownAvailable: boolean; platformAvailable: boolean };
  duplicates: ProbeSlice<BlacklistDuplicateHit> & { casesAvailable: boolean; dealsAvailable: boolean };
  debtors: DebtorSlice;
}

const NOT_CONFIGURED = 'DWH_DATABASE_URL is not configured';

function asFields(row: Record<string, unknown>): Record<string, JsonValue> | undefined {
  const plain: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      const iso = Number.isNaN(value.getTime()) ? null : value.toISOString();
      if (iso !== null) plain[key] = iso;
      continue;
    }
    const next = jsonValue(value);
    if (next !== undefined) plain[key] = next;
  }
  return jsonFields(plain);
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

function needlesFor(by: BlacklistSearchBy, q: string): {
  mc?: string;
  dot?: string;
  email?: string;
  phone?: string;
  companyName?: string;
} {
  if (by === 'dot') return { dot: q };
  if (by === 'mc') return { mc: q };
  if (by === 'email') return { email: q };
  if (by === 'phone') return { phone: q };
  return { companyName: q };
}

function debtorNeedle(by: BlacklistSearchBy, q: string): string | null {
  if (by === 'email') {
    const email = q.trim().toLowerCase();
    return email === '' ? null : email;
  }
  if (by === 'name') {
    // SQL is `lower(btrim(company_name)) = $1` — punctuation stays. Phase 3's
    // normalizeIdentifier strips ",.#" for hash matching; using it here misses
    // "Foo Trucking, LLC" against the warehouse row.
    const name = q.trim().toLowerCase();
    return name === '' ? null : name;
  }
  const digits = q.replace(/\D+/g, '');
  return digits === '' || Number(digits) === 0 ? null : digits;
}

async function probeBan(
  ctx: TenantContext,
  by: BlacklistSearchBy,
  q: string,
): Promise<BlacklistSearchResult['ban']> {
  const ident = buildIdentifier(BY_TO_TYPE[by], q);
  if (!ident) {
    return {
      available: true,
      error: null,
      hits: [],
      ownAvailable: true,
      platformAvailable: true,
    };
  }

  const [ownSettled, platform] = await Promise.all([
    verificationScreeningRepo.matchBlacklist(ctx, [ident.hash]).then(
      (rows) => ({ ok: true as const, rows }),
      (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
    ),
    matchCreditPlatformBanList([{ entryType: ident.entryType, value: ident.value }]),
  ]);

  const hits: BlacklistBanHit[] = [];
  if (ownSettled.ok) {
    for (const entry of ownSettled.rows) {
      const hit: BlacklistBanHit = {
        list: 'own',
        entryType: entry.entryType,
        display: ident.display,
        reason: entry.reason,
        sourceCaseId: entry.sourceCaseId,
        date: isoDate(entry.createdAt),
      };
      const fields = asFields({
        id: entry.id,
        entry_type: entry.entryType,
        value_display: entry.valueDisplay,
        reason: entry.reason,
        source_case_id: entry.sourceCaseId,
        added_by: entry.addedBy,
        created_at: entry.createdAt,
        list: 'own',
      });
      if (fields !== undefined) hit.fields = fields;
      hits.push(hit);
    }
  }
  for (const row of platform.hits) {
    const hit: BlacklistBanHit = {
      list: 'credit_platform',
      entryType: row.entryType,
      display: ident.display,
      reason: row.reason,
      sourceCaseId: null,
      date: row.addedAt,
    };
    const fields = asFields({
      entry_id: row.entryId,
      cp_type: row.cpType,
      reason: row.reason,
      added_by: row.addedBy,
      added_at: row.addedAt,
      list: 'credit_platform',
    });
    if (fields !== undefined) hit.fields = fields;
    hits.push(hit);
  }

  const ownAvailable = ownSettled.ok;
  const platformAvailable = platform.available;
  const errors = [
    ownSettled.ok ? null : ownSettled.error,
    platformAvailable ? null : platform.error,
  ].filter((line): line is string => Boolean(line));

  return {
    // Either list unread is "could not finish the probe", not a clear — own hits still return.
    available: ownAvailable && platformAvailable,
    error: errors.length === 0 ? null : errors.join(' · '),
    hits,
    ownAvailable,
    platformAvailable,
  };
}

async function probeDuplicates(
  ctx: TenantContext,
  by: BlacklistSearchBy,
  q: string,
): Promise<BlacklistSearchResult['duplicates']> {
  const needles = needlesFor(by, q);
  const dealNeedles = {
    dealId: null,
    email: needles.email ?? null,
    mc: needles.mc ?? null,
    dot: needles.dot ?? null,
    companyName: needles.companyName ?? null,
  };

  const [casesSettled, deals] = await Promise.all([
    verificationScreeningRepo.matchDuplicates(ctx, null, needles).then(
      (rows) => ({ ok: true as const, rows }),
      (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
    ),
    screenDealsForCase(dealNeedles),
  ]);

  const hits: BlacklistDuplicateHit[] = [];
  if (casesSettled.ok) {
    for (const row of casesSettled.rows) {
      const hit: BlacklistDuplicateHit = {
        source: 'case',
        matchedField: row.entryType,
        id: row.id,
        label: row.display,
        stage: row.zohoStage ?? row.statusCode,
        date: row.applicationDate ?? isoDate(row.createdAt),
      };
      const fields = asFields({
        case_id: row.id,
        matched_field: row.entryType,
        status_code: row.statusCode,
        zoho_stage: row.zohoStage,
        zoho_deal_id: row.zohoDealId,
        application_date: row.applicationDate,
        created_at: row.createdAt,
      });
      if (fields !== undefined) hit.fields = fields;
      hits.push(hit);
    }
  }
  for (const dup of deals.duplicates) {
    const hit: BlacklistDuplicateHit = {
      source: 'deal',
      matchedField: dup.matchedOn,
      id: dup.dealId,
      label: dup.dealName ?? dup.dealId,
      stage: dup.stage,
      date: dup.applicationDate,
    };
    const fields = asFields({
      deal_id: dup.dealId,
      deal_name: dup.dealName,
      stage: dup.stage,
      application_date: dup.applicationDate,
      matched_on: dup.matchedOn,
      citifuel_status: dup.citifuelStatus,
    });
    if (fields !== undefined) hit.fields = fields;
    hits.push(hit);
  }

  const casesAvailable = casesSettled.ok;
  const dealsAvailable = deals.available;
  const errors = [
    casesSettled.ok ? null : casesSettled.error,
    dealsAvailable ? null : deals.error,
  ].filter((line): line is string => Boolean(line));

  return {
    available: casesAvailable && dealsAvailable,
    error: errors.length === 0 ? null : errors.join(' · '),
    hits,
    truncated: deals.truncated,
    casesAvailable,
    dealsAvailable,
  };
}

function debtorPage(page: number, pageSize: number, hasMore = false): SearchPagination {
  return { page, pageSize, hasMore };
}

function emptyDebtors(
  page: number,
  pageSize: number,
  over: Partial<DebtorSlice> = {},
): DebtorSlice {
  return {
    available: true,
    error: null,
    records: [],
    truncated: false,
    pagination: debtorPage(page, pageSize),
    ...over,
  };
}

async function probeDebtors(
  by: BlacklistSearchBy,
  q: string,
  page: number,
  pageSize: number,
): Promise<DebtorSlice> {
  if (!dwh.isConfigured()) {
    return emptyDebtors(page, pageSize, { available: false, error: NOT_CONFIGURED });
  }
  const needle = debtorNeedle(by, q);
  if (needle === null) return emptyDebtors(page, pageSize);

  try {
    const rows = await searchVerificationDebtors(by, needle, { page, pageSize });
    const hasMore = rows.length > pageSize;
    const records: BlacklistDebtorRecord[] = [];
    for (const row of rows.slice(0, pageSize)) {
      const carrierId = row.carrier_id == null ? '' : String(row.carrier_id).trim();
      if (carrierId === '') continue;
      const debt = Number(row.computed_debt ?? 0);
      const record: BlacklistDebtorRecord = {
        carrierId,
        companyName: String(row.company_name ?? '').trim() || '(unnamed)',
        computedDebt: Number.isFinite(debt) ? debt : 0,
        computedDebtDays: Number(row.computed_debt_days ?? 0) || 0,
        openInvoices: Number(row.open_invoices ?? 0) || 0,
      };
      const fields = asFields(row);
      if (fields !== undefined) record.fields = fields;
      records.push(record);
    }
    return {
      available: true,
      error: null,
      records,
      truncated: hasMore,
      pagination: debtorPage(page, pageSize, hasMore),
    };
  } catch (err) {
    logger.warn({ err: errorMessage(err), by }, 'blacklist debtor search failed');
    return emptyDebtors(page, pageSize, { available: false, error: errorMessage(err) });
  }
}

/** One key, three probes. Never throws. */
export async function searchBlacklist(
  ctx: TenantContext,
  query: { by: BlacklistSearchBy; q: string; page?: number | undefined; pageSize?: number | undefined },
): Promise<BlacklistSearchResult> {
  const by = query.by;
  const q = query.q.trim();
  const page = clampDebtorPage(query.page);
  const pageSize = clampDebtorPageSize(query.pageSize);
  const [ban, duplicates, debtors] = await Promise.all([
    probeBan(ctx, by, q).catch((err: unknown) => {
      logger.warn({ err: errorMessage(err) }, 'blacklist ban probe failed');
      return {
        available: false,
        error: errorMessage(err),
        hits: [],
        ownAvailable: false,
        platformAvailable: false,
      };
    }),
    probeDuplicates(ctx, by, q).catch((err: unknown) => {
      logger.warn({ err: errorMessage(err) }, 'blacklist duplicate probe failed');
      return {
        available: false,
        error: errorMessage(err),
        hits: [],
        truncated: false,
        casesAvailable: false,
        dealsAvailable: false,
      };
    }),
    probeDebtors(by, q, page, pageSize),
  ]);

  return { matchedOn: by, ban, duplicates, debtors };
}
