/**
 * Sales Call Hub — agent-scoped call history merged from Mytrion + Zoho (+ Gong when enabled).
 * Softphone stays global; this module is read-only list/detail DTOs for the hub UI.
 *
 * Identity: callers MUST pass the effective agent Zoho id (session user, or View-as target after
 * buildCallerContext). Never trust a client-supplied assignee override.
 */
import { env } from '../../config/env.js';
import { listGongCallsForAgent } from '../../integrations/gong.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { mytrionCallRepo } from '../../repos/mytrionCallRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export type CallHubSource = 'mytrion' | 'zoho' | 'gong';
export type CallHubStatus = 'answered' | 'missed' | 'unknown';

export interface CallHubLinked {
  type: 'lead' | 'deal' | 'retention_case';
  id: string;
  label?: string;
}

export interface CallHubItem {
  id: string;
  source: CallHubSource;
  direction: string;
  status: CallHubStatus;
  phone: string;
  startedAt: string;
  durationSeconds: number | null;
  result: string;
  subject: string | null;
  linked: CallHubLinked | null;
  /** Epoch ms for sort / filters. */
  startedTs: number;
}

export interface CallHubListFilter {
  from?: Date;
  to?: Date;
  source?: CallHubSource | 'all';
  status?: CallHubStatus | 'all';
  /** 1-based page. */
  page?: number;
  pageSize?: number;
}

export interface CallHubListResult {
  calls: CallHubItem[];
  page: number;
  pageSize: number;
  total: number;
  /** Effective agent the list is scoped to (after View-as). */
  agentZohoUserId: string;
}

const MAX_PAGE_SIZE = 50;
const MAX_SOURCE_WINDOW = 200;

function tsOf(v: unknown): number {
  const t = Date.parse(v == null ? '' : String(v));
  return Number.isNaN(t) ? 0 : t;
}

function zohoCallSeconds(row: Record<string, unknown>): number | null {
  const secs = Number(row.Call_Duration_in_seconds);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const dur = typeof row.Call_Duration === 'string' ? row.Call_Duration : '';
  if (dur && /^\d+(:\d{1,2})+$/.test(dur)) {
    return dur.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  }
  return null;
}

function zohoStatus(row: Record<string, unknown>): CallHubStatus {
  const raw = String(row.Outgoing_Call_Status ?? row.Call_Result ?? '').toLowerCase();
  if (!raw) return 'unknown';
  if (raw.includes('answered') || raw.includes('connected') || raw.includes('completed')) {
    return 'answered';
  }
  if (
    raw.includes('no answer') ||
    raw.includes('missed') ||
    raw.includes('busy') ||
    raw.includes('cancelled') ||
    raw.includes('voicemail')
  ) {
    return 'missed';
  }
  const secs = zohoCallSeconds(row);
  if (secs != null && secs > 0) return 'answered';
  return 'unknown';
}

function linkedFromZoho(row: Record<string, unknown>): CallHubLinked | null {
  const who = row.Who_Id;
  const what = row.What_Id;
  if (who && typeof who === 'object') {
    const id = String((who as { id?: unknown }).id ?? '');
    const name = String((who as { name?: unknown }).name ?? '');
    if (id) return { type: 'lead', id, ...(name ? { label: name } : {}) };
  }
  if (typeof who === 'string' && who) return { type: 'lead', id: who };
  if (what && typeof what === 'object') {
    const id = String((what as { id?: unknown }).id ?? '');
    const name = String((what as { name?: unknown }).name ?? '');
    if (id) return { type: 'deal', id, ...(name ? { label: name } : {}) };
  }
  if (typeof what === 'string' && what) return { type: 'deal', id: what };
  return null;
}

function zohoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function mapMytrionRow(
  r: Awaited<ReturnType<typeof mytrionCallRepo.listForCaller>>[number],
): CallHubItem {
  const when = r.callTime ?? r.createdAt;
  const startedAt = when instanceof Date ? when.toISOString() : String(when ?? '');
  const linked =
    r.sourceType && r.sourceId ? { type: r.sourceType, id: r.sourceId } : null;
  return {
    id: r.id,
    source: 'mytrion',
    direction: r.direction || 'Outbound',
    status: r.callStatus === 'picked_up' ? 'answered' : 'missed',
    phone: r.phoneNumber ?? '',
    startedAt,
    durationSeconds: r.durationSeconds ?? null,
    result: r.result || '',
    subject: null,
    linked,
    startedTs: tsOf(startedAt),
  };
}

function mapZohoRow(r: Record<string, unknown>): CallHubItem {
  const startedAt = typeof r.Call_Start_Time === 'string' ? r.Call_Start_Time : '';
  return {
    id: String(r.id ?? ''),
    source: 'zoho',
    direction: String(r.Call_Type ?? 'Outbound'),
    status: zohoStatus(r),
    phone: '',
    startedAt,
    durationSeconds: zohoCallSeconds(r),
    result: String(r.Call_Result ?? r.Outgoing_Call_Status ?? ''),
    subject: typeof r.Subject === 'string' ? r.Subject : null,
    linked: linkedFromZoho(r),
    startedTs: tsOf(startedAt),
  };
}

