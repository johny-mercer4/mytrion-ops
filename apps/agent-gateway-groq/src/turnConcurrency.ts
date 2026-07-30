function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const MAX_CONCURRENT_TURNS = positiveInt('MAX_CONCURRENT_TURNS', 8);
let activeTurns = 0;
const slotWaiters: Array<() => void> = [];

export function maxConcurrentTurns(): number {
  return MAX_CONCURRENT_TURNS;
}

export function activeTurnCount(): number {
  return activeTurns;
}

export function waitingTurnCount(): number {
  return slotWaiters.length;
}

/** FIFO global safety valve around expensive model/tool turns. */
export function acquireTurnSlot(): Promise<void> {
  if (activeTurns < MAX_CONCURRENT_TURNS) {
    activeTurns += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => slotWaiters.push(resolve));
}

export function releaseTurnSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    // The released slot transfers directly to the oldest waiter; activeTurns is unchanged.
    next();
    return;
  }
  activeTurns = Math.max(0, activeTurns - 1);
}

/** Tests only. Never call while production turns are active. */
export function resetTurnConcurrencyForTests(): void {
  activeTurns = 0;
  slotWaiters.length = 0;
}
