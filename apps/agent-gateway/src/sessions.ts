/**
 * Per-USER Claude sessions. Each (chat, user) pair gets its own SDK session (context = that one
 * person's exchange) and its own serial queue: turns are serial WITHIN a user's thread and parallel
 * ACROSS users — so in a busy group, driver B is answered immediately while driver A's turn is still
 * running, and neither waits on the other. Session ids persist to disk so a restart resumes threads.
 *
 * Why per-user and not per-chat: a single resumable session id cannot run two turns at once (SDK
 * resume is not concurrent-safe), so a per-chat key would force everyone in a group to queue behind
 * whoever spoke first. Keying by user removes that head-of-line wait. Cross-user isolation is a
 * bonus — a user's context holds only their own messages, and the tool layer already authorises by
 * (chatId, userId), so one user's session can never act as another.
 */
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { buildOctaneServer } from './tools.js';
import { buildTelegramServer } from './telegramTools.js';
import { systemPrompt } from './prompt.js';
import { sendTyping } from './telegram.js';
import { markLimited, pickToken, soonestRecovery, tokenCount } from './authPool.js';

const SESSIONS_FILE = 'data/sessions.json';

/**
 * SESSION ROTATION — the answer to "what happens when the context runs out".
 *
 * One chat = one resumable session, but NOT forever: group support has no use for last month's
 * history, and an ever-growing transcript means ever-growing cache writes, an eventual
 * auto-compaction cost spike, and stale context bleeding into answers. A session is retired and
 * the next turn starts FRESH when any of these hold:
 *   - it has served MAX_TURNS turns, or
 *   - it is older than MAX_AGE_MS, or
 *   - the last turn's cache_read footprint crossed ROTATE_CACHE_TOKENS (the direct measure of
 *     how big the resumed context actually is).
 * Rotation NEVER cuts a live exchange: if the last turn was under QUIET_GAP_MS ago, it is
 * deferred until the chat goes quiet — a follow-up two minutes later still has its context.
 */
const MAX_TURNS = Number(process.env['SESSION_MAX_TURNS'] ?? '40');
const MAX_AGE_MS = Number(process.env['SESSION_MAX_AGE_H'] ?? '24') * 3600_000;
// MEASURED baseline (2026-07-22 stress run): system prompt + 4 skills + tools alone cache-read
// ~85k per turn — so the threshold must sit WELL ABOVE that, or every quiet moment rotates.
const ROTATE_CACHE_TOKENS = Number(process.env['SESSION_ROTATE_CACHE_TOKENS'] ?? '150000');
const QUIET_GAP_MS = 10 * 60_000;
/** When ALL tokens are cooling down and the soonest reset is farther than this, fail a turn instantly
 *  instead of best-effort-spawning a CLI that will just re-hit the limit. */
const ALL_LIMITED_FASTFAIL_MS = Number(process.env['ALL_LIMITED_FASTFAIL_MS'] ?? '30000');

interface SessMeta {
  id: string;
  startedAt: number;
  lastAt: number;
  turns: number;
  lastCacheRead: number;
}
/** Composite session/queue key: one thread per (chat, user). */
type SessionKey = string;
const sessKey = (chatId: number, userId: number): SessionKey => `${chatId}:${userId}`;

const sessions = new Map<SessionKey, SessMeta>();
try {
  const raw = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    // Keys are now "chatId:userId"; a bare-numeric key is a pre-per-user (v2) entry — keep it as-is
    // (it just won't match any per-user lookup, so those threads start fresh once, harmless). v1
    // plain-string "sessionId" values are still migrated in place.
    if (typeof v === 'string') {
      sessions.set(k, { id: v, startedAt: Date.now(), lastAt: Date.now(), turns: 0, lastCacheRead: 0 });
    } else if (v && typeof v === 'object' && typeof (v as SessMeta).id === 'string') {
      sessions.set(k, v as SessMeta);
    }
  }
} catch {
  /* first boot */
}
/**
 * Persist is DEBOUNCED + ATOMIC. Debounced: a burst of concurrent turns (per-user parallelism can
 * fire many `init`/bookkeeping writes at once) collapses into one disk write instead of dozens of
 * blocking sync writes stalling the event loop. Atomic: write a temp file then rename over the real
 * one, so a crash mid-write can't truncate sessions.json into unparseable JSON (which would lose
 * every session on the next boot). A trailing flush ≤ PERSIST_DEBOUNCE_MS after the last change.
 */
