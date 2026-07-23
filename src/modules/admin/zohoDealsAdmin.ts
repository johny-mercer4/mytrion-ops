/**
 * Admin Deals — org-wide Zoho deal list/search + one-click ownership transfer
 * (Deal + Contact + Account) and Owner_Logs browse for revert discovery.
 */
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { listActiveUsers, runCoql } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { OWNERSHIP_TRANSFER_REASON } from '../../db/schema/retention_ownership_transfers.js';
import {
  transferDealOwnershipToClaimant,
  type OwnershipTransferResult,
} from '../retention/zohoOwnership.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { RECOVERY_DEAL_IDS } from './recoveryDealIds.js';

const DEAL_LIST_FIELDS =
  'id, Deal_Name, Owner, Account_Name, Contact_Name, Application_Date, Owner_Last_Updated, Stage, Carrier_ID, Application_ID';

const DEAL_SEARCH_FIELDS = [
  'id',
  'Deal_Name',
  'Owner',
  'Account_Name',
  'Contact_Name',
  'Application_Date',
  'Owner_Last_Updated',
  'Stage',
  'Carrier_ID',
  'Application_ID',
] as const;

const OWNER_LOG_FIELDS =
  'id, Name, Module, Entity_ID, New_Owner_ID, New_Owner_Name, Owner_Log_Time, Created_Time, Created_By';

/** Default transferrer filter — John Mercer (handled bulk Deal Owner changes). */
export const DEFAULT_TRANSFERRER_ZOHO_USER_ID = '6227679000093960901';

/** Zoho record / user ids are numeric strings — refuse anything else before COQL. */
export function assertZohoNumericId(id: string, label = 'id'): string {
  const t = id.trim();
  if (!/^\d+$/.test(t)) {
    throw new AppError(`Invalid ${label}`, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
    });
  }
  return t;
}

function lookupName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === 'object') {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

function lookupId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  }
  return null;
}

function strField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export interface AdminDealDto {
  id: string;
  dealName: string | null;
  ownerZohoUserId: string | null;
  ownerName: string | null;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  applicationDate: string | null;
  ownerLastUpdated: string | null;
  stage: string | null;
  carrierId: string | null;
  applicationId: string | null;
}

export interface AdminOwnerLogDto {
  id: string;
  name: string | null;
  module: string | null;
  entityId: string | null;
  newOwnerId: string | null;
  newOwnerName: string | null;
  /** Who performed the ownership change (Zoho timeline “by …”). */
  transferrerZohoUserId: string | null;
  transferrerName: string | null;
  ownerLogTime: string | null;
  createdTime: string | null;
}

export function mapDealRow(row: Record<string, unknown>): AdminDealDto {
  const id = strField(row, 'id') ?? '';
  return {
    id,
    dealName: strField(row, 'Deal_Name'),
    ownerZohoUserId: lookupId(row.Owner),
    ownerName: lookupName(row.Owner),
    accountId: lookupId(row.Account_Name),
    accountName: lookupName(row.Account_Name),
    contactId: lookupId(row.Contact_Name),
    contactName: lookupName(row.Contact_Name),
    applicationDate: strField(row, 'Application_Date'),
    ownerLastUpdated: strField(row, 'Owner_Last_Updated'),
    stage: strField(row, 'Stage'),
    carrierId: strField(row, 'Carrier_ID'),
    applicationId: strField(row, 'Application_ID'),
  };
}

export function mapOwnerLogRow(row: Record<string, unknown>): AdminOwnerLogDto {
  return {
    id: strField(row, 'id') ?? '',
    name: strField(row, 'Name'),
    module: strField(row, 'Module'),
    entityId: strField(row, 'Entity_ID'),
    newOwnerId: strField(row, 'New_Owner_ID'),
    newOwnerName: strField(row, 'New_Owner_Name'),
    transferrerZohoUserId: lookupId(row.Created_By),
    transferrerName: lookupName(row.Created_By),
    ownerLogTime: strField(row, 'Owner_Log_Time'),
    createdTime: strField(row, 'Created_Time'),
  };
}

/** Default list: 200 newest Application_Date deals. */
export async function listAdminDeals(limit = 200): Promise<AdminDealDto[]> {
  const n = Math.min(200, Math.max(1, Math.trunc(limit) || 200));
  // Zoho COQL requires a WHERE clause (bare `from Deals order by …` → SYNTAX_ERROR).
  const q = `select ${DEAL_LIST_FIELDS} from Deals where Application_Date is not null order by Application_Date desc limit 0, ${n}`;
  const { rows } = await runCoql(q);
  return rows.map(mapDealRow).filter((d) => d.id);
}

