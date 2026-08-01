/**
 * Fan-out so the shell My Tasks badge stays in sync when the Tasks tab loads or mutates.
 * Shared SWR key with the Tasks tab (`writeDcCache` adopts; reload forces refetch).
 */

export function tasksBadgeCacheKey(userId: string): string {
  return `sales:tasks:mine:${userId || 'self'}`;
}

type ReloadHandler = () => void;
const reloadHandlers = new Set<ReloadHandler>();

export function subscribeTasksReload(handler: ReloadHandler): () => void {
  reloadHandlers.add(handler);
  return () => {
    reloadHandlers.delete(handler);
  };
}

export function publishTasksReload(): void {
  reloadHandlers.forEach((handler) => handler());
}
