import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionAnnouncementReads,
  mytrionAnnouncements,
  type MytrionAnnouncement,
  type MytrionAnnouncementPriority,
  type NewMytrionAnnouncement,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface CreateMytrionAnnouncementInput {
  title: string;
  body: string;
  targetDepartments: string[];
  priority: MytrionAnnouncementPriority;
}

export interface ReaderAnnouncement extends MytrionAnnouncement {
  readAt: Date | null;
}

function audienceCondition(departments: readonly string[]) {
  const normalized = [
    ...new Set(departments.map((department) => department.trim().toLowerCase())),
  ].filter(Boolean);
  if (normalized.length === 0) return undefined;
  return or(
    ...normalized.map(
      (department) =>
        sql`${mytrionAnnouncements.targetDepartments} @> ${JSON.stringify([department])}::jsonb`,
    ),
  );
}

/** All DB access for manager-to-worker announcements, always tenant-scoped. */
export const mytrionAnnouncementRepo = {
  async create(
    ctx: TenantContext,
    input: CreateMytrionAnnouncementInput,
  ): Promise<MytrionAnnouncement> {
    const row: NewMytrionAnnouncement = {
      tenantId: ctx.tenantId,
      title: input.title,
      body: input.body,
      targetDepartments: input.targetDepartments,
      priority: input.priority,
      createdByUserId: ctx.userId,
    };
    const rows = await db.insert(mytrionAnnouncements).values(row).returning();
    return firstOrThrow(rows, 'mytrion_announcements insert returned no row');
  },

  async listForManager(ctx: TenantContext, limit = 100): Promise<MytrionAnnouncement[]> {
    return db
      .select()
      .from(mytrionAnnouncements)
      .where(eq(mytrionAnnouncements.tenantId, ctx.tenantId))
      .orderBy(desc(mytrionAnnouncements.publishedAt), desc(mytrionAnnouncements.id))
      .limit(Math.min(Math.max(limit, 1), 200));
  },

  async listForReader(
    ctx: TenantContext,
    readerUserId: string,
    departments: readonly string[],
    limit = 100,
  ): Promise<ReaderAnnouncement[]> {
    const audience = audienceCondition(departments);
    if (!audience) return [];
    const rows = await db
      .select()
      .from(mytrionAnnouncements)
      .where(and(eq(mytrionAnnouncements.tenantId, ctx.tenantId), audience))
      .orderBy(desc(mytrionAnnouncements.publishedAt), desc(mytrionAnnouncements.id))
      .limit(Math.min(Math.max(limit, 1), 200));
    if (rows.length === 0) return [];
    const receipts = await db
      .select({
        announcementId: mytrionAnnouncementReads.announcementId,
        readAt: mytrionAnnouncementReads.readAt,
      })
      .from(mytrionAnnouncementReads)
      .where(
        and(
          eq(mytrionAnnouncementReads.tenantId, ctx.tenantId),
          eq(mytrionAnnouncementReads.readerUserId, readerUserId),
          inArray(
            mytrionAnnouncementReads.announcementId,
            rows.map((row) => row.id),
          ),
        ),
      );
    const readById = new Map(receipts.map((receipt) => [receipt.announcementId, receipt.readAt]));
    return rows.map((announcement) => ({
      ...announcement,
      readAt: readById.get(announcement.id) ?? null,
    }));
  },

  async markRead(
    ctx: TenantContext,
    announcementId: string,
    readerUserId: string,
    departments: readonly string[],
  ): Promise<boolean> {
    const audience = audienceCondition(departments);
    if (!audience) return false;
    const rows = await db
      .select()
      .from(mytrionAnnouncements)
      .where(
        and(
          eq(mytrionAnnouncements.tenantId, ctx.tenantId),
          eq(mytrionAnnouncements.id, announcementId),
          audience,
        ),
      )
      .limit(1);
    const announcement = rows[0];
    if (!announcement) return false;
    await db
      .insert(mytrionAnnouncementReads)
      .values({
        tenantId: ctx.tenantId,
        announcementId,
        readerUserId,
      })
      .onConflictDoNothing({
        target: [
          mytrionAnnouncementReads.tenantId,
          mytrionAnnouncementReads.announcementId,
          mytrionAnnouncementReads.readerUserId,
        ],
      });
    return true;
  },
};
