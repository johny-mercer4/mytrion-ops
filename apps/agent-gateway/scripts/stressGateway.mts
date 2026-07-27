/**
 * Offline agent-gateway stress harness.
 *
 * SAFETY: this process blocks global fetch and uses fake OAuth token strings. It cannot reach
 * Telegram, Mytrion, EFS, Claude, or a real client. Run through `pnpm stress:offline`.
 */
import { performance } from 'node:perf_hooks';
import {
  consumeButtonTap,
  noteButtonOwner,
} from '../src/buttonOwnership.js';
import { WRITE_RISK_TOOLS } from '../src/retrySafety.js';

interface Options {
  users: number;
  messages: number;
  concurrency: number;
  delayMs: number;
  chats: number;
  progressMs: number;
  json: boolean;
}

interface TurnMetric {
  key: string;
  sequence: number;
  waitMs: number;
  execMs: number;
  totalMs: number;
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error(`--${name} must be an integer between 1 and 100000`);
  }
  return parsed;
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  const allowed = new Set([
    'users',
    'messages',
    'concurrency',
    'delay-ms',
    'chats',
    'progress-ms',
  ]);
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    const name = arg.slice(2);
    if (!allowed.has(name)) throw new Error(`unknown argument: --${name}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`);
    values.set(name, value);
  }
  const options = {
    users: positiveInt('users', values.get('users'), 100),
    messages: positiveInt('messages', values.get('messages'), 5),
    concurrency: positiveInt('concurrency', values.get('concurrency'), 12),
    delayMs: positiveInt('delay-ms', values.get('delay-ms'), 3),
    chats: positiveInt('chats', values.get('chats'), 10),
    progressMs: positiveInt('progress-ms', values.get('progress-ms'), 1000),
    json,
  };
  if (options.users * options.messages > 1_000_000) {
    throw new Error('--users × --messages must not exceed 1000000 turns');
  }
  return options;
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)]!.toFixed(2));
}

class OfflineTurnScheduler {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private readonly activeByKey = new Map<string, number>();
  readonly metrics: TurnMetric[] = [];
  readonly order = new Map<string, number[]>();
  maxActive = 0;
  overlaps = 0;

  constructor(
    private readonly concurrency: number,
    private readonly delayMs: number,
  ) {}

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      this.maxActive = Math.max(this.maxActive, this.active);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  enqueue(key: string, sequence: number): Promise<void> {
    const enqueuedAt = performance.now();
    const previous = this.chains.get(key) ?? Promise.resolve();
    let next: Promise<void>;
    next = previous
      .then(async () => {
        await this.acquire();
        const startedAt = performance.now();
        const keyActive = this.activeByKey.get(key) ?? 0;
        if (keyActive > 0) this.overlaps++;
        this.activeByKey.set(key, keyActive + 1);
        try {
          // Deterministic jitter prevents every simulated turn completing in lock-step.
          const jitter = (sequence + key.length) % 3;
          await new Promise((resolve) => setTimeout(resolve, this.delayMs + jitter));
          const finishedAt = performance.now();
          const seen = this.order.get(key) ?? [];
          seen.push(sequence);
          this.order.set(key, seen);
          this.metrics.push({
            key,
            sequence,
            waitMs: startedAt - enqueuedAt,
            execMs: finishedAt - startedAt,
            totalMs: finishedAt - enqueuedAt,
          });
        } finally {
          const remaining = (this.activeByKey.get(key) ?? 1) - 1;
          if (remaining > 0) this.activeByKey.set(key, remaining);
          else this.activeByKey.delete(key);
          this.release();
        }
      })
      .finally(() => {
        if (this.chains.get(key) === next) this.chains.delete(key);
      });
    this.chains.set(key, next);
    return next;
  }

  get pendingKeys(): number {
    return this.chains.size;
  }

  get activeTurns(): number {
    return this.active;
  }

  get queuedTurns(): number {
    return this.waiters.length;
  }
}

