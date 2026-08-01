/**
 * Live sidebar badge counts.
 *   - Inbox   = messages not yet read (servercrm socket; unchanged).
 *   - Tickets = unread comms messages, from `GET /comms/unread`.
 *
 * THE TICKETS BADGE IS NATIVE. Tickets moved to /v1/comms, so counting the Zoho Desk queue here would
 * put a number in the sidebar that does not match the list the tab shows — the classic badge-lies bug.
 * The whole Desk warm/subscribe machinery below is therefore gated OFF (`DESK_TICKET_BADGE = false`)
 * rather than deleted: it still drives the servercrm ticket socket, which is retired with the Desk read
 * endpoints, not before.
 *
 * The native count is a poll, not a push: the console's own socket already updates the list instantly
 * while the tab is open, and a sidebar number that is a few seconds stale is not worth a second socket.
 */
import { useEffect, useRef, useState } from 'react';
import { useCachedLoad } from './dcCache';
import { useLoad, loadInbox, loadTicketsPage, type TicketVM } from './live';
import { getUnreadTotals } from '@/api/comms';
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
import { useTicketUnread, bumpTicketUnread, clearTicketUnread } from './ticketUnread';
import { getOpenTicketId, publishTicketLive } from './ticketLiveBus';
import { setSocketConnected } from './socketStatus';

async function warmFirstTicketPage(): Promise<{ tickets: TicketVM[]; scoped: boolean }> {
  const res = await loadTicketsPage({ from: 0, limit: TICKETS_FEED_PAGE });
  upsertTicketSubscribeRows(res.tickets);
  setTicketDirectory(res.tickets);
  seedTicketsFeedCache(res.tickets, res.scoped);
  return { tickets: res.tickets, scoped: res.scoped };
}

/**
 * Kept false deliberately. `TICKETS_ENABLED` is now TRUE (the tab is live on the native path), so reading
 * it here would newly switch ON the Desk page-warm this hook used to skip.
 */
const DESK_TICKET_BADGE = false;

export function useSidebarBadges(
  currentUserId: string,
  pushToast?: (title: string, msg: string) => void,
): { inbox: number; tickets: number } {
  const readSet = useInboxRead();
  // Subscribed so the retired Desk counter still settles for the rollback path; not read for the badge.
  useTicketUnread();
  const inboxLoad = useLoad(loadInbox, [currentUserId]);
  // The native unread total. Refreshed on tab focus and on a slow interval — the console handles instant
  // updates while it is open, so this only has to be right when the user is looking elsewhere.
  const commsUnread = useLoad(
    async () => (currentUserId ? (await getUnreadTotals()).total : 0),
    [currentUserId],
  );

  useEffect(() => {
    if (!currentUserId) return undefined;
    const tick = (): void => {
      if (document.visibilityState === 'visible') commsUnread.reload();
    };
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // First page only — same as ticketdashboard.html open. Seeds feed cache + WS ids.
  const ticketWarm = useCachedLoad(
    ticketsWarmCacheKey(currentUserId),
    () => (DESK_TICKET_BADGE ? warmFirstTicketPage() : Promise.resolve({ tickets: [] as TicketVM[], scoped: true })),
    {
      enabled: DESK_TICKET_BADGE && !!currentUserId,
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
    if (!DESK_TICKET_BADGE || !currentUserId) return undefined;
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
    // Native. The Desk counter in ./ticketUnread is left wired for the rollback path but not read.
    tickets: commsUnread.data ?? 0,
  };
}
