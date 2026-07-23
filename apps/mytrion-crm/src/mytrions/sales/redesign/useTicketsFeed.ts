/**
 * Progressive creator-scoped ticket list — mirrors zoho-octane ticketdashboard.html:
 *   from=0, limit=20; Load more / scroll → from += 20 until a short or empty page.
 *
 * When Desk.search.READ is missing the server still returns pages of 20 via a deep /tickets
 * creator scan (scoped:false). Do not treat windowed as “all loaded”.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getCachedTicket, upsertCachedTicket } from './ticketDirectory';
import { loadTicketById, loadTicketsPage, type TicketVM } from './live';

const PAGE = 20;
const MAX_PINNED = 30;

export interface TicketsFeed {
  tickets: TicketVM[];
  scoped: boolean;
  loading: boolean;
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

export function useTicketsFeed(): TicketsFeed {
  const [tickets, setTickets] = useState<TicketVM[]>([]);
  const [scoped, setScoped] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [tick, setTick] = useState(0);

  const nextFromRef = useRef(0);
  const fetchingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const ticketsRef = useRef<TicketVM[]>([]);
  const pinnedRef = useRef<string[]>([]);
  const promoteFetchRef = useRef<Set<string>>(new Set());

  ticketsRef.current = tickets;
  hasMoreRef.current = hasMore;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const pinId = (id: string): void => {
    pinnedRef.current = [id, ...pinnedRef.current.filter((x) => x !== id)].slice(0, MAX_PINNED);
  };

  const putOnTop = useCallback((row: TicketVM): void => {
    if (!row.id) return;
    upsertCachedTicket(row);
    setTickets((prev) => [row, ...prev.filter((t) => t.id !== row.id)]);
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
          return [row, ...prev.slice(0, i), ...prev.slice(i + 1)];
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
    // Lock the shared in-flight flag so a 25s auto-refresh and a loadMore can't run concurrently and
    // reshuffle/duplicate the head mid-append (loadMore also gates on fetchingRef).
    fetchingRef.current = true;
    void loadTicketsPage({ from: 0, limit: PAGE })
      .then((res) => {
        setScoped(res.scoped);
        setTickets((prev) => mergeWithPins(res.tickets, prev, pinnedRef.current));
      })
      .catch(() => {
        /* quiet */
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  }, []);

  useEffect(() => {
    let off = false;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    nextFromRef.current = 0;
    hasMoreRef.current = true;
    pinnedRef.current = [];
    setHasMore(true);
    void loadTicketsPage({ from: 0, limit: PAGE })
      .then((res) => {
        if (off) return;
        setScoped(res.scoped);
        setTickets(res.tickets);
        nextFromRef.current = res.nextFrom;
        setHasMore(res.hasMore);
        hasMoreRef.current = res.hasMore;
      })
      .catch((e: unknown) => {
        if (off) return;
        setError(e instanceof Error ? e.message : 'Failed to load tickets');
        setTickets([]);
        setHasMore(false);
        hasMoreRef.current = false;
      })
      .finally(() => {
        if (!off) {
          setLoading(false);
          fetchingRef.current = false;
        }
      });
    return () => {
      off = true;
      fetchingRef.current = false;
    };
  }, [tick]);

  const loadMore = useCallback(() => {
    // Reference: if (!this.isFetchingMore && this.ticketPagination.hasMore)
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    setError(null);
    const from = nextFromRef.current;
    void loadTicketsPage({ from, limit: PAGE })
      .then((res) => {
        setScoped(res.scoped);
        if (res.tickets.length === 0) {
          setHasMore(false);
          hasMoreRef.current = false;
          return;
        }
        setTickets((prev) => appendUnique(prev, res.tickets));
        nextFromRef.current = res.nextFrom;
        setHasMore(res.hasMore);
        hasMoreRef.current = res.hasMore;
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
    loadingMore,
    error,
    hasMore,
    reload,
    softReload,
    promoteTicket,
    loadMore,
  };
}
