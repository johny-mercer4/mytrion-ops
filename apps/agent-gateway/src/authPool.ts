/**
 * OAuth token pool — the answer to "what happens when a subscription token hits its limit".
 *
 * The Agent SDK authenticates each spawned Claude CLI with a claude.ai subscription token
 * (`CLAUDE_CODE_OAUTH_TOKEN`). A single token has a 5-hour / 7-day usage window; once a busy day
 * across several groups exhausts it, EVERY turn on that one token starts failing and the whole
 * bot goes dark. This module holds SEVERAL tokens and does two jobs:
 *
 *   1. SPREAD — hand concurrent turns different tokens round-robin, so N groups running in
 *      parallel draw from N accounts' quota instead of hammering one.
 *   2. FAILOVER — when a turn comes back rate-limited (rejected quota), put that token on
 *      cooldown (until its `resetsAt`, or a default) and retry the SAME turn on the next token.
 *      Because the SDK transcript lives on disk (account-agnostic), resuming the same session id
 *      under a different token continues the conversation seamlessly.
 *
 * Configure with any of (merged, de-duplicated, in this precedence):
 *   - CLAUDE_CODE_OAUTH_TOKENS   comma/newline-separated list
 *   - CLAUDE_CODE_OAUTH_TOKEN_1 … _10   numbered slots
 *   - CLAUDE_CODE_OAUTH_TOKEN    single (legacy — one token = old behaviour, no rotation)
 */

/** Default cooldown when a rate-limit gives no `resetsAt` (subscription 5-hour window ≈ safe floor). */
const DEFAULT_COOLDOWN_MS = Number(process.env['AUTH_COOLDOWN_MS'] ?? String(60 * 60_000));

export interface TokenState {
  token: string;
  /** Masked, log-safe id (`oauth#1`, `oauth#2`, …). The raw token never hits the logs. */
  label: string;
  /** ms-epoch until which this token is considered exhausted; 0 = healthy. */
  cooldownUntil: number;
}

function parseTokens(): TokenState[] {
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
  const uniq = raw.map((t) => t.trim()).filter((t) => t && !seen.has(t) && (seen.add(t), true));
  if (!uniq.length) {
    throw new Error('no auth token — set CLAUDE_CODE_OAUTH_TOKEN(S) or CLAUDE_CODE_OAUTH_TOKEN_1..N');
  }
  return uniq.map((token, i) => ({ token, label: `oauth#${i + 1}`, cooldownUntil: 0 }));
}

const tokens = parseTokens();
/** Global round-robin cursor — advanced on every pick so concurrent turns land on distinct tokens. */
let cursor = 0;

export function tokenCount(): number {
  return tokens.length;
}

/**
 * Pick a token to run the next attempt on.
 * - Prefer a HEALTHY token (cooldown elapsed) not yet tried this turn, round-robin.
 * - If every untried token is still cooling down, best-effort return one anyway (a subscription
 *   window may have cleared before `resetsAt`) — better to try than to fail blind.
 * - Returns null only when every token has already been tried this turn.
 */
export function pickToken(tried?: Set<string>): TokenState | null {
  const now = Date.now();
  const avail = tokens.filter((t) => !tried?.has(t.token));
  if (!avail.length) return null;
  const healthy = avail.filter((t) => t.cooldownUntil <= now);
  const pool = healthy.length ? healthy : avail;
  const t = pool[cursor % pool.length];
  cursor = (cursor + 1) % pool.length;
  return t;
}

/** Normalise a rate-limit reset stamp to ms-epoch (SDK may report unix seconds). */
function normalizeReset(v?: number): number | undefined {
  if (!v || v <= 0) return undefined;
  return v < 1e12 ? v * 1000 : v;
}

/** Put a token on cooldown after a rejected/limited turn. An authoritative `resetsAt` always wins;
 *  a limit with NO reset only STARTS a cooldown when the token is currently healthy — repeat probes
 *  of an already-cooling token must not keep pushing its recovery farther out. */
export function markLimited(token: string, resetsAt?: number): void {
  const t = tokens.find((x) => x.token === token);
  if (!t) return;
  const now = Date.now();
  const reset = normalizeReset(resetsAt);
  if (reset && reset > now) {
    t.cooldownUntil = reset;
  } else if (t.cooldownUntil <= now) {
    t.cooldownUntil = now + DEFAULT_COOLDOWN_MS;
  } else {
    return; // already cooling, no authoritative reset — leave it (don't extend), don't re-log
  }
  console.log(`[auth] ${t.label} rate-limited → cooldown until ${new Date(t.cooldownUntil).toISOString()}`);
}

/** Soonest ms-epoch any token frees up (for a "try again in N min" message). null = a token is free now. */
export function soonestRecovery(): number | null {
  const now = Date.now();
  if (tokens.some((t) => t.cooldownUntil <= now)) return null;
  return Math.min(...tokens.map((t) => t.cooldownUntil));
}
