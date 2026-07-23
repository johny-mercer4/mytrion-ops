/**
 * Live sidebar badge counts — one shell-level servercrm socket feeding BOTH nav badges so they
 * update in real time from anywhere in the app and reflect UNREAD (not total):
 *   - Inbox   = messages not yet read (marking read in the tab decrements it immediately).
 *   - Tickets = unread ticket messages (a `ticket_comment_added` bumps it; opening a ticket clears).
 *
 * Ticket WS scope matches zoho-octane ticketdashboard.html: subscribe with the creator's currently
 * known ticket ids (first Desk page of 20, then whatever the Tickets tab pages in). We do NOT dump
 * the full Desk queue on shell mount — that starved the Tickets tab and felt like a hang.
 */
import { useEffect, useRef, useState } from 'react';
import { useCachedLoad } from './dcCache';
import { useLoad, loadInbox, loadTicketsPage, type TicketVM } from './live';
import { TICKETS_ENABLED } from './salesData';
import { useServerCrmSocket } from './useServerCrmSocket';
import { useInboxRead, countUnread } from './inboxRead';
import { subscribeInboxReload } from './inboxLiveBus';
import { setTicketDirectory } from './ticketDirectory';
import {
  seedTicketsFeedCache,
  ticketsWarmCacheKey,
  TICKETS_FEED_PAGE,
  TICKETS_FEED_STALE_MS,
} from './ticketListCache';
import {
  findSubscribedTicket,
  getTicketSubscribeIds,
  setTicketSubscribeActor,
  subscribeTicketIds,
  upsertTicketSubscribeRows,
} from './ticketSubscribeRegistry';
import { useTicketUnread, totalTicketUnread, bumpTicketUnread, clearTicketUnread } from './ticketUnread';
import { getOpenTicketId, publishTicketLive } from './ticketLiveBus';
import { setSocketConnected } from './socketStatus';

async function warmFirstTicketPage(): Promise<{ tickets: TicketVM[]; scoped: boolean }> {
  const res = await loadTicketsPage({ from: 0, limit: TICKETS_FEED_PAGE });
  upsertTicketSubscribeRows(res.tickets);
  setTicketDirectory(res.tickets);
  seedTicketsFeedCache(res.tickets, res.scoped);
  return { tickets: res.tickets, scoped: res.scoped };
}

export function useSidebarBadges(
  currentUserId: string,
  pushToast?: (title: string, msg: string) => void,
): { inbox: number; tickets: number } {
  const readSet = useInboxRead();
  const ticketCounts = useTicketUnread();
  const inboxLoad = useLoad(loadInbox, [currentUserId]);

  // First page only — same as ticketdashboard.html open. Seeds feed cache + WS ids.
  const ticketWarm = useCachedLoad(
    ticketsWarmCacheKey(currentUserId),
    () => (TICKETS_ENABLED ? warmFirstTicketPage() : Promise.resolve({ tickets: [] as TicketVM[], scoped: true })),
    {
      enabled: TICKETS_ENABLED && !!currentUserId,
      staleMs: TICKETS_FEED_STALE_MS,
    },
  );

  // Progressive ids from shell warm + Tickets tab load-more (registry).
  const [ticketIds, setTicketIds] = useState<string[]>(() => getTicketSubscribeIds());
  const idsKey = ticketIds.join(',');

  useEffect(() => {
    setTicketSubscribeActor(currentUserId || 'self');
  }, [currentUserId]);

  useEffect(() => {
    if (ticketWarm.data?.tickets?.length) {
      upsertTicketSubscribeRows(ticketWarm.data.tickets);
      setTicketDirectory(ticketWarm.data.tickets);
      seedTicketsFeedCache(
        ticketWarm.data.tickets,
        ticketWarm.data.scoped ?? true,
        currentUserId,
      );
    }
  }, [ticketWarm.data, currentUserId]);

  useEffect(() => subscribeTicketIds(() => setTicketIds(getTicketSubscribeIds())), []);

  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  const ticketIdsRef = useRef(ticketIds);
  ticketIdsRef.current = ticketIds;
  const ticketReloadRef = useRef(ticketWarm.reload);
  ticketReloadRef.current = ticketWarm.reload;

  const { resubscribe } = useServerCrmSocket({
    enabled: !!currentUserId,
    watchKey: currentUserId,
    // Same frame as zoho-octane ticketdashboard.html — userId + known ticket ids.
    subscribe: { type: 'subscribe', userId: currentUserId, ticketIds },
    onOpen: () => setSocketConnected(true),
    onClose: () => setSocketConnected(false),
    onMessage: (m) => {
      if (m.type !== 'ticket_comment_added' && m.type !== 'ticket_attachment_added') return;

      const tid = String(m.ticketId ?? '').trim();
      // Client-side scope filter (servercrm broadcasts org-wide).
      const ids = ticketIdsRef.current;
      if (!tid || !ids.includes(tid)) return;
      publishTicketLive({ ticketId: tid, type: m.type });

      if (tid === getOpenTicketId()) {
        clearTicketUnread(tid);
        return;
      }

      bumpTicketUnread(tid);
      const t = findSubscribedTicket(tid);
      const label = m.type === 'ticket_attachment_added' ? 'New attachment' : 'New comment';
      const detail = t ? `#${t.num} · ${t.subject}` : `Ticket #${tid}`;
      pushToastRef.current?.(label, detail);
    },
  });

  useEffect(() => {
    resubscribe();
    // eslint-disable-next-line
  }, [idsKey]);

  // Visibility soft-refresh of the FIRST page only (reference never re-dumps the full set).
  useEffect(() => {
    if (!TICKETS_ENABLED || !currentUserId) return undefined;
    let last = Date.now();
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < 120_000) return;
      last = now;
      ticketReloadRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [currentUserId]);

  useEffect(() => subscribeInboxReload(() => inboxLoad.reload()), [inboxLoad.reload]);

  return {
    inbox: countUnread(inboxLoad.data ?? [], readSet),
    tickets: totalTicketUnread(ticketCounts),
  };
}
