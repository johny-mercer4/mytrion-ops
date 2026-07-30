import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

interface MetricsResponse {
  ts: string;
  startedAt: string;
  uptimeSec: number;
  pid: number;
  gauges: Record<string, number>;
  counters: Record<string, number>;
}

interface TurnRow {
  ts: string;
  completedAt?: string;
  turnId?: string;
  chatId: number;
  userId: number;
  waitMs: number;
  execMs: number;
  totalMs?: number;
  sendMs?: number;
  isError: boolean;
}

interface TurnsResponse {
  turns: TurnRow[];
  truncated: boolean;
  oldestAvailableTs: string | null;
  newestAvailableTs: string | null;
}

interface Options {
  label: string;
  minutes: number;
  intervalSec: number;
  baseUrl: string;
  token: string;
  allowRestart: boolean;
}

function valueAfter(args: string[], name: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(): Options {
  const args = process.argv.slice(2);
  const label = valueAfter(args, '--label') ?? 'pre-redis';
  const minutes = Number(valueAfter(args, '--minutes') ?? '60');
  const intervalSec = Number(valueAfter(args, '--interval-sec') ?? '30');
  const baseUrl = (
    valueAfter(args, '--url') ??
    `http://127.0.0.1:${process.env['MONITOR_PORT'] ?? '8787'}`
  ).replace(/\/+$/, '');
  const token =
    valueAfter(args, '--token') ?? process.env['MONITOR_TOKEN'] ?? '';
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(label)) {
    throw new Error('label must use letters, numbers, dot, underscore or dash');
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('--minutes must be positive');
  }
  if (!Number.isFinite(intervalSec) || intervalSec < 1) {
    throw new Error('--interval-sec must be at least 1');
  }
  return {
    label,
    minutes,
    intervalSec,
    baseUrl,
    token,
    allowRestart: args.includes('--allow-restart'),
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(
        sorted.length - 1,
        Math.floor((p / 100) * sorted.length),
      )
    ] ?? 0
  );
}