export async function searchAdminDeals(qRaw: string): Promise<AdminDealDto[]> {
  const q = qRaw.trim();
  if (!q) return listAdminDeals(200);

  if (/^\d+$/.test(q)) {
    // Deal id, or Carrier/Application id criteria.
    try {
      const deal = await zohoCrmRecords.getRecord('Deals', q);
      if (deal) return [mapDealRow(deal)];
    } catch {
      // fall through to criteria / word search
    }
    const criteria = `((Carrier_ID:equals:${q})or(Application_ID:equals:${q}))`;
    const page = await zohoCrmRecords.searchRecords('Deals', {
      criteria,
      perPage: 50,
      fields: DEAL_SEARCH_FIELDS,
    });
    if (page.rows.length > 0) return page.rows.map(mapDealRow).filter((d) => d.id);
  }

  const page = await zohoCrmRecords.searchRecords('Deals', {
    word: q.slice(0, 100),
    perPage: 50,
    fields: DEAL_SEARCH_FIELDS,
  });
  return page.rows.map(mapDealRow).filter((d) => d.id);
}

export async function getAdminDeal(dealId: string): Promise<AdminDealDto | null> {
  const id = assertZohoNumericId(dealId, 'deal id');
  const deal = await zohoCrmRecords.getRecord('Deals', id);
  return deal ? mapDealRow(deal) : null;
}

export interface ListOwnerLogsOpts {
  module?: string;
  entityId?: string;
  newOwnerId?: string;
  /** Zoho user who performed the transfer (Owner_Logs.Created_By — timeline “by …”). */
  transferrerId?: string;
  since?: string;
  limit?: number;
}

export function buildOwnerLogsCoql(opts: ListOwnerLogsOpts = {}): string {
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 100) || 100));
  const clauses: string[] = [];
  const mod = (opts.module ?? 'Deals').trim();
  if (mod) {
    // Module values in logs are typically the API name (Deals / Contacts / Accounts).
    const safe = mod.replace(/'/g, '');
    clauses.push(`Module = '${safe}'`);
  }
  if (opts.entityId?.trim()) {
    const eid = assertZohoNumericId(opts.entityId, 'entity id');
    clauses.push(`Entity_ID = '${eid}'`);
  }
  if (opts.newOwnerId?.trim()) {
    const nid = assertZohoNumericId(opts.newOwnerId, 'new owner id');
    clauses.push(`New_Owner_ID = '${nid}'`);
  }
  if (opts.transferrerId?.trim()) {
    const tid = assertZohoNumericId(opts.transferrerId, 'transferrer id');
    // Created_By is the actor on the log (= who changed Deal Owner in the CRM timeline).
    clauses.push(`Created_By = '${tid}'`);
  }
  if (opts.since?.trim()) {
    // Accept YYYY-MM-DD or ISO; COQL datetime literals use ISO-ish strings.
    const since = opts.since.trim().replace(/'/g, '');
    clauses.push(`Owner_Log_Time >= '${since}'`);
  }
  const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  return `select ${OWNER_LOG_FIELDS} from Owner_Logs${where} order by Owner_Log_Time desc limit 0, ${limit}`;
}

export async function listOwnerLogs(opts: ListOwnerLogsOpts = {}): Promise<AdminOwnerLogDto[]> {
  const q = buildOwnerLogsCoql(opts);
  const { rows } = await runCoql(q);
  return rows.map(mapOwnerLogRow).filter((r) => r.id);
}

export interface OwnerTimelineChange {
  auditedTime: string | null;
  transferrerZohoUserId: string | null;
  transferrerName: string | null;
  /** Timeline Owner `_value.old` — prior Deal Owner before this change. */
  previousOwnerName: string | null;
  previousOwnerZohoUserId: string | null;
  /** Timeline Owner `_value.new` — owner after this change. */
  newOwnerName: string | null;
  newOwnerZohoUserId: string | null;
  source: string | null;
}

function timelineOwnerLabel(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return lookupName(value);
}

/** Timeline Owner values are usually bare names; only take id from lookup objects. */
function timelineOwnerId(value: unknown): string | null {
  if (value == null || typeof value === 'string') return null;
  return lookupId(value);
}

/** Pull Owner field_history rows from a deal timeline entry list. */
export function extractOwnerTimelineChanges(
  entries: Array<Record<string, unknown>>,
): OwnerTimelineChange[] {
  const out: OwnerTimelineChange[] = [];
  for (const entry of entries) {
    const doneBy = entry.done_by;
    const transferrerZohoUserId = lookupId(doneBy);
    const transferrerName = lookupName(doneBy);
    const auditedTime =
      typeof entry.audited_time === 'string' ? entry.audited_time : null;
    const source = typeof entry.source === 'string' ? entry.source : null;
    const fhRaw = entry.field_history;
    const fields = Array.isArray(fhRaw)
      ? fhRaw
      : fhRaw && typeof fhRaw === 'object'
        ? [fhRaw]
        : [];
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const f = field as Record<string, unknown>;
      if (f.api_name !== 'Owner') continue;
      const value = f._value;
      let previousOwnerName: string | null = null;
      let previousOwnerZohoUserId: string | null = null;
      let newOwnerName: string | null = null;
      let newOwnerZohoUserId: string | null = null;
      if (value && typeof value === 'object') {
        const v = value as { old?: unknown; new?: unknown };
        previousOwnerName = timelineOwnerLabel(v.old);
        previousOwnerZohoUserId = timelineOwnerId(v.old);
        newOwnerName = timelineOwnerLabel(v.new);
        newOwnerZohoUserId = timelineOwnerId(v.new);
      }
      out.push({
        auditedTime,
        transferrerZohoUserId,
        transferrerName,
        previousOwnerName,
        previousOwnerZohoUserId,
        newOwnerName,
        newOwnerZohoUserId,
        source,
      });
    }
  }
  return out;
}

