/**
 * Desk ticket status → accent color (aligned with zoho-octane ticketdashboard.html badges).
 * Fuzzy-matches so variants like "RnD Close" still get a closed color.
 */
export function ticketStatusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (!s) return 'var(--muted)';
  if (s === 'open') return 'var(--accent)';
  if (s.includes('stream manager')) return 'var(--accent-2)';
  if (s.includes('head of department')) return 'var(--cyan)';
  if (s.includes('c-level')) return 'var(--violet)';
  if (s.includes('escalat')) return 'var(--violet)';
  if (s.includes('hold')) return 'var(--warn)';
  if (s === 'resolved') return 'var(--ok)';
  if (s.includes('cancel')) return 'var(--danger)';
  // Closed / RnD Close / … — orange text on tinted green wash (reference Closed badge)
  if (s.includes('close')) return 'var(--orange)';
  return 'var(--muted)';
}
