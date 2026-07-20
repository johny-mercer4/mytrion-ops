/**
 * Manual inbox refresh bridge — InboxTab publishes after a user-initiated reload so
 * shell-level `useSidebarBadges` reconciles the nav unread count with the fresh list.
 * (WebSocket pushes already reload both paths independently.)
 */

type Handler = () => void;
const handlers = new Set<Handler>();

export function subscribeInboxReload(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function publishInboxReload(): void {
  handlers.forEach((h) => h());
}
