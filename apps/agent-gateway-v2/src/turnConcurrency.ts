import { incrementCounter } from './metrics.js';
import { GatewayOverloadError } from './overload.js';

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const MAX_CONCURRENT_TURNS = positiveInt('MAX_CONCURRENT_TURNS', 8);
const MAX_CONCURRENT_PER_CARRIER = positiveInt('MAX_CONCURRENT_PER_CARRIER', 2);
let activeTurns = 0;
let waitingTurns = 0;
const activeByCarrier = new Map<string, number>();

interface SlotWaiter {
  carrierId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const queues = new Map<string, SlotWaiter[]>();
const carrierRing: string[] = [];

export function maxConcurrentTurns(): number {
  return MAX_CONCURRENT_TURNS;
}

export function maxConcurrentPerCarrier(): number {
  return MAX_CONCURRENT_PER_CARRIER;
}

export function activeTurnCount(): number {
  return activeTurns;
}

export function waitingTurnCount(): number {
  return waitingTurns;
}

function grant(waiter: SlotWaiter): void {
  if (waiter.timer) clearTimeout(waiter.timer);
  activeTurns += 1;
  activeByCarrier.set(waiter.carrierId, (activeByCarrier.get(waiter.carrierId) ?? 0) + 1);
  waiter.resolve();
}

function removeCarrierFromRing(carrierId: string): void {
  const index = carrierRing.indexOf(carrierId);
  if (index >= 0) carrierRing.splice(index, 1);
}

/** Fill free global slots in round-robin carrier order, respecting each carrier bulkhead. */
function drain(): void {
  while (activeTurns < MAX_CONCURRENT_TURNS && carrierRing.length > 0) {
    const candidates = carrierRing.length;
    let granted = false;
    for (let index = 0; index < candidates; index += 1) {
      const carrierId = carrierRing.shift();
      if (!carrierId) break;
      const queue = queues.get(carrierId);
      if (!queue?.length) {
        queues.delete(carrierId);
        continue;
      }
      if ((activeByCarrier.get(carrierId) ?? 0) >= MAX_CONCURRENT_PER_CARRIER) {
        carrierRing.push(carrierId);
        continue;
      }
      const waiter = queue.shift();
      if (!waiter) continue;
      waitingTurns = Math.max(0, waitingTurns - 1);
      if (queue.length) carrierRing.push(carrierId);
      else queues.delete(carrierId);
      grant(waiter);
      granted = true;
      break;
    }
    if (!granted) return;
  }
}

export function acquireTurnSlot(carrierId: string, deadlineAt?: number): Promise<void> {
  if (
    activeTurns < MAX_CONCURRENT_TURNS &&
    (activeByCarrier.get(carrierId) ?? 0) < MAX_CONCURRENT_PER_CARRIER
  ) {
    activeTurns += 1;
    activeByCarrier.set(carrierId, (activeByCarrier.get(carrierId) ?? 0) + 1);
    return Promise.resolve();
  }
  const waitMs = deadlineAt === undefined ? undefined : deadlineAt - Date.now();
  if (waitMs !== undefined && waitMs <= 0) {
    incrementCounter('stale_request_total');
    return Promise.reject(new GatewayOverloadError('stale', 'Model queue request became stale'));
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: SlotWaiter = { carrierId, resolve, reject, timer: null };
    const queue = queues.get(carrierId) ?? [];
    if (queue.length === 0) carrierRing.push(carrierId);
    queue.push(waiter);
    queues.set(carrierId, queue);
    waitingTurns += 1;
    if (waitMs !== undefined) {
      waiter.timer = setTimeout(() => {
        const current = queues.get(carrierId);
        const index = current?.indexOf(waiter) ?? -1;
        if (current && index >= 0) {
          current.splice(index, 1);
          waitingTurns = Math.max(0, waitingTurns - 1);
          if (!current.length) {
            queues.delete(carrierId);
            removeCarrierFromRing(carrierId);
          }
        }
        incrementCounter('stale_request_total');
        reject(new GatewayOverloadError('stale', 'Model queue wait exceeded'));
      }, waitMs);
    }
    drain();
  });
}

export function releaseTurnSlot(carrierId: string): void {
  activeTurns = Math.max(0, activeTurns - 1);
  const remaining = Math.max(0, (activeByCarrier.get(carrierId) ?? 1) - 1);
  if (remaining) activeByCarrier.set(carrierId, remaining);
  else activeByCarrier.delete(carrierId);
  drain();
}

/** Tests only. Never call while production turns are active. */
export function resetTurnConcurrencyForTests(): void {
  activeTurns = 0;
  waitingTurns = 0;
  activeByCarrier.clear();
  for (const queue of queues.values()) {
    for (const waiter of queue) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error('turn concurrency reset'));
    }
  }
  queues.clear();
  carrierRing.length = 0;
}
