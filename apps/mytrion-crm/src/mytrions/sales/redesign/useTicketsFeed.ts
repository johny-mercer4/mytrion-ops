/**
 * Progressive creator-scoped ticket list — mirrors zoho-octane ticketdashboard.html:
 *   from=0, limit=20; Load more / scroll → from += 20 until a short or empty page.
 *
 * Stale-while-revalidate via dcCache: re-entering Tickets paints instantly (no boot
 * skeleton) while Desk reconciles in the background. The shell's full `loadTickets`
 * also seeds this cache so the first open after Home is often already warm.
 *
 * When Desk.search.READ is missing the server still returns pages of 20 via a deep /tickets
 * creator scan (scoped:false). Do not treat windowed as “all loaded”.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { readDcCache, subscribeDcCache, writeDcCache } from './dcCache';
import { getCachedTicket, upsertCachedTicket } from './ticketDirectory';
import {
  TICKETS_FEED_PAGE,
  TICKETS_FEED_STALE_MS,
  ticketsFeedCacheKey,
  type TicketsFeedCache,
} from './ticketListCache';
import { upsertTicketSubscribeRows } from './ticketSubscribeRegistry';
import { loadTicketById, loadTicketsPage, type TicketVM } from './live';

const PAGE = TICKETS_FEED_PAGE;
const MAX_PINNED = 30;

export interface TicketsFeed {
  tickets: TicketVM[];
  scoped: boolean;
  loading: boolean;
  /** Background refresh while cached rows are already visible. */
  revalidating: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  reload: () => void;
  softReload: () => void;
  promoteTicket: (ticketId: string) => void;
  loadMore: () => void;
}

function mergeWithPins(fresh: TicketVM[], prev: TicketVM[], pinnedIds: string[]): TicketVM[] {
  const byId = new Map<string, TicketVM>();
  for (const t of prev) {
    if (t.id) byId.set(t.id, t);
  }
  for (const t of fresh) {
    if (t.id) byId.set(t.id, t);
  }
  const pinnedSet = new Set(pinnedIds);
  const pinned = pinnedIds.map((id) => byId.get(id)).filter((t): t is TicketVM => !!t);
  const head = fresh.filter((t) => t.id && !pinnedSet.has(t.id));
  const headIds = new Set(head.map((t) => t.id));
  const rest = prev.filter((t) => t.id && !pinnedSet.has(t.id) && !headIds.has(t.id));
  return [...pinned, ...head, ...rest];
}

function appendUnique(prev: TicketVM[], incoming: TicketVM[]): TicketVM[] {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((t) => t.id));
  const added = incoming.filter((t) => t.id && !seen.has(t.id));
  return added.length ? [...prev, ...added] : prev;
}

function persistFeed(
  key: string,
  state: {
    tickets: TicketVM[];
    scoped: boolean;
    hasMore: boolean;
    nextFrom: number;
  },
): void {
  upsertTicketSubscribeRows(state.tickets);
  writeDcCache<TicketsFeedCache>(key, state);
}

function adoptFeedCache(hit: { data: TicketsFeedCache }): {
  tickets: TicketVM[];
  scoped: boolean;
  hasMore: boolean;
  nextFrom: number;
} {
  const tickets = hit.data.tickets ?? [];
  return {
    tickets,
    scoped: hit.data.scoped ?? true,
    hasMore: hit.data.hasMore ?? tickets.length >= PAGE,
    nextFrom: hit.data.nextFrom ?? tickets.length,
  };
}

