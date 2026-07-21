/**
 * Shell-level inbox live fan-out.
 *
 * `useSidebarBadges` (Shell) owns the ServerCRM WebSocket for the whole Sales app and:
 *   1. toasts on `crm_inbox_notification` (any tab open)
 *   2. reloads the sidebar unread count
 *   3. publishes here so mounted tabs (Inbox / Home preview) refetch without depending
 *      on a tab-scoped socket for data freshness.
 *
 * Manual Inbox refresh still uses `publishInboxReload` so the shell badge stays in sync.
 */

export interface InboxLiveNotification {
  ownerId: string;
  subject: string;
}

type ReloadHandler = () => void;
type NotifyHandler = (n: InboxLiveNotification) => void;

const reloadHandlers = new Set<ReloadHandler>();
const notifyHandlers = new Set<NotifyHandler>();

/** Badge sync after a user-initiated Inbox refresh. */
export function subscribeInboxReload(handler: ReloadHandler): () => void {
  reloadHandlers.add(handler);
  return () => {
    reloadHandlers.delete(handler);
  };
}

export function publishInboxReload(): void {
  reloadHandlers.forEach((h) => h());
}

/** Home preview / Inbox list: owner-matched live notification from the shell socket. */
export function subscribeInboxLive(handler: NotifyHandler): () => void {
  notifyHandlers.add(handler);
  return () => {
    notifyHandlers.delete(handler);
  };
}

/** Called from shell badges after an owner-matched `crm_inbox_notification`. */
export function publishInboxLive(n: InboxLiveNotification): void {
  notifyHandlers.forEach((h) => h(n));
}
