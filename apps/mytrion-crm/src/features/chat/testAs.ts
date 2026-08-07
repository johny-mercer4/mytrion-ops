/**
 * "Test as" — a CHAT-SCOPED act-as target, deliberately separate from the per-Mytrion "View as"
 * store in api/impersonation.ts.
 *
 * Testing Horizon's RBAC means running one agent turn as another Zoho user. Reusing "View as" would
 * also re-scope every other admin panel (Knowledge Base, User Management, the databases) to that
 * user for as long as it is set, which is not what you want while probing the assistant. This slot
 * only ever reaches the chat endpoints.
 *
 * Only `x-act-as-zoho-user-id` is sent. The backend looks the target's real name/profile/role up in
 * the CRM directory (actAsDirectory) and resolves their department grant with the same resolver a
 * real login uses, so the answer is bounded by the TARGET's authority — a forged profile/role header
 * cannot mint authority, and those legacy headers are ignored server-side anyway.
 *
 * Persisted so a reload keeps the test identity, and mirrored in a module cache so the non-React
 * transport layer can read it synchronously.
 */

export interface ChatTestAs {
  zohoUserId: string;
  name: string;
  profile?: string;
  role?: string;
}

const KEY = 'octane.chatTestAs.v1';

let cache: ChatTestAs | null | undefined;

function parse(value: unknown): ChatTestAs | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Partial<ChatTestAs>;
  return o.zohoUserId && o.name ? (o as ChatTestAs) : null;
}

export function getChatTestAs(): ChatTestAs | null {
  if (cache !== undefined) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? parse(JSON.parse(raw)) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function setChatTestAs(target: ChatTestAs | null): void {
  cache = target;
  try {
    if (target) localStorage.setItem(KEY, JSON.stringify(target));
    else localStorage.removeItem(KEY);
  } catch {
    /* module cache still drives this tab */
  }
}

/**
 * The act-as header for a chat turn, or `{}` when testing as yourself. Sent only from the chat
 * transport — never from the shared `authHeaders()`, so no other admin request is affected.
 */
export function chatTestAsHeaders(): Record<string, string> {
  const target = getChatTestAs();
  return target ? { 'x-act-as-zoho-user-id': target.zohoUserId } : {};
}
