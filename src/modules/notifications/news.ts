/**
 * client_news — announcements Octane writes for mini-app clients. Authoring is admin-RBAC'd
 * (clientNews.routes); reading is ALWAYS through the caller's own verified registration
 * (listNewsForRegistration) — audience and role filters run server-side, so a post aimed at
 * one carrier can never leak to another and a driver never sees owner-only news.
 */
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  clientNews,
  clientNewsReads,
  type ClientNewsPost,
  type ClientNewsRole,
  type LocalizedText,
  type RegisteredMiniAppCompany,
} from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { notifyMiniApp } from './service.js';

export interface NewsFeedItem {
  id: string;
  title: LocalizedText;
  body: LocalizedText;
  severity: 'info' | 'important';
  pinned: boolean;
  publishAt: string;
  read: boolean;
}

const FEED_LIMIT = 30;

/** The caller's news feed: published, unexpired, audience- and role-matched, pinned first. */
export async function listNewsForRegistration(reg: RegisteredMiniAppCompany): Promise<NewsFeedItem[]> {
  const role: ClientNewsRole = reg.profile === 'driver' ? 'driver' : 'owner';
  const now = new Date();
  const rows = await db
    .select()
    .from(clientNews)
    .where(and(eq(clientNews.tenantId, reg.tenantId), lte(clientNews.publishAt, now)))
    .orderBy(desc(clientNews.pinned), desc(clientNews.publishAt))
    .limit(200);
  const visible = rows
    .filter((p) => p.expiresAt == null || p.expiresAt > now)
    .filter((p) => (p.audienceScope === 'all' ? true : reg.carrierId != null && p.carrierIds.includes(reg.carrierId)))
    .filter((p) => p.roles.includes(role))
    .slice(0, FEED_LIMIT);
  if (visible.length === 0) return [];
  const reads = await db
    .select({ newsId: clientNewsReads.newsId })
    .from(clientNewsReads)
    .where(
      and(
        eq(clientNewsReads.telegramUserId, reg.telegramUserId),
        inArray(clientNewsReads.newsId, visible.map((p) => p.id)),
      ),
    );
  const readIds = new Set(reads.map((r) => r.newsId));
  return visible.map((p) => ({
    id: p.id,
    title: p.title,
    body: p.body,
    severity: p.severity,
    pinned: p.pinned,
    publishAt: p.publishAt.toISOString(),
    read: readIds.has(p.id),
  }));
}

/** Idempotent read receipt (unique on news+user). No ownership risk: it only marks, never reads. */
export async function markNewsRead(reg: RegisteredMiniAppCompany, newsId: string): Promise<void> {
  await db
    .insert(clientNewsReads)
    .values({ newsId, telegramUserId: reg.telegramUserId })
    .onConflictDoNothing({ target: [clientNewsReads.newsId, clientNewsReads.telegramUserId] });
}

/**
 * Post-publish fan-out for `severity='important'`: a bot push (type 'news') per targeted
 * carrier, through the notification outbox. Scope 'all' stays inbox-only ON PURPOSE — a
 * bot blast to every registered client is a deliberate future decision (digest/batching),
 * not a default side effect of writing a news row.
 */
export function pushImportantNews(post: ClientNewsPost): void {
  if (post.severity !== 'important' || post.audienceScope !== 'carriers') return;
  for (const carrierId of post.carrierIds) {
    void notifyMiniApp({
      type: 'news',
      tenantId: post.tenantId,
      carrierId,
      dedupeKey: `news:${post.id}:${carrierId}`,
      // Full per-locale maps, not just .en: one outbox row, each recipient's bot copy (and inbox
      // row) renders in their own language — the template/FE pick the locale out of the map.
      payload: { title: post.title, body: post.body },
    }).catch((err) => logger.warn({ err, newsId: post.id }, 'important news push failed'));
  }
}
