/**
 * The turn brief — everything dynamic the orchestrator/child needs, packed into the HUMAN
 * message so the system prompts stay byte-stable (prompt-prefix caching). Includes a compact
 * summary of the last few turns when the thread is not checkpointer-backed.
 */
import { messageStore } from '../chat/messageStore.js';
import type { TenantContext } from '../../types/tenantContext.js';

// Char heuristics on purpose (not tiktoken): every dynamic block here is hard-capped and
// one-directional, so real token counting would add WASM init + per-call cost with no
// enforcement gain at these sizes. Revisit only if history budgets grow substantially.
const MAX_HISTORY_CHARS = 3600; // ≈900 tokens — cheap mechanical trim, no extra LLM call
const RECENT_TURNS = 3;

function compact(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/** Mechanically-compressed recent history (user/assistant only — tool noise dropped). */
export async function recentHistorySummary(
  ctx: TenantContext,
  conversationId: string,
): Promise<string> {
  const history = await messageStore.loadHistory(ctx, conversationId);
  const turns: string[] = [];
  for (const msg of history) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (!text) continue;
    turns.push(`${msg.role}: ${compact(text, 600)}`);
  }
  const recent = turns.slice(-RECENT_TURNS * 2);
  const joined = recent.join('\n');
  return joined.length > MAX_HISTORY_CHARS ? joined.slice(-MAX_HISTORY_CHARS) : joined;
}

export interface TurnBriefInput {
  message: string;
  userName?: string;
  departments: string[];
  historySummary?: string;
}

/** The human message for a turn: identity/date context + optional history + the request. */
export function buildTurnBrief(input: TurnBriefInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts = [
    `[context] date: ${today}` +
      (input.userName ? `; user: ${input.userName}` : '') +
      (input.departments.length > 0 ? `; departments: ${input.departments.join(', ')}` : ''),
  ];
  if (input.historySummary) {
    parts.push(`[recent conversation]\n${input.historySummary}`);
  }
  parts.push(input.message);
  return parts.join('\n\n');
}
