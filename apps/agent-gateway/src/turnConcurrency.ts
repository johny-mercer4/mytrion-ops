/**
 * Optional global safety valve. Unlimited by default so unrelated users never queue behind one
 * another; when configured, a released slot is handed directly to the oldest waiter.
 */
const MAX_CONCURRENT_TURNS = Number(
  process.env['MAX_CONCURRENT_TURNS'] ?? '0',
);
const CONCURRENCY_LIMITED =
  Number.isFinite(MAX_CONCURRENT_TURNS) && MAX_CONCURRENT_TURNS >= 1;
let activeTurns = 0;
const slotWaiters: Array<() => void> = [];

export function maxConcurrentTurns(): number {
  return CONCURRENCY_LIMITED ? MAX_CONCURRENT_TURNS : 0;
}

export function acquireTurnSlot(): Promise<void> {
  if (!CONCURRENCY_LIMITED) return Promise.resolve();
  if (activeTurns < MAX_CONCURRENT_TURNS) {
    activeTurns++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => slotWaiters.push(resolve));
}

export function releaseTurnSlot(): void {
  if (!CONCURRENCY_LIMITED) return;
  const next = slotWaiters.shift();
  if (next) next();
  else activeTurns--;
}
