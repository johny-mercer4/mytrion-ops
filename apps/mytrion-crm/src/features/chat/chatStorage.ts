/**
 * Last-open-conversation persistence (per user) so a widget reload restores the transcript.
 * Same try/catch localStorage posture as api/session.ts — storage failures are non-fatal.
 */
const keyFor = (zohoUserId: string) => `mytrion.chat.last:${zohoUserId}`;

export function getLastConversationId(zohoUserId: string | null | undefined): string | null {
  if (!zohoUserId) return null;
  try {
    return localStorage.getItem(keyFor(zohoUserId));
  } catch {
    return null;
  }
}

export function setLastConversationId(
  zohoUserId: string | null | undefined,
  id: string | null,
): void {
  if (!zohoUserId) return;
  try {
    if (id) localStorage.setItem(keyFor(zohoUserId), id);
    else localStorage.removeItem(keyFor(zohoUserId));
  } catch {
    /* storage unavailable — restore just won't happen */
  }
}