async function fetchMytrionCalls(
  ctx: TenantContext,
  callerZohoUserId: string,
  filter: CallHubListFilter,
  window: number,
): Promise<{ items: CallHubItem[]; total: number }> {
  const status = filter.status ?? 'all';
  const callStatus =
    status === 'answered' ? ('picked_up' as const) : status === 'missed' ? ('missed' as const) : undefined;
  const opts = {
    ...(filter.from ? { from: filter.from } : {}),
    ...(filter.to ? { to: filter.to } : {}),
    ...(callStatus ? { callStatus } : {}),
  };
  const [rows, total] = await Promise.all([
    mytrionCallRepo.listForCaller(ctx, callerZohoUserId, { ...opts, limit: window, offset: 0 }),
    mytrionCallRepo.countForCaller(ctx, callerZohoUserId, opts),
  ]);
  return { items: rows.map(mapMytrionRow), total };
}

async function fetchZohoCalls(
  callerZohoUserId: string,
  filter: CallHubListFilter,
  window: number,
): Promise<{ items: CallHubItem[]; total: number }> {
  const uid = callerZohoUserId.replace(/'/g, "''");
  const conditions = [`Owner = '${uid}'`];
  if (filter.from) conditions.push(`Call_Start_Time >= '${zohoDateTime(filter.from)}'`);
  if (filter.to) conditions.push(`Call_Start_Time <= '${zohoDateTime(filter.to)}'`);
  const where = conditions.join(' and ');
  const q =
    `select id, Call_Type, Call_Start_Time, Call_Duration, Call_Duration_in_seconds, ` +
    `Outgoing_Call_Status, Subject, Call_Result, Who_Id, What_Id ` +
    `from Calls where ${where} ` +
    `order by Call_Start_Time desc limit 0, ${window}`;
  const { rows, moreRecords } = await zohoCrm.runCoql(q);
  let items = rows.map(mapZohoRow);
  const statusFilter = filter.status ?? 'all';
  if (statusFilter !== 'all') {
    items = items.filter((c) => c.status === statusFilter);
  }
  // Zoho does not expose a cheap exact COUNT for Calls; bound total by the probe window.
  const total = moreRecords ? Math.max(window, items.length) + 1 : items.length;
  return { items, total };
}

/** Merged agent call history — each source is best-effort; paginated after merge. */
export async function listCallHubCalls(
  ctx: TenantContext,
  callerZohoUserId: string,
  filter: CallHubListFilter = {},
): Promise<CallHubListResult> {
  const want = filter.source ?? 'all';
  const statusFilter = filter.status ?? 'all';
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), MAX_PAGE_SIZE);
  const page = Math.max(filter.page ?? 1, 1);
  // Enough rows from each source to fill this page after merge (cap per source).
  const window = Math.min(page * pageSize, MAX_SOURCE_WINDOW);

  const tasks: Array<Promise<{ items: CallHubItem[]; total: number }>> = [];
  if (want === 'all' || want === 'mytrion') {
    tasks.push(
      fetchMytrionCalls(ctx, callerZohoUserId, filter, window).catch(() => ({
        items: [] as CallHubItem[],
        total: 0,
      })),
    );
  }
  if (want === 'all' || want === 'zoho') {
    tasks.push(
      fetchZohoCalls(callerZohoUserId, filter, window).catch(() => ({
        items: [] as CallHubItem[],
        total: 0,
      })),
    );
  }
  if ((want === 'all' || want === 'gong') && env.FF_GONG_ENABLED) {
    tasks.push(
      listGongCallsForAgent(callerZohoUserId, {
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        limit: window,
      })
        .then((rows) => {
          let items = rows.map(
            (r): CallHubItem => ({
              id: r.id,
              source: 'gong',
              direction: r.direction || 'Outbound',
              status: r.durationSeconds && r.durationSeconds > 0 ? 'answered' : 'unknown',
              phone: r.phone,
              startedAt: r.startedAt,
              durationSeconds: r.durationSeconds,
              result: r.result,
              subject: r.subject,
              linked: null,
              startedTs: tsOf(r.startedAt),
            }),
          );
          if (statusFilter !== 'all') {
            items = items.filter((c) => c.status === statusFilter);
          }
          return { items, total: items.length };
        })
        .catch(() => ({ items: [] as CallHubItem[], total: 0 })),
    );
  }

  const chunks = await Promise.all(tasks);
  let merged = chunks
    .flatMap((c) => c.items)
    .sort((a, b) => b.startedTs - a.startedTs);
  // Mytrion already SQL-filtered by status; Zoho/Gong may still need it when mixed.
  if (statusFilter !== 'all' && want !== 'mytrion') {
    merged = merged.filter((c) => c.status === statusFilter);
  }

  const total = chunks.reduce((sum, c) => sum + c.total, 0);
  const offset = (page - 1) * pageSize;
  const calls = merged.slice(offset, offset + pageSize);

  return {
    calls,
    page,
    pageSize,
    total,
    agentZohoUserId: callerZohoUserId,
  };
}
