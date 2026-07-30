const TASHKENT_TIMEZONE = 'Asia/Tashkent';

export function tashkentToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Monday–Sunday UZB week containing `anchor` (YYYY-MM-DD), matching the API. */
export function weekRangeContaining(anchor: string): { from: string; to: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  const utcNoon = Date.UTC(y!, m! - 1, d!, 12, 0, 0);
  const dow = new Date(utcNoon).getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(utcNoon + mondayOffset * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const fmt = (dt: Date): string => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { from: fmt(mon), to: fmt(sun) };
}
