import { and, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionInboxMessages,
  type MytrionInboxMessage,
  type NewMytrionInboxMessage,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation, normalizePagination } from './util.js';
import { decodeKeysetCursor } from './keysetCursor.js';

/** Caller-supplied fields for one inbox message; tenant + defaults are set by the repo. */
export interface CreateInboxMessageInput {
  /** Zoho `Owner.id` — the recipient agent. */
  ownerZohoUserId: string;
  subject: string;
  content?: string | null;
  /** Zoho `Type` (Task/Update/Assignment/…) — free text; defaults to 'Info'. */
  type?: string | null;
  /** Zoho `Priority` (small/medium/high) — defaults to 'medium'. */
  priority?: string | null;
  tag?: string | null;
  sourceUrl?: string | null;
  name?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  /** Zoho `Org_Module` record id (idempotency key), when the row originated from Zoho. */
  zohoRecordId?: string | null;
  /** Zoho `Record_Status__s` (Available/Draft/Trash) — defaults to 'Available'. */
  recordStatus?: string | null;
  zohoCreatedAt?: Date | null;
}

export type InboxCategory = 'all' | 'task' | 'alert' | 'reminder';

interface InboxListFilter {
  limit?: number;
  offset?: number;
  query?: string;
  category?: InboxCategory;
  unread?: boolean;
  cursor?: string;
  tag?: string;
}

function ownerClauses(
  ctx: TenantContext,
  ownerZohoUserId: string,
  filter: Pick<InboxListFilter, 'query' | 'category' | 'unread' | 'tag'> = {},
) {
  const clauses = [
    eq(mytrionInboxMessages.tenantId, ctx.tenantId),
    eq(mytrionInboxMessages.ownerZohoUserId, ownerZohoUserId),
    ne(mytrionInboxMessages.recordStatus, 'Trash'),
  ];
  const query = filter.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    const match = or(
      ilike(mytrionInboxMessages.subject, pattern),
      ilike(mytrionInboxMessages.content, pattern),
      ilike(mytrionInboxMessages.name, pattern),
      ilike(mytrionInboxMessages.tag, pattern),
    );
    if (match) clauses.push(match);
  }
  if (filter.category === 'task') clauses.push(sql`lower(${mytrionInboxMessages.type}) = 'task'`);
  if (filter.category === 'alert') {
    clauses.push(sql`lower(${mytrionInboxMessages.type}) in ('warning', 'critical')`);
  }
  if (filter.category === 'reminder') {
    clauses.push(sql`lower(${mytrionInboxMessages.type}) not in ('task', 'warning', 'critical')`);
  }
  if (filter.unread) clauses.push(isNull(mytrionInboxMessages.readAt));
  if (filter.tag?.trim()) clauses.push(eq(mytrionInboxMessages.tag, filter.tag.trim()));
  return clauses;
}

/**
 * mytrion_inbox_messages — our own copy of the Zoho CRM inbox (`Org_Module`). Every read/write is
 * tenant-scoped (ctx.tenantId) and, for reads, owner-scoped (the agent's Zoho user id); there are no
 * DB FKs, so isolation lives here. Persist-then-publish is the inbox service's job (see
 * modules/inbox/service.ts) — this repo is pure DB.
 */