async function resolveOwnerIdsOnChange(
  change: OwnerTimelineChange,
  nameToId: Map<string, string>,
): Promise<OwnerTimelineChange> {
  const lookup = (name: string | null, existing: string | null): string | null => {
    if (existing) return existing;
    if (!name) return null;
    return nameToId.get(name.trim().toLowerCase()) ?? null;
  };
  return {
    ...change,
    previousOwnerZohoUserId: lookup(change.previousOwnerName, change.previousOwnerZohoUserId),
    newOwnerZohoUserId: lookup(change.newOwnerName, change.newOwnerZohoUserId),
  };
}

async function buildUserNameIndex(): Promise<Map<string, string>> {
  const users = await listActiveUsers();
  const map = new Map<string, string>();
  for (const u of users) {
    const name = (u.name ?? '').trim().toLowerCase();
    if (name && !map.has(name)) map.set(name, u.zohoUserId);
  }
  return map;
}

async function fetchDealsByIds(ids: readonly string[]): Promise<AdminDealDto[]> {
  const clean = ids.map((id) => assertZohoNumericId(id, 'deal id'));
  if (clean.length === 0) return [];
  const byId = new Map<string, AdminDealDto>();
  // COQL `in` batches — keep payloads modest.
  const batchSize = 50;
  for (let i = 0; i < clean.length; i += batchSize) {
    const batch = clean.slice(i, i + batchSize);
    const inList = batch.map((id) => `'${id}'`).join(',');
    const q = `select ${DEAL_LIST_FIELDS} from Deals where id in (${inList})`;
    const { rows } = await runCoql(q);
    for (const row of rows) {
      const dto = mapDealRow(row);
      if (dto.id) byId.set(dto.id, dto);
    }
  }
  return clean.map((id) => byId.get(id)).filter((d): d is AdminDealDto => d != null);
}

/**
 * Latest Deal Owner change on the timeline performed by `transferrerId` (or any Owner change).
 * Resolves prior/new owner names → Zoho user ids via ActiveUsers when Timeline only has names.
 */
export async function fetchDealOwnerTimelineChange(
  dealId: string,
  transferrerId?: string | null,
  nameToId?: Map<string, string>,
): Promise<OwnerTimelineChange | null> {
  const id = assertZohoNumericId(dealId, 'deal id');
  const tid = transferrerId?.trim()
    ? assertZohoNumericId(transferrerId, 'transferrer id')
    : undefined;
  const entries = await zohoCrmRecords.getRecordTimeline('Deals', id, {
    ...(tid ? { doneByUserId: tid } : {}),
    perPage: 50,
  });
  const changes = extractOwnerTimelineChanges(entries);
  const raw = changes[0] ?? null;
  if (!raw) return null;
  const index = nameToId ?? (await buildUserNameIndex());
  return resolveOwnerIdsOnChange(raw, index);
}

/**
 * Recovery set: load known mis-assigned deal ids, confirm Owner change via Timeline
 * `done_by` = transferrer (Owner_Logs.Created_By is the workflow user — unusable).
 * Each timeline row includes prior owner (old) + new owner from Owner field_history.
 */
