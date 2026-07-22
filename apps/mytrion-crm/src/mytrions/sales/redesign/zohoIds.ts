/**
 * Zoho user-id comparison across id spaces. The session id, servercrm's WS ownerId, and the
 * warehouse `agent_zoho_user_id` often share only the last 12 digits (different org prefixes) —
 * exact equality silently drops live events for the very agents they're addressed to. Mirrors
 * the backend's dwhClientRoster.zohoIdSuffix + the SQL `lpad(right(id, 12), 12, '0')`.
 */

/** Last-12-digit zoho id suffix, zero-padded to 12; '' when the id carries no digits. */
export function zohoIdSuffix(id: string): string {
  const digits = (id ?? '').replace(/\D+/g, '');
  return digits ? digits.slice(-12).padStart(12, '0') : '';
}

/** Suffix-normalized id equality; falls back to trimmed exact match when either side has no digits. */
export function zohoIdsMatch(a: string, b: string): boolean {
  const ta = (a ?? '').trim();
  const tb = (b ?? '').trim();
  if (!ta || !tb) return false;
  const sa = zohoIdSuffix(ta);
  const sb = zohoIdSuffix(tb);
  return sa && sb ? sa === sb : ta === tb;
}
