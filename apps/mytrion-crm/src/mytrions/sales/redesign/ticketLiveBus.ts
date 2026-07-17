/**
 * Bridge between the shell-level servercrm socket (sidebarBadges) and the Tickets tab.
 * Shell owns subscribe + toast + unread; the open tab listens here to reload the thread
 * when a comment/attachment lands on the ticket currently on screen.
 */

let openTicketId = '';

export function setOpenTicketId(id: string): void {
  openTicketId = id;
}

export function getOpenTicketId(): string {
  return openTicketId;
}

export type TicketLiveEvent = {
  ticketId: string;
  type: 'ticket_comment_added' | 'ticket_attachment_added';
};

type Handler = (e: TicketLiveEvent) => void;
const handlers = new Set<Handler>();

export function subscribeTicketLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function publishTicketLive(event: TicketLiveEvent): void {
  handlers.forEach((h) => h(event));
}
