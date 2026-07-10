import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  inboxEvents,
  type InboxEvent,
  type InboxOwnerKind,
  type InboxPriority,
  type NewInboxEvent,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, normalizePagination } from './util.js';

/** Flat DTO — also the exact payload pushed over the realtime WebSocket. */
export interface InboxEventDto {
  id: string;
  priority: InboxPriority;
  tag: string | null;
  type: string;
  ownerKind: InboxOwnerKind;
  ownerId: string;
  title: string;
  detail: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInboxEventInput {
  priority?: InboxPriority | undefined;
  tag?: string | undefined;
  type: string;
  ownerKind: InboxOwnerKind;
  ownerId: string;
  title: string;
  detail?: string | undefined;
}

export interface ListInboxEventsOpts {
  limit?: number;
  offset?: number;
  ownerKind?: InboxOwnerKind;
  ownerId?: string;
  tag?: string;
  type?: string;
  priority?: InboxPriority;
  unreadOnly?: boolean;
}

export function toInboxEventDto(row: InboxEvent): InboxEventDto {
  return {
    id: row.id,
    priority: row.priority,
    tag: row.tag,
    type: row.type,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    title: row.title,
    detail: row.detail,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const trimOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

export const inboxEventRepo = {
  async list(
    ctx: TenantContext,
    opts: ListInboxEventsOpts = {},
  ): Promise<{ events: InboxEventDto[]; total: number; unread: number }> {
    const { limit, offset } = normalizePagination(opts);
    const clauses = [eq(inboxEvents.tenantId, ctx.tenantId)];
    if (opts.ownerKind) clauses.push(eq(inboxEvents.ownerKind, opts.ownerKind));
    if (opts.ownerId) clauses.push(eq(inboxEvents.ownerId, opts.ownerId));
    if (opts.tag) clauses.push(eq(inboxEvents.tag, opts.tag));
    if (opts.type) clauses.push(eq(inboxEvents.type, opts.type));
    if (opts.priority) clauses.push(eq(inboxEvents.priority, opts.priority));
    const scope = and(...clauses);
    const where = opts.unreadOnly ? and(scope, isNull(inboxEvents.readAt)) : scope;
    const [rows, counts, unreadCounts] = await Promise.all([
      db
        .select()
        .from(inboxEvents)
        .where(where)
        .orderBy(desc(inboxEvents.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(inboxEvents).where(where),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inboxEvents)
        .where(and(scope, isNull(inboxEvents.readAt))),
    ]);
    return {
      events: rows.map(toInboxEventDto),
      total: counts[0]?.count ?? 0,
      unread: unreadCounts[0]?.count ?? 0,
    };
  },

  async findById(ctx: TenantContext, id: string): Promise<InboxEvent | undefined> {
    const rows = await db
      .select()
      .from(inboxEvents)
      .where(and(eq(inboxEvents.id, id), eq(inboxEvents.tenantId, ctx.tenantId)))
      .limit(1);
    return rows[0];
  },

  async create(ctx: TenantContext, input: CreateInboxEventInput): Promise<InboxEventDto> {
    const values: NewInboxEvent = {
      tenantId: ctx.tenantId,
      priority: input.priority ?? 'medium',
      tag: trimOrNull(input.tag),
      type: input.type.trim(),
      ownerKind: input.ownerKind,
      ownerId: input.ownerId.trim(),
      title: input.title.trim(),
      detail: trimOrNull(input.detail),
    };
    const rows = await db.insert(inboxEvents).values(values).returning();
    return toInboxEventDto(firstOrThrow(rows, 'Failed to insert inbox event'));
  },

  /** Mark one event read (idempotent — an already-read event keeps its first readAt). */
  async markRead(ctx: TenantContext, id: string): Promise<InboxEventDto | null> {
    const rows = await db
      .update(inboxEvents)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(inboxEvents.id, id),
          eq(inboxEvents.tenantId, ctx.tenantId),
          isNull(inboxEvents.readAt),
        ),
      )
      .returning();
    const row = rows[0];
    if (row) return toInboxEventDto(row);
    const existing = await this.findById(ctx, id);
    return existing ? toInboxEventDto(existing) : null;
  },

  /** Mark every unread event of one owner read. Returns how many flipped. */
  async markAllRead(
    ctx: TenantContext,
    ownerKind: InboxOwnerKind,
    ownerId: string,
  ): Promise<number> {
    const rows = await db
      .update(inboxEvents)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(inboxEvents.tenantId, ctx.tenantId),
          eq(inboxEvents.ownerKind, ownerKind),
          eq(inboxEvents.ownerId, ownerId),
          isNull(inboxEvents.readAt),
        ),
      )
      .returning({ id: inboxEvents.id });
    return rows.length;
  },

  /** Delete one (tenant-scoped). Returns true when a row was removed. */
  async deleteById(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(inboxEvents)
      .where(and(eq(inboxEvents.id, id), eq(inboxEvents.tenantId, ctx.tenantId)))
      .returning({ id: inboxEvents.id });
    return rows.length > 0;
  },
};