function queryUrl(
  baseUrl: string,
  pathname: string,
  token: string,
  extra: Record<string, string> = {},
): URL {
  const url = new URL(
    pathname.replace(/^\/+/, ''),
    `${baseUrl.replace(/\/+$/, '')}/`,
  );
  if (token) url.searchParams.set('token', token);
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function getJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`monitor returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function turnKey(turn: TurnRow): string {
  return (
    turn.turnId ??
    [
      turn.ts,
      turn.chatId,
      turn.userId,
      turn.waitMs,
      turn.execMs,
      turn.totalMs ?? '',
    ].join(':')
  );
}

function counterDeltas(samples: MetricsResponse[]) {
  const totals: Record<string, number> = {};
  const epochs = new Map<string, MetricsResponse[]>();
  const initialEpoch = samples[0]
    ? `${samples[0].startedAt}:${samples[0].pid}`
    : null;
  for (const sample of samples) {
    const key = `${sample.startedAt}:${sample.pid}`;
    const rows = epochs.get(key) ?? [];
    rows.push(sample);
    epochs.set(key, rows);
  }
  for (const [epochKey, rows] of epochs) {
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) continue;
    for (const [name, end] of Object.entries(last.counters)) {
      // The first process may contain pre-window counts, so subtract its first sample. A process
      // that starts during an allowed-restart window begins at zero; include work before its first
      // poll instead of silently losing that segment.
      const start =
        epochKey === initialEpoch ? first.counters[name] ?? 0 : 0;
      totals[name] = (totals[name] ?? 0) + Math.max(0, end - start);
    }
  }
  return totals;
}

function gaugeSummary(samples: MetricsResponse[]) {
  const names = new Set(
    samples.flatMap((sample) => Object.keys(sample.gauges)),
  );
  return Object.fromEntries(
    [...names].map((name) => {
      const values = samples.map((sample) => sample.gauges[name] ?? 0);
      return [
        name,
        {
          latest: values.at(-1) ?? 0,
          max: Math.max(...values),
          average:
            values.reduce((sum, value) => sum + value, 0) /
            Math.max(1, values.length),
        },
      ];
    }),
  );
}

async function main(): Promise<void> {
  const opts = options();
  const samples: MetricsResponse[] = [];
  const turns = new Map<string, TurnRow>();
  let epoch: string | null = null;
  let capturedAt: Date | null = null;
  let deadline = 0;
  let since = '';

  console.log(
    `[baseline] ${opts.label}: ${opts.minutes} min, every ${opts.intervalSec}s, ${opts.baseUrl}`,
  );
  for (;;) {
    const metrics = await getJson<MetricsResponse>(
      queryUrl(opts.baseUrl, '/api/metrics', opts.token),
    );
    const nextEpoch = `${metrics.startedAt}:${metrics.pid}`;
    if (epoch && epoch !== nextEpoch && !opts.allowRestart) {
      throw new Error(
        `gateway restarted during capture (${epoch} -> ${nextEpoch}); baseline aborted`,
      );
    }
    epoch = nextEpoch;
    samples.push(metrics);
    if (!capturedAt) {
      capturedAt = new Date(metrics.ts);
      deadline = Date.now() + opts.minutes * 60_000;
      since = capturedAt.toISOString();
    }

    const page = await getJson<TurnsResponse>(
      queryUrl(opts.baseUrl, '/api/turns', opts.token, { since }),
    );
    if (page.truncated) {
      throw new Error(
        `turn buffer truncated before ${since} (oldest ${page.oldestAvailableTs ?? 'unknown'}); baseline aborted`,
      );
    }
    for (const turn of page.turns) turns.set(turnKey(turn), turn);
    if (page.newestAvailableTs) {
      const cursorMs = Date.parse(page.newestAvailableTs);
      if (Number.isFinite(cursorMs)) {
        // One millisecond overlap prevents same-timestamp rows at an interval boundary from
        // disappearing; stable turnId de-duplicates the overlap.
        since = new Date(Math.max(0, cursorMs - 1)).toISOString();
      }
    }

    const remaining = deadline - Date.now();
    console.log(
      `[baseline] samples=${samples.length} turns=${turns.size} remaining=${Math.max(0, Math.ceil(remaining / 1000))}s`,
    );
    if (remaining <= 0) break;
    await sleep(Math.min(remaining, opts.intervalSec * 1000));
  }
  if (!capturedAt) throw new Error('monitor returned no metric samples');
  const endedAt = Date.parse(samples.at(-1)?.ts ?? '');
  const rows = [...turns.values()].filter(
    (turn) =>
      turn.totalMs != null &&
      Date.parse(turn.ts) >= capturedAt.getTime() &&
      Date.parse(turn.completedAt ?? turn.ts) <= endedAt,
  );
  const waits = rows.map((turn) => turn.waitMs);
  const totals = rows.map((turn) => turn.totalMs ?? 0);
  const execs = rows.map((turn) => turn.execMs);
  const sends = rows.map((turn) => turn.sendMs ?? 0);
  const deltas = counterDeltas(samples);
  const turnCount = deltas['turns_total'] ?? 0;
  const turnErrors = deltas['turn_errors_total'] ?? 0;
  const report = {
    label: opts.label,
    recordedAt: new Date().toISOString(),
    windowMinutes: opts.minutes,
    process: {
      epochs: [
        ...new Set(
          samples.map((sample) => `${sample.startedAt}:${sample.pid}`),
        ),
      ],
      samples: samples.length,
      restartAllowed: opts.allowRestart,
    },
    latency: {
      measuredTurns: rows.length,
      waitP50Ms: percentile(waits, 50),
      waitP95Ms: percentile(waits, 95),
      totalP50Ms: percentile(totals, 50),
      totalP95Ms: percentile(totals, 95),
      execP50Ms: percentile(execs, 50),
      execP95Ms: percentile(execs, 95),
      sendP50Ms: percentile(sends, 50),
      sendP95Ms: percentile(sends, 95),
    },
    gauges: gaugeSummary(samples),
    counterDeltas: deltas,
    rates: {
      turnErrorPct:
        turnCount > 0 ? (100 * turnErrors) / turnCount : 0,
      providerRateLimitPerTurn:
        turnCount > 0
          ? (deltas['provider_rate_limited_total'] ?? 0) / turnCount
          : 0,
      telegram429PerTurn:
        turnCount > 0
          ? (deltas['tg_429_total'] ?? 0) / turnCount
          : 0,
    },
  };

  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const outputDir = path.join(root, 'eval-reports');
  const outputPath = path.join(
    outputDir,
    `baseline-phase0-${opts.label}.json`,
  );
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[baseline] wrote ${outputPath}`);
}

await main();
