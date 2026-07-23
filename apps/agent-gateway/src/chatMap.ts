/**
 * Multi-chat: group -> carrier resolution, DB-backed (mytrion support_bot_chats) with the old
 * OCTANE_GROUP_CHAT_ID / OCTANE_CARRIER_ID env pair kept only as an MVP fallback.
 *
 * AUTO-BIND (owner decision 2026-07-22): an UNMAPPED group binds itself the moment an ACTIVE
 * owner/manager registration writes in it — the gateway forwards the sender-verified Telegram
 * id to mytrion, which matches it against registered_mini_app_companies and creates the
 * mapping. No env edit, no admin step, no redeploy. A group with no registered owner never
 * binds (and never gets tokens). Per-chat cooldown keeps a chatty unmapped group from
 * hammering the backend.
 */
import { config } from './config.js';

const REFRESH_MS = 5 * 60_000;
const BIND_COOLDOWN_MS = 60_000;
/** Miss-driven refresh floor: an unmapped chat's message may re-pull the map at most this often —
 * so a mapping saved in the CRM lands on the very NEXT message (on-time, no 5-min wait), while a
 * spammy unknown group can't turn the map fetch into a hot loop. */
const MISS_REFRESH_MS = 15_000;

let map = new Map<string, string>();
let fetchedAt = 0;
let lastMissRefresh = 0;
const bindTried = new Map<number, number>();

async function refresh(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < REFRESH_MS) return;
  try {
    const res = await fetch(`${config.octaneBase}/v1/support-bot/chat-map`, {
      headers: { Authorization: `Bearer ${config.octaneKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { chats?: Array<{ chatId: string; carrierId: string }> };
      map = new Map((data.chats ?? []).map((c) => [c.chatId, c.carrierId]));
      fetchedAt = Date.now();
    }
  } catch {
    /* backend blip — keep serving the stale map */
  }
}

/** How many chats are currently mapped (boot log). */
export async function chatMapSize(): Promise<number> {
  await refresh(true);
  return map.size;
}

export async function carrierFor(chatId: number): Promise<string | null> {
  await refresh();
  let hit = map.get(String(chatId));
  if (!hit && Date.now() - lastMissRefresh > MISS_REFRESH_MS) {
    // Unknown chat: the mapping may have JUST been saved in the CRM — check live before giving up.
    lastMissRefresh = Date.now();
    await refresh(true);
    hit = map.get(String(chatId));
  }
  if (hit) return hit;
  if (config.groupChatId && String(chatId) === config.groupChatId && config.carrierId) return config.carrierId;
  return null;
}

/**
 * Attempt the owner auto-bind for an unmapped group. Returns the binding ONLY when a NEW
 * mapping was created (caller announces it); an already-bound chat just refreshes the local
 * map silently. Null = sender is not a registered owner (or cooldown/backend blip).
 */
export async function tryAutoBind(
  chatId: number,
  userId: number,
): Promise<{ carrierId: string; companyName: string | null } | null> {
  const last = bindTried.get(chatId) ?? 0;
  if (Date.now() - last < BIND_COOLDOWN_MS) return null;
  bindTried.set(chatId, Date.now());
  try {
    const res = await fetch(`${config.octaneBase}/v1/support-bot/chat-map/auto-bind`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.octaneKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: String(chatId), telegramUserId: String(userId) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { carrierId?: string; bound?: boolean; companyName?: string | null };
    if (!data.carrierId) return null;
    map.set(String(chatId), data.carrierId);
    bindTried.delete(chatId);
    return data.bound ? { carrierId: data.carrierId, companyName: data.companyName ?? null } : null;
  } catch {
    return null;
  }
}
