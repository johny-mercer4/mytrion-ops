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
import { useLoad, loadInbox, loadTickets } from './live';
import { useServerCrmSocket } from './useServerCrmSocket';
import { useInboxRead, countUnread } from './inboxRead';
import { publishInboxLive, subscribeInboxReload } from './inboxLiveBus';
import { setTicketDirectory } from './ticketDirectory';
import { useTicketUnread, totalTicketUnread, bumpTicketUnread, clearTicketUnread } from './ticketUnread';
import { getOpenTicketId, publishTicketLive } from './ticketLiveBus';

/** Trimmed string equality — a stray space/newline in either id shouldn't sink the comparison. */
function idsMatch(a: string, b: string): boolean {
  return !!a && !!b && a.trim() === b.trim();
}

export function useSidebarBadges(
  currentUserId: string,
  pushToast?: (title: string, msg: string) => void,
): { inbox: number; tickets: number } {
  const readSet = useInboxRead();
  const ticketCounts = useTicketUnread();
  const inboxLoad = useLoad(loadInbox, [currentUserId]);
  const ticketLoad = useLoad(loadTickets, [currentUserId]);

  const tickets = ticketLoad.data?.tickets ?? [];
  const ticketIds = tickets.map((t) => String(t.id));
  const idsKey = ticketIds.join(',');

  // Latest identity / toast / ticket set for the socket callback (avoid stale closures).
  const userIdRef = useRef(currentUserId);
  userIdRef.current = currentUserId;
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;
  const ticketIdsRef = useRef(ticketIds);
  ticketIdsRef.current = ticketIds;
  const inboxReloadRef = useRef(inboxLoad.reload);
  inboxReloadRef.current = inboxLoad.reload;

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
    onMessage: (m) => {
      if (m.type === 'crm_inbox_notification') {
        const eventOwner = String(m.ownerId ?? '').trim();
        const self = userIdRef.current.trim();
        if (idsMatch(eventOwner, self)) {
          inboxReloadRef.current();
          const subject = String(m.subject ?? m.name ?? 'New notification').trim() || 'New notification';
          // Fixed title so subject text like "Error…" never flips the toast to an error tone.
          pushToastRef.current?.('New inbox message', subject);
          publishInboxLive({ ownerId: eventOwner, subject });
        } else if (m.ownerId !== undefined) {
          console.debug('[inbox] crm_inbox_notification owner mismatch', {
            eventOwnerId: m.ownerId,
            currentUserId: self,
          });
        }
        return;
      }

      if (m.type !== 'ticket_comment_added' && m.type !== 'ticket_attachment_added') return;

      const tid = String(m.ticketId ?? '').trim();
      const ids = ticketIdsRef.current;
      if (!tid || !ids.includes(tid)) return;

      // Always notify the Tickets tab (reload thread / move to top).
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

  // Manual refresh from InboxTab → keep the sidebar unread badge in sync with the new list.
  useEffect(() => subscribeInboxReload(() => inboxLoad.reload()), [inboxLoad.reload]);

  return {
    inbox: countUnread(inboxLoad.data ?? [], readSet),
    tickets: totalTicketUnread(ticketCounts),
  };
}
