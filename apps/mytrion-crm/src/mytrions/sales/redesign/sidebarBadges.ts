/**
 * Live sidebar badge counts — one shell-level servercrm socket feeding BOTH nav badges so they
 * update in real time from anywhere in the app and reflect UNREAD (not total):
 *   - Inbox   = messages not yet read (marking read in the tab decrements it immediately).
 *   - Tickets = unread ticket messages (a `ticket_comment_added` bumps it; opening a ticket clears).
 *
 * Also owns the toasts (inbox + ticket comment/attachment) so they fire on every tab — matching
 * ticketdashboard.html. The Tickets tab listens on `ticketLiveBus` to refresh the open thread.
 */
import { useEffect } from 'react';
import { useLoad, loadInbox, loadTickets } from './live';
import { useServerCrmSocket } from './useServerCrmSocket';
import { useInboxRead, countUnread } from './inboxRead';
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

  // Keep a lookup the Tickets tab can use to pin older tickets that aren't paged in yet.
  useEffect(() => {
    setTicketDirectory(tickets);
    // idsKey tracks ticket set changes without depending on the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const { resubscribe } = useServerCrmSocket({
    enabled: !!currentUserId,
    // Same frame as zoho-octane ticketdashboard.html — userId + the caller's ticket ids.
    subscribe: { type: 'subscribe', userId: currentUserId, ticketIds },
    onMessage: (m) => {
      if (m.type === 'crm_inbox_notification') {
        if (idsMatch(String(m.ownerId ?? ''), currentUserId)) {
          inboxLoad.reload();
          pushToast?.('New message', String(m.subject ?? m.name ?? 'New notification'));
        } else if (m.ownerId !== undefined) {
          console.debug('[inbox] crm_inbox_notification owner mismatch', {
            eventOwnerId: m.ownerId,
            currentUserId,
          });
        }
        return;
      }

      if (m.type !== 'ticket_comment_added' && m.type !== 'ticket_attachment_added') return;

      const tid = String(m.ticketId ?? '').trim();
      if (!tid || !ticketIds.includes(tid)) return;

      // Always notify the Tickets tab (reload thread / move to top).
      publishTicketLive({ ticketId: tid, type: m.type });

      // Viewing this ticket → stay read, no toast (reference handleNewComment).
      if (tid === getOpenTicketId()) {
        clearTicketUnread(tid);
        return;
      }

      bumpTicketUnread(tid);
      const t = tickets.find((x) => x.id === tid);
      const label = m.type === 'ticket_attachment_added' ? 'New attachment' : 'New comment';
      const detail = t ? `#${t.num} · ${t.subject}` : `Ticket #${tid}`;
      pushToast?.(label, detail);
    },
  });

  useEffect(() => {
    resubscribe();
    // eslint-disable-next-line
  }, [idsKey]);

  return {
    inbox: countUnread(inboxLoad.data ?? [], readSet),
    tickets: totalTicketUnread(ticketCounts),
  };
}
