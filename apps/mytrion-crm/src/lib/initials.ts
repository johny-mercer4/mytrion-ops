/**
 * Two-letter initials for an avatar.
 *
 * Hoisted here because four copies had accumulated — TopBar, MytrionShell, and hand-rolled versions
 * inside the Billing and Customer Service shells — and they did not agree on the single-word case.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
