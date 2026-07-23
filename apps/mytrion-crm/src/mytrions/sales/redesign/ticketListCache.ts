/**
 * Client-side cache keys for Sales Desk tickets (stale-while-revalidate via dcCache).
 * - feed: progressive Tickets tab pages (instant re-entry)
 * - all: full creator-scoped set for sidebar WS subscribe / badge
 */
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { readDcCache, writeDcCache } from './dcCache';
import type { TicketVM } from './live';

export const TICKETS_FEED_PAGE = 20;
/** First-page / tab re-entry freshness. */
export const TICKETS_FEED_STALE_MS = 60_000;
/** Full sidebar page-through — Desk is slow; keep longer. */
export const TICKETS_ALL_STALE_MS = 120_000;

export interface TicketsFeedCache {
  tickets: TicketVM[];
  scoped: boolean;
  hasMore: boolean;
  nextFrom: number;
}

export function ticketsActorKey(userId?: string): string {
  return (
    userId?.trim() ||
    getImpersonation()?.zohoUserId?.trim() ||
    getSession()?.worker.zohoUserId?.trim() ||
    'self'
  );
}

export function ticketsFeedCacheKey(userId?: string): string {
  return `sales:tickets:feed:${ticketsActorKey(userId)}`;
}

/** Shell first-page warm (WS ids) — separate from the progressive feed snapshot. */
export function ticketsWarmCacheKey(userId?: string): string {
  return `sales:tickets:warm:${ticketsActorKey(userId)}`;
}

/** @deprecated Full Desk dump removed; kept for invalidate prefix compatibility. */
export function ticketsAllCacheKey(userId?: string): string {
  return `sales:tickets:all:${ticketsActorKey(userId)}`;
}

/**
 * After the shell finishes paging Desk for WS subscribe, seed the Tickets tab's first page
 * so opening the tab paints instantly without another Desk round-trip.
 * Never clobber a feed the tab already built (load-more / fresher write).
 */
export function seedTicketsFeedCache(
  tickets: TicketVM[],
  scoped: boolean,
  userId?: string,
): void {
  const key = ticketsFeedCacheKey(userId);
  const existing = readDcCache<TicketsFeedCache>(key);
  if (existing && existing.data.tickets.length >= TICKETS_FEED_PAGE) return;
  const page = tickets.slice(0, TICKETS_FEED_PAGE);
  if (page.length === 0) return;
  writeDcCache<TicketsFeedCache>(key, {
    tickets: page,
    scoped,
    hasMore: tickets.length > page.length,
    nextFrom: page.length,
  });
}