const PERSIST_DEBOUNCE_MS = 500;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;
function flushPersist(): void {
  persistTimer = null;
  if (!persistDirty) return;
  persistDirty = false;
  try {
    const tmp = `${SESSIONS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions), null, 1));
    renameSync(tmp, SESSIONS_FILE);
  } catch (e) {
    console.error('[sessions] persist failed', e instanceof Error ? e.message : e);
  }
}
function persist(): void {
  persistDirty = true;
  if (!persistTimer) persistTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
}
// Flush on shutdown so an in-window change isn't lost to the debounce.
for (const sig of ['SIGTERM', 'SIGINT', 'beforeExit'] as const) process.once(sig, flushPersist);

/**
 * Stale sweep — bounds unbounded growth. The key is now per-USER, so `sessions` gains an entry for
 * every unique asker and (unlike the old per-chat key) is NOT self-limiting: `resumableSession` only
 * retires an entry when that same user speaks AGAIN, so a one-off asker's meta would linger forever.
 * Drop anything idle past MAX_AGE_MS on boot and hourly thereafter. A live thread (recent lastAt) is
 * never touched; a swept user simply starts fresh next time — exactly what rotation would do anyway.
 */
const SESSION_SWEEP_MS = 3600_000;
function sweepStale(): void {
  const now = Date.now();
  let removed = 0;
  for (const [k, m] of sessions) {
    if (now - m.lastAt > MAX_AGE_MS) {
      sessions.delete(k);
      removed++;
    }
  }
  if (removed) {
    console.log(`[sessions] swept ${removed} stale thread(s); ${sessions.size} remain`);
    persist();
  }
}
sweepStale();
setInterval(sweepStale, SESSION_SWEEP_MS).unref();

/** Decide fresh-vs-resume for the NEXT turn. Returns the session id to resume, or undefined. */
function resumableSession(key: SessionKey): string | undefined {
  const m = sessions.get(key);
  if (!m) return undefined;
  const now = Date.now();
  const due = m.turns >= MAX_TURNS || now - m.startedAt > MAX_AGE_MS || m.lastCacheRead > ROTATE_CACHE_TOKENS;
  const midConversation = now - m.lastAt < QUIET_GAP_MS;
  if (due && !midConversation) {
    console.log(`[${key}] session rotated (turns=${m.turns}, ageH=${((now - m.startedAt) / 3600_000).toFixed(1)}, cacheRead=${m.lastCacheRead})`);
    sessions.delete(key);
    persist();
    return undefined;
  }
  return m.id;
}

/** Per-USER serial queue: one user's turns never overlap; different users (even in one chat) run in
 *  parallel. Entries are pruned on settle so a group with many one-off askers doesn't leak keys. */
const chains = new Map<SessionKey, Promise<void>>();

/**
 * GLOBAL concurrency cap — a SAFETY VALVE, off by default.
 *
 * The product rule wins: a user who writes must NEVER wait just because the bot is busy answering
 * someone else. Different chats already run in parallel (per-chat chains); a global cap would queue
 * new chats behind a fixed number of slots — i.e. deliberately starve fresh users — so it is
 * DISABLED by default (MAX_CONCURRENT_TURNS unset or ≤0 = unlimited). The only real ceiling is then
 * the token pool's rate limits, which failover handles.
 *
 * Set MAX_CONCURRENT_TURNS ≥ 1 only if you ever need to bound simultaneous CLI subprocesses (e.g. a
 * tiny box). When set, extra turns queue and drain as slots free; per-chat ordering is unaffected.
 */
const MAX_CONCURRENT_TURNS = Number(process.env['MAX_CONCURRENT_TURNS'] ?? '0');
const CONCURRENCY_LIMITED = Number.isFinite(MAX_CONCURRENT_TURNS) && MAX_CONCURRENT_TURNS >= 1;
let activeTurns = 0;
const slotWaiters: Array<() => void> = [];
/** Configured cap, or 0 when unlimited (boot log prints ∞). */
export function maxConcurrentTurns(): number {
  return CONCURRENCY_LIMITED ? MAX_CONCURRENT_TURNS : 0;
}
function acquireSlot(): Promise<void> {
  if (!CONCURRENCY_LIMITED) return Promise.resolve(); // unlimited: every turn starts at once
  if (activeTurns < MAX_CONCURRENT_TURNS) {
    activeTurns++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => slotWaiters.push(resolve));
}
function releaseSlot(): void {
  if (!CONCURRENCY_LIMITED) return;
  const next = slotWaiters.shift();
  // Hand the freed slot directly to the next waiter (activeTurns stays put); only decrement when
  // nobody is waiting.
  if (next) next();
  else activeTurns--;
}

export type TurnContent = string | Array<Record<string, unknown>>;

/** Wrap content blocks as the SDK's streaming-input user message (images ride as base64 blocks).
 *  The cast is deliberate: our image blocks are valid Anthropic content blocks at runtime, but we
 *  build them as plain objects (telegramTools) rather than importing the API's block types. */
async function* asUserMessage(content: TurnContent): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: typeof content === 'string' ? content : content },
    parent_tool_use_id: null,
    session_id: '',
  } as unknown as SDKUserMessage;
}

/** Per-turn accounting surfaced to callers (the web monitor, future metrics). Usage keys mirror
 *  the SDK result message: input_tokens / output_tokens / cache_read_input_tokens /
 *  cache_creation_input_tokens. */
export interface TurnStats {
  durationMs: number;
  numTurns: number;
  usage: Record<string, unknown> | null;
  isError: boolean;
  /** On a failed turn: the caught error's message — surfaced in the web monitor so a prod
   * failure is diagnosable from the dashboard, not only from Render logs. */
  errMsg?: string;
}

/** One `runQuery` attempt's result: the reply text, accounting, and whether the token was rejected. */
interface QueryOutcome {
  finalText: string;
  stats: TurnStats;
  /** The token hit its subscription limit and produced no answer — the caller should rotate. */
  rateLimited: boolean;
  /** ms-epoch (or unix-seconds) the limit resets, when the SDK reported it. */
  resetsAt?: number;
}

/** Thrown when every configured token is exhausted for this turn — enqueue's catch sends a fallback. */
class AllTokensLimitedError extends Error {
  constructor(public readonly retryAt: number | null) {
    super('all auth tokens rate-limited');
    this.name = 'AllTokensLimitedError';
  }
}

/** Bilingual fallback for a failed turn. The all-tokens-limited case names the wait; anything else
 *  keeps the generic "try again shortly" line. */
function allTokensLimitedText(err: unknown): string {
  if (err instanceof AllTokensLimitedError && err.retryAt && err.retryAt > Date.now()) {
    const mins = Math.max(1, Math.round((err.retryAt - Date.now()) / 60_000));
    return (
      `⚠️ Hozir yuklama yuqori — taxminan ${mins} daqiqadan so‘ng qayta urinib ko‘ring. / ` +
      `High demand right now — please try again in about ${mins} min.`
    );
  }
  return (
    '⚠️ Hozir javob bera olmadim — birozdan keyin qayta urinib ko‘ring. / ' +
    "Couldn't answer just now — please try again shortly."
  );
}

export function enqueueTurn(
  chatId: number,
  userId: number,
  carrierId: string,
  userPrompt: TurnContent,
  onReply: (text: string) => Promise<void>,
  onStats?: (stats: TurnStats) => void,
): void {
  const key = sessKey(chatId, userId);
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .then(() => runTurn(chatId, key, carrierId, userPrompt, onReply, onStats))
    .catch(async (err) => {
      console.error(`[${key}] turn failed`, err);
      onStats?.({ durationMs: 0, numTurns: 0, usage: null, isError: true, errMsg: err instanceof Error ? err.message : String(err) });
      // A terminal error (e.g. SDK auth/init failure) used to leave the tagged user with total
      // silence, which reads as "the bot is dead" — worst for exactly the person who engaged.
      // Send one short bilingual fallback so a broken turn is visible, not invisible. Best-effort:
      // if even the send fails, swallow it (the queue must keep draining for the next turn).
      // When EVERY token is exhausted, name the wait so the user knows it's capacity, not a bug.
      try {
        await onReply(allTokensLimitedText(err));
      } catch {
        /* send failed too — nothing more to do */
      }
    })
    .finally(() => {
      // Prune the queue entry once this was the last turn in the thread — otherwise the map grows
      // one entry per unique asker forever. If a newer turn already chained on, leave it.
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
}

/**
 * Telegram's "typing…" status auto-expires after ~5s, so a single sendTyping flashes for a moment
 * and then goes dark while a 20-40s turn (LLM + tools) keeps running — the client looks idle even
 * though the bot is working. Re-send the action every ~4s so a CONTINUOUS "writing…" shows until
 * the reply lands; the returned stop() clears the loop (the reply message itself also ends it).
 * Best-effort — a failed keep-alive tick never throws into the turn.
 */
const TYPING_REFRESH_MS = 4000;
function startTypingKeepAlive(chatId: number): () => void {
  void sendTyping(chatId).catch(() => undefined);
  const timer = setInterval(() => void sendTyping(chatId).catch(() => undefined), TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}

/** Keep the "typing…" indicator alive for the whole turn, then stop it once the reply is sent.
 *  Gated by the global concurrency semaphore — acquired BEFORE the typing loop so a turn that is
 *  merely queued for a slot doesn't flash "writing…" while it waits. */
async function runTurn(
  chatId: number,
  key: SessionKey,
  carrierId: string,
  userPrompt: TurnContent,
  onReply: (text: string) => Promise<void>,
  onStats?: (stats: TurnStats) => void,
): Promise<void> {
  await acquireSlot();
  const stopTyping = startTypingKeepAlive(chatId);
  try {
    await runTurnInner(chatId, key, carrierId, userPrompt, onReply, onStats);
  } finally {
    stopTyping();
    releaseSlot();
  }
}

async function runTurnInner(
  chatId: number,
  key: SessionKey,
  carrierId: string,
  userPrompt: TurnContent,
  onReply: (text: string) => Promise<void>,
  onStats?: (stats: TurnStats) => void,
): Promise<void> {
  // The resumable session only ever carries TEXT. Images are read on demand via the
  // telegram_read_image tool, which returns the extracted text (never the raw bytes) — so
  // history stays cheap and we never re-send a photo on later turns.
  //
  // RESUME IS BEST-EFFORT: the SDK's transcript store lives INSIDE the container filesystem,
  // while sessions.json lives on the data volume — a `docker compose up --build` wipes the
  // former and keeps the latter, so the first turn after a rebuild resumes an id that no longer
  // exists and the query throws instantly (live incident 2026-07-22 22:37: every turn died with
  // execMs=0, bot went silent). One retry with a FRESH session heals it.
  const outcome = await runWithRotation(chatId, key, carrierId, userPrompt, resumableSession(key));
  const { finalText, stats } = outcome;
  const text = finalText.trim();
  // SILENCE is a valid outcome (anti-spam rules) — only deliver real replies.
  if (text && text !== 'SILENT') await onReply(text.slice(0, 4000));
  // Rotation bookkeeping: turn count + the context-size signal (cache_read of this turn).
  const meta = sessions.get(key);
  if (meta) {
    meta.turns += 1;
    meta.lastAt = Date.now();
    meta.lastCacheRead = Number(stats.usage?.['cache_read_input_tokens'] ?? 0) || 0;
    persist();
  }
  onStats?.(stats);
}

/**
 * Run one turn, rotating across the token pool on rate-limit and healing a dead resume.
 *
 * Two independent failure paths are woven together here:
 *   - RATE LIMIT (token quota exhausted): the attempt returns `rateLimited` with no text. Cooldown
 *     that token, add it to `tried`, and re-run the SAME turn — resuming the SAME session id — on
 *     the next token. Because the transcript is on disk, the conversation continues uninterrupted.
 *   - DEAD RESUME (session id gone after a rebuild): the attempt THROWS. Heal once by dropping the
 *     stored id and retrying fresh on the SAME token (not counted against the pool).
 * Gives up (throws AllTokensLimitedError) only when every token has been tried and limited.
 */
async function runWithRotation(
  chatId: number,
  key: SessionKey,
  carrierId: string,
  userPrompt: TurnContent,
  resume: string | undefined,
): Promise<QueryOutcome> {
  const tried = new Set<string>();
  let useResume = resume;
  for (;;) {
    // Fast-fail the whole-pool-exhausted case: if EVERY token is cooling down and the soonest reset
    // is still far off, don't spawn a doomed CLI (a burst of queued turns would otherwise fire N
    // failed queries each, hammering an already-limited API). A near reset still gets a best-effort
    // attempt — the subscription window may have cleared early.
    const soon = soonestRecovery();
    if (soon !== null && soon - Date.now() > ALL_LIMITED_FASTFAIL_MS) throw new AllTokensLimitedError(soon);
    const t = pickToken(tried);
    if (!t) throw new AllTokensLimitedError(soonestRecovery());
    try {
      const res = await runQuery(chatId, key, carrierId, userPrompt, useResume, t.token);
      if (res.rateLimited) {
        markLimited(t.token, res.resetsAt);
        tried.add(t.token);
        // Resume whatever session THIS attempt established (init stores it even when the turn then
        // rate-limits) so the next token CONTINUES the transcript instead of re-running from the
        // user prompt — otherwise a write tool that already fired on this token runs again on the
        // next one. Falls back to the incoming resume for the degenerate no-init case.
        useResume = sessions.get(key)?.id ?? useResume;
        if (tokenCount() > 1) console.log(`[${key}] ${t.label} limited — rotating token`);
        continue;
      }
      return res;
    } catch (err) {
      if (useResume) {
        console.error(`[${key}] resume of ${useResume} failed — retrying fresh:`, err instanceof Error ? err.message : err);
        sessions.delete(key);
        persist();
        useResume = undefined;
        continue; // same token, fresh session — not a token failure
      }
      throw err;
    }
  }
}

async function runQuery(
  chatId: number,
  key: SessionKey,
  carrierId: string,
  userPrompt: TurnContent,
  resume: string | undefined,
  authToken: string,
): Promise<QueryOutcome> {
  const q = query({
    prompt: typeof userPrompt === 'string' ? userPrompt : asUserMessage(userPrompt),
    options: {
      // options.env REPLACES the subprocess env entirely — spread process.env so PATH/HOME/IS_SANDBOX
      // survive, then pin THIS turn's token. That is how one gateway drives several subscriptions.
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: authToken },
      model: config.model,
      systemPrompt: systemPrompt(),
      mcpServers: { octane: buildOctaneServer(chatId, carrierId), telegram: buildTelegramServer(chatId) },
      allowedTools: [
        'mcp__octane__telegram_progress',
        'mcp__octane__octane_whoami',
        'mcp__octane__octane_kb_search',
        'mcp__octane__octane_card_status',
        'mcp__octane__octane_funds',
        'mcp__octane__octane_txn_report',
        'mcp__octane__octane_transactions',
        'mcp__octane__octane_override',
        'mcp__octane__octane_money_code_quote',
        'mcp__octane__octane_money_code',
        'mcp__octane__octane_card_action',
        'mcp__octane__octane_card_limits',
        'mcp__octane__octane_card_info',
        'mcp__octane__octane_invoice',
        'mcp__octane__octane_balance_dm',
        'mcp__octane__octane_manual_code',
        'mcp__octane__octane_service_request',
        'mcp__octane__octane_tracking',
        'mcp__octane__octane_last_used',
        'mcp__octane__octane_payment_status',
        'mcp__octane__octane_billing_form',
        'mcp__telegram__telegram_read_image',
        'mcp__octane__telegram_react',
        'mcp__octane__telegram_buttons',
      ],
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      // Skills (.claude/skills under the gateway cwd): the CS playbook, reply style, mini-app
      // helpdesk map, and the grounded KB — each self-contained in its SKILL.md (Read stays
      // disallowed, so a skill must never rely on supporting files).
      settingSources: ['project'],
      skills: ['octane-customer-service', 'octane-communication', 'octane-miniapp-support', 'octane-kb'],
      permissionMode: 'bypassPermissions',
      maxTurns: 8,
      ...(resume ? { resume } : {}),
    },
  });
  let finalText = '';
  let stats: TurnStats = { durationMs: 0, numTurns: 0, usage: null, isError: false };
  // Rate-limit signals collected across the stream. The rejected `rate_limit_event` is the
  // definitive "quota exhausted" (it also carries resetsAt); an assistant `error: 'rate_limit'`
  // is the fallback signal. Only acted on when the turn produced no text — a mid-turn retry that
  // then SUCCEEDS should deliver its answer, not rotate.
  let sawRateLimit = false;
  let resetsAt: number | undefined;
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      const prev = sessions.get(key);
      if (prev && prev.id === msg.session_id) {
        prev.lastAt = Date.now();
      } else {
        sessions.set(key, { id: msg.session_id, startedAt: Date.now(), lastAt: Date.now(), turns: 0, lastCacheRead: 0 });
      }
      persist();
    }
    if (msg.type === 'rate_limit_event' && msg.rate_limit_info.status === 'rejected') {
      sawRateLimit = true;
      resetsAt = msg.rate_limit_info.resetsAt ?? resetsAt;
    }
    if (msg.type === 'assistant' && msg.error === 'rate_limit') sawRateLimit = true;
    if (msg.type === 'result') {
      finalText = msg.subtype === 'success' ? msg.result : '';
      const r = msg as unknown as Record<string, unknown>;
      if (Number(r['api_error_status'] ?? 0) === 429) sawRateLimit = true;
      stats = {
        durationMs: Number(r['duration_ms'] ?? 0) || 0,
        numTurns: Number(r['num_turns'] ?? 0) || 0,
        usage: (r['usage'] as Record<string, unknown> | undefined) ?? null,
        isError: msg.subtype !== 'success',
      };
    }
  }
  return { finalText, stats, rateLimited: sawRateLimit && !finalText.trim(), resetsAt };
}