export async function listDealsTransferredBy(
  transferrerId: string,
  limit = 200,
): Promise<{
  deals: AdminDealDto[];
  timeline: Array<{ dealId: string; change: OwnerTimelineChange }>;
}> {
  const tid = assertZohoNumericId(transferrerId, 'transferrer id');
  const cap = Math.min(200, Math.max(1, Math.trunc(limit) || 200));
  const ids = RECOVERY_DEAL_IDS.slice(0, cap);
  const [deals, nameToId] = await Promise.all([fetchDealsByIds(ids), buildUserNameIndex()]);

  const timeline: Array<{ dealId: string; change: OwnerTimelineChange }> = [];
  // Bounded concurrency — Zoho rate limits; recover list is ~130 deals.
  const concurrency = 6;
  for (let i = 0; i < deals.length; i += concurrency) {
    const chunk = deals.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (deal) => {
        try {
          const change = await fetchDealOwnerTimelineChange(deal.id, tid, nameToId);
          return change ? { dealId: deal.id, change } : null;
        } catch (err) {
          logger.warn(
            { dealId: deal.id, err: err instanceof Error ? err.message : String(err) },
            'admin deals: timeline fetch failed',
          );
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) timeline.push(r);
    }
  }

  const confirmed = new Set(timeline.map((t) => t.dealId));
  // Prefer deals with a confirmed Owner change by the transferrer; keep others for manual review.
  const ordered = [
    ...deals.filter((d) => confirmed.has(d.id)),
    ...deals.filter((d) => !confirmed.has(d.id)),
  ];
  return { deals: ordered, timeline };
}

/**
 * Prior Sales owner from Timeline Owner history (old value), with resolved Zoho user id when possible.
 */
export async function suggestPriorOwner(
  entityId: string,
  transferrerId?: string | null,
): Promise<{
  zohoUserId: string | null;
  name: string | null;
  change: OwnerTimelineChange | null;
} | null> {
  const change = await fetchDealOwnerTimelineChange(entityId, transferrerId);
  if (!change?.previousOwnerName && !change?.previousOwnerZohoUserId) return null;
  return {
    zohoUserId: change.previousOwnerZohoUserId,
    name: change.previousOwnerName,
    change,
  };
}

function zohoUserIdFromCtx(userId: string | null | undefined): string | null {
  if (!userId?.trim()) return null;
  const raw = userId.trim();
  return raw.startsWith('zoho:') ? raw.slice('zoho:'.length) : raw;
}

/** Real admin when acting-as; otherwise the signed-in caller. */
function actorFromAdminCtx(
  ctx: TenantContext,
  opts: { actorName?: string | null } = {},
): { actorZohoUserId: string | null; actorName: string | null } {
  const realUserId = ctx.impersonatorUserId ?? ctx.userId;
  const actorZohoUserId = zohoUserIdFromCtx(realUserId);
  if (ctx.impersonatorUserId) {
    return {
      actorZohoUserId,
      actorName: opts.actorName?.trim() || `admin:${zohoUserIdFromCtx(ctx.impersonatorUserId)}`,
    };
  }
  return {
    actorZohoUserId,
    actorName: opts.actorName?.trim() || ctx.userName?.trim() || null,
  };
}

export async function transferAdminDealOwnership(
  ctx: TenantContext,
  dealId: string,
  toZohoUserId: string,
  opts: { toOwnerName?: string | null; actorName?: string | null } = {},
): Promise<{ deal: AdminDealDto; transfer: OwnershipTransferResult }> {
  const id = assertZohoNumericId(dealId, 'deal id');
  const to = assertZohoNumericId(toZohoUserId, 'toZohoUserId');
  const before = await getAdminDeal(id);
  if (!before) {
    throw new AppError('Deal not found', {
      statusCode: 404,
      code: 'NOT_FOUND',
      expose: true,
    });
  }

  const actor = actorFromAdminCtx(
    ctx,
    opts.actorName != null ? { actorName: opts.actorName } : {},
  );
  const transfer = await transferDealOwnershipToClaimant(id, to, {
    tenantId: ctx.tenantId || DEFAULT_TENANT_ID,
    reason: OWNERSHIP_TRANSFER_REASON.adminManual,
    carrierId: before.carrierId,
    companyName: before.accountName,
    dealName: before.dealName,
    contactName: before.contactName,
    actorZohoUserId: actor.actorZohoUserId,
    actorName: actor.actorName,
    toOwnerName: opts.toOwnerName ?? null,
  });

  const after = (await getAdminDeal(id)) ?? {
    ...before,
    ownerZohoUserId: to,
    ownerName: opts.toOwnerName ?? before.ownerName,
  };
  return { deal: after, transfer };
}
