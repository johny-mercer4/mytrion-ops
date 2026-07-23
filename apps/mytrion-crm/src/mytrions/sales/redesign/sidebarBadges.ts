/**
 * Live sidebar badge counts — one shell-level servercrm socket feeding BOTH nav badges so they
 * update in real time from anywhere in the app and reflect UNREAD (not total):
 *   - Inbox   = messages not yet read (marking read in the tab decrements it immediately).
 *   - Tickets = unread ticket messages (a `ticket_comment_added` bumps it; opening a ticket clears).
 *
 * Also owns the toasts (inbox + ticket comment/attachment) so they fire on every Sales tab —
 * matching ticketdashboard.html / self-service InboxPanel. Tabs listen on `inboxLiveBus` /
 * `ticketLiveBus` to refresh their own lists.
 */
import { useEffect, useRef } from 'react';
import { useLoad, loadInbox, loadTickets, type TicketVM } from './live';
import { TICKETS_ENABLED } from './salesData';
import { useServerCrmSocket } from './useServerCrmSocket';
import { useInboxRead, countUnread } from './inboxRead';
import { subscribeInboxReload } from './inboxLiveBus';
import { setTicketDirectory } from './ticketDirectory';
import { useTicketUnread, totalTicketUnread, bumpTicketUnread, clearTicketUnread } from './ticketUnread';
import { getOpenTicketId, publishTicketLive } from './ticketLiveBus';
import { setSocketConnected } from './socketStatus';

const NO_TICKETS: { tickets: TicketVM[]; scoped: boolean } = { tickets: [], scoped: true };

export function useSidebarBadges(
  currentUserId: string,
  pushToast?: (title: string, msg: string) => void,
): { inbox: number; tickets: number } {
  const readSet = useInboxRead();
  const ticketCounts = useTicketUnread();
  const inboxLoad = useLoad(loadInbox, [currentUserId]);
  // If Tickets is ever re-parked, skip paging the whole creator-scoped Desk set (up to ~20 requests)
  // for a hidden badge; the subscribe frame then simply carries no ticketIds (still valid).
  const ticketLoad = useLoad(
    () => (TICKETS_ENABLED ? loadTickets() : Promise.resolve(NO_TICKETS)),
    [currentUserId],
  );

  const tickets = ticketLoad.data?.tickets ?? [];
  const ticketIds = tickets.map((t) => String(t.id));
  const idsKey = ticketIds.join(',');

  // Latest toast / ticket set for the socket callback (avoid stale closures).
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;
  const ticketIdsRef = useRef(ticketIds);
  ticketIdsRef.current = ticketIds;
  const ticketReloadRef = useRef(ticketLoad.reload);
  ticketReloadRef.current = ticketLoad.reload;

  // Keep a lookup the Tickets tab can use to pin older tickets that aren't paged in yet.
  useEffect(() => {
    setTicketDirectory(tickets);
    // idsKey tracks ticket set changes without depending on the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const { resubscribe } = useServerCrmSocket({
    enabled: !!currentUserId,
    // Re-open when View-as / session user changes so subscribe.userId stays correct.
    watchKey: currentUserId,
    // Same frame as zoho-octane ticketdashboard.html — userId + the caller's ticket ids.
    subscribe: { type: 'subscribe', userId: currentUserId, ticketIds },
    onOpen: () => setSocketConnected(true),
    onClose: () => setSocketConnected(false),
    onMessage: (m) => {
      // Inbox notifications now ride our own /v1/realtime socket (see useRetentionRealtime →
      // inbox.* events); this servercrm socket is kept ONLY for ticket comment/attachment events.
      if (m.type !== 'ticket_comment_added' && m.type !== 'ticket_attachment_added') return;

      const tid = String(m.ticketId ?? '').trim();
      // servercrm broadcasts EVERY Desk ticket event to ALL clients (the subscribe frame's ticketIds
      // are only acked, never used to route), so the client MUST scope to its own ticket set — without
      // this filter the unread badge + toasts flood with org-wide activity and a phantom badge sticks
      // (a non-owned ticket never enters the list, so it's never cleared). New tickets enter this set
      // via the focus refresh below (re-pages loadTickets), so they still go live without a reload.
      const ids = ticketIdsRef.current;
      if (!tid || !ids.includes(tid)) return;
      publishTicketLive({ ticketId: tid, type: m.type });

      // Viewing this ticket → stay read, no toast (reference handleNewComment).
      if (tid === getOpenTicketId()) {
        clearTicketUnread(tid);
        return;
      }

      bumpTicketUnread(tid);
      const t = ticketsRef.current.find((x) => x.id === tid);
      const label = m.type === 'ticket_attachment_added' ? 'New attachment' : 'New comment';
      const detail = t ? `#${t.num} · ${t.subject}` : `Ticket #${tid}`;
      pushToastRef.current?.(label, detail);
    },
  });

  useEffect(() => {
    resubscribe();
    // eslint-disable-next-line
  }, [idsKey]);

  // New tickets: refresh the ticket set when the agent returns to the tab (throttled ≤1/2min), so a
  // ticket created after load enters the client-side scope filter (ticketIdsRef) and its live events
  // start surfacing — without a manual reload. Focus-only (no polling storm); most agents re-page in
  // one request. Beyond-reference: the reference only picks up new tickets on an explicit refresh.
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

  // Manual refresh from InboxTab → keep the sidebar unread badge in sync with the new list.
  useEffect(() => subscribeInboxReload(() => inboxLoad.reload()), [inboxLoad.reload]);

  return {
    inbox: countUnread(inboxLoad.data ?? [], readSet),
    tickets: totalTicketUnread(ticketCounts),
  };
}
