/**
 * Multi-chat: group -> carrier resolution, DB-backed (mytrion support_bot_chats) with the old
 * OCTANE_GROUP_CHAT_ID / OCTANE_CARRIER_ID env pair kept only as an MVP fallback.
 *
 * AUTO-BIND: an UNMAPPED group may be connected by an ACTIVE owner/manager, but only after that
 * exact Telegram user confirms the server-resolved company with an inline button. Preview is
 * read-only; confirm writes support_bot_chats, which is also the Mytrion CRM Bot Group source.
 */
import { config } from './config.js';
import { supportBotHeaders } from './octaneClient.js';

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
let refreshInFlight: Promise<void> | null = null;

setInterval(() => {
  const cutoff = Date.now() - BIND_COOLDOWN_MS;
  for (const [chatId, attemptedAt] of bindTried) {
    if (attemptedAt < cutoff) bindTried.delete(chatId);
  }
}, BIND_COOLDOWN_MS).unref();

async function refresh(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < REFRESH_MS) return;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${config.octaneBase}/v1/support-bot/chat-map`, {
        headers: supportBotHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { chats?: Array<{ chatId: string; carrierId: string }> };
        const chats = data.chats ?? [];
        if (chats.length > config.maxManagedGroups) {
          throw new Error(`chat map exceeds MAX_MANAGED_GROUPS=${config.maxManagedGroups}`);
        }
        map = new Map(chats.map((chat) => [chat.chatId, chat.carrierId]));
        fetchedAt = Date.now();
      }
    } catch {
      /* backend blip — keep serving the stale map */
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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
  if (Date.now() - fetchedAt <= config.chatMapStaleGraceMs && hit) return hit;
  if (
    config.allowLegacyChatFallback &&
    config.groupChatId &&
    String(chatId) === config.groupChatId &&
    config.carrierId
  ) return config.carrierId;
  if (Date.now() - fetchedAt > config.chatMapStaleGraceMs) return null;
  return null;
}

export interface AutoBindPreview {
  carrierId: string;
  companyName: string | null;
  profile: 'owner' | 'manager';
}

/** Read-only lookup used to render the company confirmation; it never creates a group mapping. */
export async function previewAutoBind(
  userId: number,
): Promise<AutoBindPreview | null> {
  try {
    const res = await fetch(`${config.octaneBase}/v1/support-bot/chat-map/auto-bind/preview`, {
      method: 'POST',
      headers: supportBotHeaders(true),
      body: JSON.stringify({ telegramUserId: String(userId) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      carrierId?: unknown;
      companyName?: unknown;
      profile?: unknown;
    };
    if (
      typeof data.carrierId !== 'string' ||
      (data.profile !== 'owner' && data.profile !== 'manager')
    ) return null;
    return {
      carrierId: data.carrierId,
      companyName: typeof data.companyName === 'string' ? data.companyName : null,
      profile: data.profile,
    };
  } catch {
    return null;
  }
}

/** Cooldown for asking the same unmapped group to confirm again. */
export function canPromptAutoBind(chatId: number): boolean {
  const last = bindTried.get(chatId) ?? 0;
  if (Date.now() - last < BIND_COOLDOWN_MS) return false;
  bindTried.set(chatId, Date.now());
  return true;
}

export function releaseAutoBindPrompt(chatId: number): void {
  bindTried.delete(chatId);
}

/** Mutating half: called only after the requesting owner/manager taps the bound Yes button. */
export async function confirmAutoBind(
  chatId: number,
  userId: number,
): Promise<{ carrierId: string; companyName: string | null; bound: boolean } | null> {
  try {
    const res = await fetch(`${config.octaneBase}/v1/support-bot/chat-map/auto-bind`, {
      method: 'POST',
      headers: supportBotHeaders(true),
      body: JSON.stringify({ chatId: String(chatId), telegramUserId: String(userId) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      carrierId?: string;
      bound?: boolean;
      companyName?: string | null;
    };
    if (!data.carrierId) return null;
    if (!map.has(String(chatId)) && map.size >= config.maxManagedGroups) return null;
    map.set(String(chatId), data.carrierId);
    bindTried.delete(chatId);
    return {
      carrierId: data.carrierId,
      companyName: data.companyName ?? null,
      bound: data.bound === true,
    };
  } catch {
    return null;
  }
}