export function useTicketsFeed(): TicketsFeed {
  const cacheKey = ticketsFeedCacheKey();
  const initial = readDcCache<TicketsFeedCache>(cacheKey);

  const [tickets, setTickets] = useState<TicketVM[]>(initial?.data.tickets ?? []);
  const [scoped, setScoped] = useState(initial?.data.scoped ?? true);
  const [loading, setLoading] = useState(() => !initial);
  const [revalidating, setRevalidating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initial?.data.hasMore ?? true);
  const [tick, setTick] = useState(0);

  const nextFromRef = useRef(initial?.data.nextFrom ?? 0);
  const fetchingRef = useRef(false);
  const hasMoreRef = useRef(initial?.data.hasMore ?? true);
  const scopedRef = useRef(initial?.data.scoped ?? true);
  const ticketsRef = useRef<TicketVM[]>(initial?.data.tickets ?? []);
  const pinnedRef = useRef<string[]>([]);
  const promoteFetchRef = useRef<Set<string>>(new Set());
  const forceRef = useRef(false);
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  ticketsRef.current = tickets;
  hasMoreRef.current = hasMore;
  scopedRef.current = scoped;

  const reload = useCallback(() => {
    forceRef.current = true;
    setTick((t) => t + 1);
  }, []);

  const pinId = (id: string): void => {
    pinnedRef.current = [id, ...pinnedRef.current.filter((x) => x !== id)].slice(0, MAX_PINNED);
  };

  const putOnTop = useCallback((row: TicketVM): void => {
    if (!row.id) return;
    upsertCachedTicket(row);
    setTickets((prev) => {
      const next = [row, ...prev.filter((t) => t.id !== row.id)];
      persistFeed(cacheKeyRef.current, {
        tickets: next,
        scoped: scopedRef.current,
        hasMore: hasMoreRef.current,
        nextFrom: nextFromRef.current,
      });
      return next;
    });
  }, []);

  const promoteTicket = useCallback(
    (ticketId: string) => {
      const id = ticketId.trim();
      if (!id) return;
      pinId(id);

      const existing = ticketsRef.current.find((t) => t.id === id);
      if (existing) {
        setTickets((prev) => {
          const i = prev.findIndex((t) => t.id === id);
          if (i <= 0) return prev;
          const row = prev[i];
          if (!row) return prev;
          const next = [row, ...prev.slice(0, i), ...prev.slice(i + 1)];
          persistFeed(cacheKeyRef.current, {
            tickets: next,
            scoped: scopedRef.current,
            hasMore: hasMoreRef.current,
            nextFrom: nextFromRef.current,
          });
          return next;
        });
        return;
      }

      const cached = getCachedTicket(id);
      if (cached) putOnTop(cached);

      if (promoteFetchRef.current.has(id)) return;
      promoteFetchRef.current.add(id);
      void loadTicketById(id)
        .then((row) => putOnTop(row))
        .catch(() => {
          /* directory pin (if any) still stands */
        })
        .finally(() => {
          promoteFetchRef.current.delete(id);
        });
    },
    [putOnTop],
  );

  const softReload = useCallback(() => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setRevalidating(true);
    void loadTicketsPage({ from: 0, limit: PAGE })
      .then((res) => {
        setScoped(res.scoped);
        scopedRef.current = res.scoped;
        setTickets((prev) => {
          const next = mergeWithPins(res.tickets, prev, pinnedRef.current);
          if (nextFromRef.current < res.nextFrom) nextFromRef.current = res.nextFrom;
          persistFeed(cacheKeyRef.current, {
            tickets: next,
            scoped: res.scoped,
            hasMore: hasMoreRef.current,
            nextFrom: nextFromRef.current,
          });
          return next;
        });
      })
      .catch(() => {
        /* quiet */
      })
      .finally(() => {
        fetchingRef.current = false;
        setRevalidating(false);
      });
  }, []);

  useEffect(() => {
    let off = false;
    const key = cacheKey;
    const hit = readDcCache<TicketsFeedCache>(key);
    const force = forceRef.current;
    forceRef.current = false;

    if (hit?.data.tickets?.length) {
      const adopted = adoptFeedCache(hit);
      setTickets(adopted.tickets);
      setScoped(adopted.scoped);
      scopedRef.current = adopted.scoped;
      nextFromRef.current = adopted.nextFrom;
      setHasMore(adopted.hasMore);
      hasMoreRef.current = adopted.hasMore;
      upsertTicketSubscribeRows(adopted.tickets);
      setLoading(false);
    }

    // Never treat an empty snapshot as fresh — that stuck the boot spinner forever.
    const fresh =
      hit != null &&
      (hit.data.tickets?.length ?? 0) > 0 &&
      Date.now() - hit.ts < TICKETS_FEED_STALE_MS;
    if (fresh && !force) {
      return () => {
        off = true;
      };
    }

    fetchingRef.current = true;
    if (hit) setRevalidating(true);
    else {
      setLoading(true);
      nextFromRef.current = 0;
      hasMoreRef.current = true;
      pinnedRef.current = [];
      setHasMore(true);
    }
    setError(null);

    void loadTicketsPage({ from: 0, limit: PAGE, fresh: force })
      .then((res) => {
        if (off) return;
        setScoped(res.scoped);
        scopedRef.current = res.scoped;
        setTickets((prev) => {
          const next =
            hit && pinnedRef.current.length
              ? mergeWithPins(res.tickets, prev, pinnedRef.current)
              : res.tickets;
          nextFromRef.current = res.nextFrom;
          setHasMore(res.hasMore);
          hasMoreRef.current = res.hasMore;
          persistFeed(key, {
            tickets: next,
            scoped: res.scoped,
            hasMore: res.hasMore,
            nextFrom: res.nextFrom,
          });
          return next;
        });
      })
      .catch((e: unknown) => {
        if (off) return;
        setError(e instanceof Error ? e.message : 'Failed to load tickets');
        if (!hit) {
          setTickets([]);
          setHasMore(false);
          hasMoreRef.current = false;
        }
      })
      .finally(() => {
        if (!off) {
          setLoading(false);
          setRevalidating(false);
          fetchingRef.current = false;
        }
      });
    return () => {
      off = true;
      fetchingRef.current = false;
    };
  }, [tick, cacheKey]);

  useEffect(
    () =>
      subscribeDcCache(cacheKey, (kind) => {
        if (kind === 'invalidate') {
          forceRef.current = true;
          setTick((t) => t + 1);
          return;
        }
        const hit = readDcCache<TicketsFeedCache>(cacheKey);
        if (!hit?.data.tickets?.length) return;
        const adopted = adoptFeedCache(hit);
        setTickets(adopted.tickets);
        setScoped(adopted.scoped);
        scopedRef.current = adopted.scoped;
        nextFromRef.current = adopted.nextFrom;
        setHasMore(adopted.hasMore);
        hasMoreRef.current = adopted.hasMore;
        upsertTicketSubscribeRows(adopted.tickets);
        setLoading(false);
      }),
    [cacheKey],
  );

  const loadMore = useCallback(() => {
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    setError(null);
    const from = nextFromRef.current;
    void loadTicketsPage({ from, limit: PAGE })
      .then((res) => {
        setScoped(res.scoped);
        scopedRef.current = res.scoped;
        if (res.tickets.length === 0) {
          setHasMore(false);
          hasMoreRef.current = false;
          persistFeed(cacheKeyRef.current, {
            tickets: ticketsRef.current,
            scoped: res.scoped,
            hasMore: false,
            nextFrom: nextFromRef.current,
          });
          return;
        }
        setTickets((prev) => {
          const next = appendUnique(prev, res.tickets);
          nextFromRef.current = res.nextFrom;
          setHasMore(res.hasMore);
          hasMoreRef.current = res.hasMore;
          persistFeed(cacheKeyRef.current, {
            tickets: next,
            scoped: res.scoped,
            hasMore: res.hasMore,
            nextFrom: res.nextFrom,
          });
          return next;
        });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load more tickets');
      })
      .finally(() => {
        setLoadingMore(false);
        fetchingRef.current = false;
      });
  }, []);

  return {
    tickets,
    scoped,
    loading,
    revalidating,
    loadingMore,
    error,
    hasMore,
    reload,
    softReload,
    promoteTicket,
    loadMore,
  };
}
