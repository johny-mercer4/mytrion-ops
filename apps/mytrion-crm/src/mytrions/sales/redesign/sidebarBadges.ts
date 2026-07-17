/**
 * Live sidebar badge counts — one shell-level servercrm socket feeding BOTH nav badges so they
 * update in real time from anywhere in the app and reflect UNREAD (not total):
 *   - Inbox   = messages not yet read (marking read in the tab decrements it immediately).
 *   - Tickets = unread ticket messages (a `ticket_comment_added` bumps it; opening a ticket clears).
 * The socket subscribes with the reference's ticket frame `{type:'subscribe', userId, ticketIds}`;
 * incoming events are matched to the caller (inbox by ownerId, tickets by ticketId ∈ theirs). This
 * hook is shell-level (mounted regardless of the active tab) — the inbox toast lives here, not in
 * InboxTab, specifically so it fires no matter which tab the user is looking at.
 */
import { useEffect } from 'react';
import { useLoad, loadInbox, loadTickets } from './live';
import { useServerCrmSocket } from './useServerCrmSocket';
import { useInboxRead, countUnread } from './inboxRead';
import { useTicketUnread, totalTicketUnread, bumpTicketUnread } from './ticketUnread';

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

  const ticketIds = (ticketLoad.data?.tickets ?? []).map((t) => String(t.id));
  const idsKey = ticketIds.join(',');

  const { resubscribe } = useServerCrmSocket({
    enabled: !!currentUserId,
    subscribe: { type: 'subscribe', userId: currentUserId, ticketIds },
    onMessage: (m) => {
      if (m.type === 'crm_inbox_notification') {
        // A new inbox message for this user → refetch so it appears as unread, and toast — this
        // frame arrives regardless of which tab is mounted, unlike InboxTab's own socket.
        if (idsMatch(String(m.ownerId ?? ''), currentUserId)) {
          inboxLoad.reload();
          pushToast?.('New message', String(m.subject ?? m.name ?? 'New notification'));
        } else if (m.ownerId !== undefined) {
          // Didn't match — surfaced so a live event that never toasts is debuggable from the
          // console instead of silently vanishing (compare against the id printed here).
          console.debug('[inbox] crm_inbox_notification owner mismatch', {
            eventOwnerId: m.ownerId,
            currentUserId,
          });
        }
      } else if (m.type === 'ticket_comment_added' || m.type === 'ticket_attachment_added') {
        const tid = String(m.ticketId ?? '');
        if (tid && ticketIds.includes(tid)) bumpTicketUnread(tid);
      }
    },
  });
  // Re-send the ticket subscribe frame whenever the caller's ticket-id set changes.
  useEffect(() => {
    resubscribe();
    // eslint-disable-next-line
  }, [idsKey]);

  return {
    inbox: countUnread(inboxLoad.data ?? [], readSet),
    tickets: totalTicketUnread(ticketCounts),
  };
}