function stressButtons(): {
  allowed: number;
  replayBlocked: number;
  foreignBlocked: number;
  expiredBlocked: boolean;
} {
  const now = 10_000;
  const chats = 10;
  const messagesPerChat = 40;
  for (let chat = 1; chat <= chats; chat++) {
    for (let message = 1; message <= messagesPerChat; message++) {
      noteButtonOwner(-chat, message, 1000 + chat, now);
    }
  }

  const foreignBlocked =
    consumeButtonTap(-1, 1, 9999, now + 1) === 'foreign' ? 1 : 0;
  let allowed = 0;
  let replayBlocked = 0;
  for (let chat = 1; chat <= chats; chat++) {
    for (let message = 1; message <= messagesPerChat; message++) {
      const userId = 1000 + chat;
      if (consumeButtonTap(-chat, message, userId, now + 2) === 'allowed') allowed++;
      if (consumeButtonTap(-chat, message, userId, now + 3) === 'unavailable') {
        replayBlocked++;
      }
    }
  }
  noteButtonOwner(-99, 99, 999, now);
  const expiredBlocked =
    consumeButtonTap(-99, 99, 999, now + 10 * 60_000 + 1) === 'unavailable';
  return { allowed, replayBlocked, foreignBlocked, expiredBlocked };
}

async function stressTokenPool(): Promise<{
  rotated: boolean;
  allLimited: boolean;
  tokens: number;
}> {
  // authPool reads env once at import. These are deliberately fake and never leave this process.
  process.env['CLAUDE_CODE_OAUTH_TOKENS'] =
    'stress-fake-token-1,stress-fake-token-2,stress-fake-token-3';
  process.env['AUTH_COOLDOWN_MS'] = '60000';
  delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  for (let slot = 1; slot <= 10; slot++) {
    delete process.env[`CLAUDE_CODE_OAUTH_TOKEN_${slot}`];
  }
  const pool = await import('../src/authPool.js');
  const tried = new Set<string>();
  const first = pool.pickToken(tried);
  if (!first) return { rotated: false, allLimited: false, tokens: 0 };
  const originalLog = console.log;
  console.log = () => {};
  try {
    pool.markLimited(first.token, Date.now() + 60_000);
    tried.add(first.token);
    const second = pool.pickToken(tried);
    const rotated = second != null && second.token !== first.token;
    if (second) {
      pool.markLimited(second.token, Date.now() + 60_000);
      tried.add(second.token);
    }
    const third = pool.pickToken(tried);
    if (third) pool.markLimited(third.token, Date.now() + 60_000);
    return {
      rotated,
      allLimited: pool.soonestRecovery() !== null,
      tokens: pool.tokenCount(),
    };
  } finally {
    console.log = originalLog;
  }
}

