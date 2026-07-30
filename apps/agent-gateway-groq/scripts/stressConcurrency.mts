/**
 * Offline burst test for the gateway scheduling invariants. It performs no network requests and
 * uses the production global semaphore with the same per-user chaining strategy as sessions.ts.
 *
 * Usage: pnpm stress:concurrency -- --users=100 --turns=3 --concurrency=8 --delay-ms=10
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

function option(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const users = option('users', 100);
const turnsPerUser = option('turns', 3);
const concurrencyLimit = option('concurrency', 8);
const delayMs = option('delay-ms', 10);
process.env['MAX_CONCURRENT_TURNS'] = String(concurrencyLimit);

const {
  acquireTurnSlot,
  activeTurnCount,
  releaseTurnSlot,
  waitingTurnCount,
} = await import('../src/turnConcurrency.js');

const chains = new Map<string, Promise<void>>();
const userActive = new Set<string>();
const lastSequence = new Map<string, number>();
let maxActive = 0;
let sameUserOverlaps = 0;
let outOfOrder = 0;
const startedAt = performance.now();
const initialRss = process.memoryUsage().rss;
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

function enqueue(key: string, sequence: number): Promise<void> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous
    .then(async () => {
      await acquireTurnSlot();
      maxActive = Math.max(maxActive, activeTurnCount());
      if (userActive.has(key)) sameUserOverlaps += 1;
      userActive.add(key);
      if ((lastSequence.get(key) ?? -1) + 1 !== sequence) outOfOrder += 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        lastSequence.set(key, sequence);
      } finally {
        userActive.delete(key);
        releaseTurnSlot();
      }
    })
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
  return next;
}

const work: Array<Promise<void>> = [];
for (let user = 0; user < users; user += 1) {
  const key = `-1001:${user + 1}`;
  for (let sequence = 0; sequence < turnsPerUser; sequence += 1) {
    work.push(enqueue(key, sequence));
  }
}
await Promise.all(work);
loopDelay.disable();

const report = {
  requests: work.length,
  users,
  turnsPerUser,
  concurrencyLimit,
  maxActive,
  sameUserOverlaps,
  outOfOrder,
  pendingKeys: chains.size,
  activeAtEnd: activeTurnCount(),
  waitingAtEnd: waitingTurnCount(),
  durationMs: Math.round(performance.now() - startedAt),
  eventLoopLagMaxMs: Number((Number(loopDelay.max) / 1_000_000).toFixed(2)),
  rssGrowthMb: Number(
    ((process.memoryUsage().rss - initialRss) / 1024 / 1024).toFixed(2),
  ),
};
console.log(JSON.stringify(report, null, 2));

const passed =
  report.maxActive <= concurrencyLimit &&
  report.sameUserOverlaps === 0 &&
  report.outOfOrder === 0 &&
  report.pendingKeys === 0 &&
  report.activeAtEnd === 0 &&
  report.waitingAtEnd === 0;
if (!passed) process.exitCode = 1;