export const mytrionInboxMessageRepo = {
  /** One row by its Zoho record id (idempotency lookup). Tenant-scoped. */
  async findByZohoRecordId(
    ctx: TenantContext,
    zohoRecordId: string,
  ): Promise<MytrionInboxMessage | undefined> {
    const rows = await db
      .select()
      .from(mytrionInboxMessages)
      .where(
        and(
          eq(mytrionInboxMessages.tenantId, ctx.tenantId),
          eq(mytrionInboxMessages.zohoRecordId, zohoRecordId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async create(ctx: TenantContext, input: CreateInboxMessageInput): Promise<MytrionInboxMessage> {
    const row: NewMytrionInboxMessage = {
      tenantId: ctx.tenantId,
      zohoRecordId: input.zohoRecordId ?? null,
      ownerZohoUserId: input.ownerZohoUserId,
      ownerName: input.ownerName ?? null,
      ownerEmail: input.ownerEmail ?? null,
      subject: input.subject,
      name: input.name ?? null,
      content: input.content ?? null,
      ...(input.type ? { type: input.type } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      tag: input.tag ?? null,
      sourceUrl: input.sourceUrl ?? null,
      ...(input.recordStatus ? { recordStatus: input.recordStatus } : {}),
      zohoCreatedAt: input.zohoCreatedAt ?? null,
    };
    try {
      const rows = await db.insert(mytrionInboxMessages).values(row).returning();
      return firstOrThrow(rows, 'mytrion_inbox_messages insert returned no row');
    } catch (err) {
      // Idempotent Zoho retry: a concurrent insert with the same (tenant, zoho_record_id) hit the
      // partial-unique index — return the row that won the race instead of surfacing a 500.
      if (input.zohoRecordId && isUniqueViolation(err)) {
        const existing = await this.findByZohoRecordId(ctx, input.zohoRecordId);
        if (existing) return existing;
      }
      throw err;
    }
  },

  /** An owner's inbox (tenant + owner scoped), newest first, excluding trashed rows. */
  async listForOwner(
    ctx: TenantContext,
    ownerZohoUserId: string,
    opts: InboxListFilter = {},
  ): Promise<MytrionInboxMessage[]> {
    const { limit, offset } = normalizePagination(opts);
    const clauses = ownerClauses(ctx, ownerZohoUserId, opts);
    const cursor = opts.cursor ? decodeKeysetCursor(opts.cursor) : null;
    if (cursor) {
      clauses.push(
        sql`(${mytrionInboxMessages.createdAt}, ${mytrionInboxMessages.id}) < (${cursor.at}::timestamptz, ${cursor.id})`,
      );
    }
    return db
      .select()
      .from(mytrionInboxMessages)
      .where(and(...clauses))
      .orderBy(desc(mytrionInboxMessages.createdAt), desc(mytrionInboxMessages.id))
      .limit(limit)
      // Keep offset for older clients; cursor-based callers always start at the exact boundary.
      .offset(cursor ? 0 : offset);
  },

  async countsForOwner(
    ctx: TenantContext,
    ownerZohoUserId: string,
    query?: string,
    tag?: string,
  ): Promise<{ all: number; unread: number; task: number; alert: number; reminder: number }> {
    const rows = await db
      .select({
        all: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where ${mytrionInboxMessages.readAt} is null)::int`,
        task: sql<number>`count(*) filter (where lower(${mytrionInboxMessages.type}) = 'task')::int`,
        alert: sql<number>`count(*) filter (where lower(${mytrionInboxMessages.type}) in ('warning', 'critical'))::int`,
        reminder: sql<number>`count(*) filter (where lower(${mytrionInboxMessages.type}) not in ('task', 'warning', 'critical'))::int`,
      })
      .from(mytrionInboxMessages)
      .where(
        and(
          ...ownerClauses(ctx, ownerZohoUserId, {
            ...(query ? { query } : {}),
            ...(tag ? { tag } : {}),
          }),
        ),
      );
    const row = rows[0];
    return {
      all: Number(row?.all) || 0,
      unread: Number(row?.unread) || 0,
      task: Number(row?.task) || 0,
      alert: Number(row?.alert) || 0,
      reminder: Number(row?.reminder) || 0,
    };
  },

  async setRead(
    ctx: TenantContext,
    id: string,
    ownerZohoUserId: string,
    read: boolean,
  ): Promise<MytrionInboxMessage | undefined> {
    const rows = await db
      .update(mytrionInboxMessages)
      .set({ readAt: read ? new Date() : null, updatedAt: new Date() })
      .where(
        and(
          eq(mytrionInboxMessages.tenantId, ctx.tenantId),
          eq(mytrionInboxMessages.id, id),
          eq(mytrionInboxMessages.ownerZohoUserId, ownerZohoUserId),
        ),
      )
      .returning();
    return rows[0];
  },

  async markAllRead(ctx: TenantContext, ownerZohoUserId: string): Promise<number> {
    const rows = await db
      .update(mytrionInboxMessages)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(...ownerClauses(ctx, ownerZohoUserId, { unread: true })))
      .returning({ id: mytrionInboxMessages.id });
    return rows.length;
  },

  /** Delete one message the caller owns (tenant + owner scoped). Returns true if a row was removed. */
  async deleteForOwner(
    ctx: TenantContext,
    id: string,
    ownerZohoUserId: string,
  ): Promise<boolean> {
    const rows = await db
      .delete(mytrionInboxMessages)
      .where(
        and(
          eq(mytrionInboxMessages.tenantId, ctx.tenantId),
          eq(mytrionInboxMessages.id, id),
          eq(mytrionInboxMessages.ownerZohoUserId, ownerZohoUserId),
        ),
      )
      .returning({ id: mytrionInboxMessages.id });
    return rows.length > 0;
  },
};