async function main(): Promise<void> {
  if (process.env['STRESS_MODE'] !== '1') {
    throw new Error('refusing to run without STRESS_MODE=1; use: pnpm stress:offline');
  }
  // Defense in depth: any accidental network path fails loudly before a packet is sent.
  globalThis.fetch = async () => {
    throw new Error('network disabled by offline gateway stress harness');
  };

  const options = parseOptions(process.argv.slice(2));
  const scheduler = new OfflineTurnScheduler(options.concurrency, options.delayMs);
  const rssBefore = process.memoryUsage().rss;
  const startedAt = performance.now();
  let lastTick = startedAt;
  let maxEventLoopLagMs = 0;
  const lagTimer = setInterval(() => {
    const now = performance.now();
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, now - lastTick - 10);
    lastTick = now;
  }, 10);

  const turns: Array<Promise<void>> = [];
  for (let user = 0; user < options.users; user++) {
    const chatId = -(1 + (user % options.chats));
    const key = `${chatId}:${10_000 + user}`;
    for (let sequence = 0; sequence < options.messages; sequence++) {
      turns.push(scheduler.enqueue(key, sequence));
    }
  }
  const requests = options.users * options.messages;
  let lastProgressAt = startedAt;
  let lastCompleted = 0;
  const progressTimer = options.json
    ? null
    : setInterval(() => {
        const now = performance.now();
        const completed = scheduler.metrics.length;
        const intervalSec = Math.max(0.001, (now - lastProgressAt) / 1000);
        const rate = (completed - lastCompleted) / intervalSec;
        const rssMb = process.memoryUsage().rss / 1024 / 1024;
        const line =
          `LIVE ${completed}/${requests} (${((completed / requests) * 100).toFixed(1)}%)` +
          ` · active=${scheduler.activeTurns}` +
          ` · queued=${scheduler.queuedTurns}` +
          ` · rate=${rate.toFixed(1)}/s` +
          ` · elapsed=${((now - startedAt) / 1000).toFixed(1)}s` +
          ` · rss=${rssMb.toFixed(1)}MB`;
        if (process.stdout.isTTY) process.stdout.write(`\r${line.padEnd(120)}`);
        else console.log(line);
        lastProgressAt = now;
        lastCompleted = completed;
      }, options.progressMs);
  await Promise.all(turns);
  if (progressTimer) clearInterval(progressTimer);
  if (!options.json && process.stdout.isTTY) process.stdout.write('\n');
  clearInterval(lagTimer);

  const button = stressButtons();
  const token = await stressTokenPool();
  const expectedPerKey = Array.from(
    { length: options.messages },
    (_, index) => index,
  );
  const outOfOrder = [...scheduler.order.values()].filter(
    (seen) => JSON.stringify(seen) !== JSON.stringify(expectedPerKey),
  ).length;
  const requiredWrites = [
    'mcp__octane__octane_money_code',
    'mcp__octane__octane_override',
    'mcp__octane__octane_card_action',
    'mcp__octane__octane_card_limits',
    'mcp__octane__octane_card_info',
    'mcp__octane__octane_service_request',
  ];
  const missingWriteClassifications = requiredWrites.filter(
    (name) => !WRITE_RISK_TOOLS.has(name),
  );
  const wait = scheduler.metrics.map((metric) => metric.waitMs);
  const total = scheduler.metrics.map((metric) => metric.totalMs);
  const report = {
    safeOffline: true,
    options,
    requests,
    completed: scheduler.metrics.length,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    maxActive: scheduler.maxActive,
    sameUserOverlaps: scheduler.overlaps,
    outOfOrder,
    pendingKeys: scheduler.pendingKeys,
    waitMs: { p50: percentile(wait, 50), p95: percentile(wait, 95) },
    totalMs: { p50: percentile(total, 50), p95: percentile(total, 95) },
    maxEventLoopLagMs: Number(Math.max(0, maxEventLoopLagMs).toFixed(2)),
    rssGrowthMb: Number(
      ((process.memoryUsage().rss - rssBefore) / 1024 / 1024).toFixed(2),
    ),
    button,
    token,
    missingWriteClassifications,
  };
  const passed =
    report.completed === requests &&
    report.maxActive <= options.concurrency &&
    report.sameUserOverlaps === 0 &&
    report.outOfOrder === 0 &&
    report.pendingKeys === 0 &&
    button.allowed === 400 &&
    button.replayBlocked === 400 &&
    button.foreignBlocked === 1 &&
    button.expiredBlocked &&
    token.rotated &&
    token.allLimited &&
    token.tokens === 3 &&
    missingWriteClassifications.length === 0;

  if (options.json) {
    console.log(JSON.stringify({ passed, ...report }, null, 2));
  } else {
    console.log(
      [
        `${passed ? 'PASS' : 'FAIL'} · OFFLINE ONLY · ${report.completed}/${requests} turns`,
        `concurrency max=${report.maxActive}/${options.concurrency} · same-user overlap=${report.sameUserOverlaps} · out-of-order=${report.outOfOrder}`,
        `wait p50=${report.waitMs.p50}ms p95=${report.waitMs.p95}ms · total p50=${report.totalMs.p50}ms p95=${report.totalMs.p95}ms`,
        `buttons allowed=${button.allowed} replay-blocked=${button.replayBlocked} foreign-blocked=${button.foreignBlocked} expired-blocked=${button.expiredBlocked}`,
        `tokens=${token.tokens} rotated=${token.rotated} all-limited-detected=${token.allLimited}`,
        `event-loop-lag max=${report.maxEventLoopLagMs}ms · rss growth=${report.rssGrowthMb}MB · pending keys=${report.pendingKeys}`,
      ].join('\n'),
    );
  }
  if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
