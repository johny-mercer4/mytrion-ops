import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type MytrionAnnouncementPriority = 'normal' | 'high';

/**
 * Manager-authored announcements for internal Mytrion workers. Audience matching and read state
 * are enforced by mytrionAnnouncementRepo; routes never query these tables directly.
 */
export const mytrionAnnouncements = pgTable(
  'mytrion_announcements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `man_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    targetDepartments: jsonb('target_departments').$type<string[]>().notNull(),
    priority: text('priority').$type<MytrionAnnouncementPriority>().notNull().default('normal'),
    createdByUserId: text('created_by_user_id').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantPublishedIdx: index('mytrion_announcements_tenant_published_idx').on(
      table.tenantId,
      table.publishedAt,
    ),
  }),
);

/** One idempotent read receipt per worker and announcement. */
export const mytrionAnnouncementReads = pgTable(
  'mytrion_announcement_reads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mar_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    announcementId: text('announcement_id')
      .notNull()
      .references(() => mytrionAnnouncements.id, { onDelete: 'cascade' }),
    readerUserId: text('reader_user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    announcementReaderUk: uniqueIndex('mytrion_announcement_reads_announcement_reader_uk').on(
      table.tenantId,
      table.announcementId,
      table.readerUserId,
    ),
    readerTimeIdx: index('mytrion_announcement_reads_reader_time_idx').on(
      table.tenantId,
      table.readerUserId,
      table.readAt,
    ),
  }),
);

/** One unique view per worker and announcement; opening does not imply acknowledgement. */
export const mytrionAnnouncementViews = pgTable(
  'mytrion_announcement_views',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mav_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    announcementId: text('announcement_id')
      .notNull()
      .references(() => mytrionAnnouncements.id, { onDelete: 'cascade' }),
    viewerUserId: text('viewer_user_id').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    announcementViewerUk: uniqueIndex('mytrion_announcement_views_announcement_viewer_uk').on(
      table.tenantId,
      table.announcementId,
      table.viewerUserId,
    ),
  }),
);

export type MytrionAnnouncement = typeof mytrionAnnouncements.$inferSelect;
export type NewMytrionAnnouncement = typeof mytrionAnnouncements.$inferInsert;
