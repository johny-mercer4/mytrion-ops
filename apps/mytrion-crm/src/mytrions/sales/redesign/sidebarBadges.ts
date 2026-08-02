/**
 * Live sidebar badge counts.
 *   - Inbox   = messages not yet read (servercrm socket + servercrm inbox feed).
 *   - Tickets = unread comms messages, from `GET /comms/unread`.
 *   - Tasks   = `open` assignments never opened in the detail modal (local opened set).
 *
 * ZERO ZOHO DESK. Tickets moved to /v1/comms, so everything that used to live here — the Desk first-page
 * warm, the per-ticket servercrm subscribe registry, the localStorage unread counter, the ticket toast —
 * was DELETED rather than left switched off. Keeping it would have meant a second, divergent idea of what
 * "unread tickets" means, sitting one boolean away from being switched back on. That is also why this hook
 * no longer takes a `pushToast`: its only caller was the deleted Desk ticket toast.
 *
 * The ticket count is a POLL, not a push. The console's own socket updates the list instantly while the
 * Tickets tab is open, so the sidebar number only has to be right when the user is looking somewhere else —
 * not worth a second WebSocket for.
 *
 * The servercrm socket that remains is the INBOX one. It is unrelated to Desk and stays until the inbox
 * itself is migrated; its subscribe frame no longer carries ticket ids, so servercrm stops broadcasting
 * ticket comment events to this client at all.
 */
import { useEffect } from 'react';
import { listMyTasks } from '@/api/salesKpi';
import { getUnreadTotals } from '@/api/comms';
import { useCachedLoad } from './dcCache';
import { useLoad, loadInbox } from './live';
import { useInboxRead, countUnread } from './inboxRead';
import { subscribeInboxReload } from './inboxLiveBus';
import { countUnopenedTasks, useTaskOpened } from './taskOpened';
import { subscribeTasksReload, tasksBadgeCacheKey } from './tasksLiveBus';
import { setSocketConnected } from './socketStatus';
import { useServerCrmSocket } from './useServerCrmSocket';

/** How often the native unread total is refreshed while the user is on another tab. */
const UNREAD_POLL_MS = 60_000;

export function useSidebarBadges(
  currentUserId: string,
): { inbox: number; tickets: number; tasks: number } {
  const readSet = useInboxRead();
  const openedTasks = useTaskOpened();
  const inboxLoad = useLoad(loadInbox, [currentUserId]);
  const tasksLoad = useCachedLoad(tasksBadgeCacheKey(currentUserId), () => listMyTasks(), {
    enabled: !!currentUserId,
    staleMs: 60_000,
  });

  const commsUnread = useLoad(
    async () => (currentUserId ? (await getUnreadTotals()).total : 0),
    [currentUserId],
  );

  // Refresh on focus AND on a slow interval. Both: the interval keeps a long-lived tab roughly honest, and
  // the visibility hook makes the number correct the moment somebody actually looks at it.
  useEffect(() => {
    if (!currentUserId) return undefined;
    const tick = (): void => {
      if (document.visibilityState === 'visible') commsUnread.reload();
    };
    const id = setInterval(tick, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  useServerCrmSocket({
    enabled: !!currentUserId,
    watchKey: currentUserId,
    subscribe: { type: 'subscribe', userId: currentUserId },
    onOpen: () => setSocketConnected(true),
    onClose: () => setSocketConnected(false),
  });

  useEffect(() => subscribeInboxReload(() => inboxLoad.reload()), [inboxLoad.reload]);
  useEffect(() => subscribeTasksReload(() => tasksLoad.reload()), [tasksLoad.reload]);

  return {
    inbox: countUnread(inboxLoad.data ?? [], readSet),
    tickets: commsUnread.data ?? 0,
    tasks: countUnopenedTasks(tasksLoad.data ?? [], openedTasks),
  };
}
