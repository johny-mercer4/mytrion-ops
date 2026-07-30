/**
 * Diagnostic: are the configured OAuth tokens SEPARATE Anthropic accounts?
 *
 * Failover only helps if each token draws on its OWN quota. Tokens from ONE subscription share ONE
 * rate-limit window — they exhaust together and rotation is a no-op. OAuth tokens carry no email, so
 * we distinguish by the plan rate-limit WINDOW: every real turn emits a `rate_limit_event` carrying
 * the five-hour window's `resetsAt` (+ the seven-day `overageResetsAt`). Two tokens on the SAME
 * account report the SAME timestamps; separate accounts have independent windows.
 *
 *   pnpm tsx scripts/checkTokens.mts
 *
 * Costs one tiny haiku turn per token.
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';

if (!process.env['IS_SANDBOX']) process.env['IS_SANDBOX'] = '1';

function parseTokens(): string[] {
  const raw: string[] = [];
  const multi = process.env['CLAUDE_CODE_OAUTH_TOKENS'];
  if (multi) raw.push(...multi.split(/[,\n]/));
  for (let i = 1; i <= 10; i++) {
    const v = process.env[`CLAUDE_CODE_OAUTH_TOKEN_${i}`];
    if (v) raw.push(v);
  }
  const single = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (single) raw.push(single);
  const seen = new Set<string>();
  return raw.map((t) => t.trim()).filter((t) => t && !seen.has(t) && (seen.add(t), true));
}

const mask = (t: string): string => `…${t.slice(-6)}`;
const iso = (unixSec?: number): string => (unixSec ? new Date(unixSec * 1000).toISOString() : '?');

interface Window {
  status?: string;
  rateLimitType?: string;
  utilization?: number;
  fiveHourResetsAt?: number;
  sevenDayResetsAt?: number;
}

async function windowFor(token: string): Promise<Window | { error: string }> {
  const q = query({
    prompt: 'Reply with exactly: ok',
    options: { env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token }, model: 'claude-haiku-4-5-20251001', maxTurns: 1 },
  });
  let info: Record<string, unknown> | null = null;
  try {
    for await (const m of q) {
      if (m.type === 'rate_limit_event') info = m.rate_limit_info as unknown as Record<string, unknown>;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!info) return { error: 'no rate_limit_event emitted (token may be an API key, not a subscription)' };
  return {
    status: info['status'] as string | undefined,
    rateLimitType: info['rateLimitType'] as string | undefined,
    utilization: info['utilization'] as number | undefined,
    fiveHourResetsAt: info['resetsAt'] as number | undefined,
    sevenDayResetsAt: info['overageResetsAt'] as number | undefined,
  };
}

async function main(): Promise<void> {
  const toks = parseTokens();
  if (!toks.length) {
    console.error('no tokens configured (CLAUDE_CODE_OAUTH_TOKENS / _1.._10 / CLAUDE_CODE_OAUTH_TOKEN)');
    process.exit(1);
  }
  console.log(`Checking ${toks.length} token(s) — one tiny turn each…\n`);
  const rows: Array<{ tok: string; win: Window }> = [];
  for (const t of toks) {
    const w = await windowFor(t);
    if ('error' in w) {
      console.log(`${mask(t)}  ERROR: ${w.error}`);
      rows.push({ tok: t, win: {} });
      continue;
    }
    console.log(
      `${mask(t)}  status=${w.status ?? '?'}  5h-window resets ${iso(w.fiveHourResetsAt)}  7d resets ${iso(w.sevenDayResetsAt)}  util=${w.utilization ?? '?'}`,
    );
    rows.push({ tok: t, win: w });
  }

  // Verdict: two tokens sharing a five-hour reset timestamp are the SAME account (one shared window).
  console.log('');
  const byWindow = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.win.fiveHourResetsAt ? `${r.win.fiveHourResetsAt}` : '';
    if (!key) continue;
    byWindow.set(key, [...(byWindow.get(key) ?? []), mask(r.tok)]);
  }
  const shared = [...byWindow.values()].filter((g) => g.length > 1);
  if (rows.filter((r) => r.win.fiveHourResetsAt).length < 2) {
    console.log('ℹ Fewer than two subscription tokens returned a window — nothing to compare. Set CLAUDE_CODE_OAUTH_TOKENS to all of them and re-run.');
  } else if (shared.length) {
    console.log('🔴 SAME ACCOUNT — these tokens share one 5-hour quota window, so rotation will NOT help:');
    for (const g of shared) console.log(`   ${g.join(' , ')}`);
    console.log('   → use tokens from SEPARATE Anthropic subscriptions.');
  } else {
    console.log('🟢 All tokens have independent 5-hour windows — consistent with SEPARATE accounts. Failover is viable.');
  }
}

void main();
