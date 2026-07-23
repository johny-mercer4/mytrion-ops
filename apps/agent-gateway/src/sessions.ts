/**
 * Per-chat Claude sessions — the whole point of v2. Each group chat gets its own SDK
 * session (context = that chat only); turns are serial WITHIN a chat and parallel ACROSS
 * chats. Session ids persist to disk so a gateway restart resumes conversations.
 */
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { buildOctaneServer } from './tools.js';
import { buildTelegramServer } from './telegramTools.js';
import { systemPrompt } from './prompt.js';

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

interface SessMeta {
  id: string;
  startedAt: number;
  lastAt: number;
  turns: number;
  lastCacheRead: number;
}
const sessions = new Map<number, SessMeta>();
try {
  const raw = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    // Migrate the v1 format (plain "chatId": "sessionId" strings) in place.
    if (typeof v === 'string') {
      sessions.set(Number(k), { id: v, startedAt: Date.now(), lastAt: Date.now(), turns: 0, lastCacheRead: 0 });
    } else if (v && typeof v === 'object' && typeof (v as SessMeta).id === 'string') {
      sessions.set(Number(k), v as SessMeta);
    }
  }
} catch {
  /* first boot */
}
const persist = () => writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 1));

/** Decide fresh-vs-resume for the NEXT turn. Returns the session id to resume, or undefined. */
function resumableSession(chatId: number): string | undefined {
  const m = sessions.get(chatId);
  if (!m) return undefined;
  const now = Date.now();
  const due = m.turns >= MAX_TURNS || now - m.startedAt > MAX_AGE_MS || m.lastCacheRead > ROTATE_CACHE_TOKENS;
  const midConversation = now - m.lastAt < QUIET_GAP_MS;
  if (due && !midConversation) {
    console.log(`[chat ${chatId}] session rotated (turns=${m.turns}, ageH=${((now - m.startedAt) / 3600_000).toFixed(1)}, cacheRead=${m.lastCacheRead})`);
    sessions.delete(chatId);
    persist();
    return undefined;
  }
  return m.id;
}

/** Per-chat serial queue: a chat's turns never overlap; different chats run in parallel. */
const chains = new Map<number, Promise<void>>();

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

export function enqueueTurn(
  chatId: number,
  carrierId: string,
  userPrompt: TurnContent,
  onReply: (text: string) => Promise<void>,
  onStats?: (stats: TurnStats) => void,
): void {
  const prev = chains.get(chatId) ?? Promise.resolve();
  const next = prev
    .then(() => runTurn(chatId, carrierId, userPrompt, onReply, onStats))
    .catch(async (err) => {
      console.error(`[chat ${chatId}] turn failed`, err);
      onStats?.({ durationMs: 0, numTurns: 0, usage: null, isError: true, errMsg: err instanceof Error ? err.message : String(err) });
      // A terminal error (e.g. SDK auth/init failure) used to leave the tagged user with total
      // silence, which reads as "the bot is dead" — worst for exactly the person who engaged.
      // Send one short bilingual fallback so a broken turn is visible, not invisible. Best-effort:
      // if even the send fails, swallow it (the queue must keep draining for the next turn).
      try {
        await onReply(
          '⚠️ Hozir javob bera olmadim — birozdan keyin qayta urinib ko‘ring. / ' +
            "Couldn't answer just now — please try again shortly.",
        );
      } catch {
        /* send failed too — nothing more to do */
      }
    });
  chains.set(chatId, next);
}

async function runTurn(
  chatId: number,
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
  const firstResume = resumableSession(chatId);
  let outcome: { finalText: string; stats: TurnStats };
  try {
    outcome = await runQuery(chatId, carrierId, userPrompt, firstResume);
  } catch (err) {
    if (!firstResume) throw err;
    console.error(`[chat ${chatId}] resume of ${firstResume} failed — retrying with a fresh session:`, err instanceof Error ? err.message : err);
    sessions.delete(chatId);
    persist();
    outcome = await runQuery(chatId, carrierId, userPrompt, undefined);
  }
  const { finalText, stats } = outcome;
  const text = finalText.trim();
  // SILENCE is a valid outcome (anti-spam rules) — only deliver real replies.
  if (text && text !== 'SILENT') await onReply(text.slice(0, 4000));
  // Rotation bookkeeping: turn count + the context-size signal (cache_read of this turn).
  const meta = sessions.get(chatId);
  if (meta) {
    meta.turns += 1;
    meta.lastAt = Date.now();
    meta.lastCacheRead = Number(stats.usage?.['cache_read_input_tokens'] ?? 0) || 0;
    persist();
  }
  onStats?.(stats);
}

async function runQuery(
  chatId: number,
  carrierId: string,
  userPrompt: TurnContent,
  resume: string | undefined,
): Promise<{ finalText: string; stats: TurnStats }> {
  const q = query({
    prompt: typeof userPrompt === 'string' ? userPrompt : asUserMessage(userPrompt),
    options: {
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
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      const prev = sessions.get(chatId);
      if (prev && prev.id === msg.session_id) {
        prev.lastAt = Date.now();
      } else {
        sessions.set(chatId, { id: msg.session_id, startedAt: Date.now(), lastAt: Date.now(), turns: 0, lastCacheRead: 0 });
      }
      persist();
    }
    if (msg.type === 'result') {
      finalText = msg.subtype === 'success' ? msg.result : '';
      const r = msg as unknown as Record<string, unknown>;
      stats = {
        durationMs: Number(r['duration_ms'] ?? 0) || 0,
        numTurns: Number(r['num_turns'] ?? 0) || 0,
        usage: (r['usage'] as Record<string, unknown> | undefined) ?? null,
        isError: msg.subtype !== 'success',
      };
    }
  }
  return { finalText, stats };
}
