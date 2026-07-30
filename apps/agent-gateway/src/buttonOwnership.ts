/**
 * In-memory ownership for Telegram inline-button messages.
 *
 * Telegram message ids are scoped to a chat, so the key must include both values. Entries are
 * single-use and short-lived. Unknown entries fail closed: after a restart or capacity eviction,
 * the user must request a new confirmation instead of executing an unverifiable old action.
 */
const BUTTON_OWNER_CAP = 500;
const BUTTON_TTL_MS = 10 * 60_000;

interface ButtonOwner {
  userId: number;
  expiresAt: number;
}

export type ButtonTapResult = 'allowed' | 'foreign' | 'unavailable';

const owners = new Map<string, ButtonOwner>();
const keyFor = (chatId: number, messageId: number): string => `${chatId}:${messageId}`;

export function noteButtonOwner(
  chatId: number,
  messageId: number,
  userId: number,
  now = Date.now(),
): void {
  if (owners.size >= BUTTON_OWNER_CAP) {
    const oldest = owners.keys().next().value;
    if (oldest !== undefined) owners.delete(oldest);
  }
  owners.set(keyFor(chatId, messageId), {
    userId,
    expiresAt: now + BUTTON_TTL_MS,
  });
}

/**
 * Atomically authorize and consume one tap.
 * `foreign` stays distinguishable so the caller can silently reject it without leaking ownership;
 * unknown, expired and replayed buttons share `unavailable` and may show a retry message.
 */
export function consumeButtonTap(
  chatId: number,
  messageId: number,
  userId: number,
  now = Date.now(),
): ButtonTapResult {
  const key = keyFor(chatId, messageId);
  const owner = owners.get(key);
  if (!owner) return 'unavailable';
  if (owner.expiresAt < now) {
    owners.delete(key);
    return 'unavailable';
  }
  if (owner.userId !== userId) return 'foreign';
  owners.delete(key);
  return 'allowed';
}
