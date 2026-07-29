/**
 * Asia/Tashkent (UTC+5, no DST) helpers for attendance punches and overnight shift day bucketing.
 *
 * Hikvision / servercrm send wall-clock times without a TZ marker — they are UZB local.
 */

export const UZB_TZ = 'Asia/Tashkent';
/** Fixed offset — Tashkent has no DST. */
export const UZB_OFFSET_MS = 5 * 60 * 60 * 1000;

const HH_MM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidHhMm(value: string): boolean {
  return HH_MM.test(value.trim());
}

/** Parse `HH:mm` → minutes since midnight. */
export function hhMmToMinutes(value: string): number {
  const m = HH_MM.exec(value.trim());
  if (!m) throw new Error(`Invalid HH:mm: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Parse a device datetime as UZB wall-clock → UTC `Date`.
 * Accepts `YYYY-MM-DD HH:mm:ss`, `YYYY-MM-DDTHH:mm:ss`, or ISO with Z (then used as-is).
 */
export function parseUzbWallClock(raw: string): Date {
  const s = raw.trim();
  if (!s) throw new Error('Empty datetime');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${raw}`);
    return d;
  }
  const normalized = s.replace(' ', 'T').replace(/\.\d+$/, '');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!m) throw new Error(`Unrecognized datetime: ${raw}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = Number(m[6] ?? 0);
  // UZB local → UTC by subtracting +5h.
  const utcMs = Date.UTC(y, mo - 1, day, h, mi, sec) - UZB_OFFSET_MS;
  return new Date(utcMs);
}

/** Format a UTC instant as `YYYY-MM-DD` in Asia/Tashkent. */
export function uzbDateString(utc: Date): string {
  const local = new Date(utc.getTime() + UZB_OFFSET_MS);
  const y = local.getUTCFullYear();
  const mo = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Minutes since UZB midnight for a UTC instant. */
export function uzbMinutesSinceMidnight(utc: Date): number {
  const local = new Date(utc.getTime() + UZB_OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Attendance work date for a punch.
 * Overnight shifts (end < start): times before end_local belong to the previous calendar day.
 */
export function workDateForPunch(
  punchedAtUtc: Date,
  shift: { startLocal: string; endLocal: string } | null,
): string {
  const cal = uzbDateString(punchedAtUtc);
  if (!shift) return cal;
  const startM = hhMmToMinutes(shift.startLocal);
  const endM = hhMmToMinutes(shift.endLocal);
  if (endM > startM) return cal; // same-day shift
  const mins = uzbMinutesSinceMidnight(punchedAtUtc);
  // After midnight and before shift end → previous UZB calendar day.
  if (mins < endM) {
    const prev = new Date(punchedAtUtc.getTime() + UZB_OFFSET_MS - 24 * 60 * 60 * 1000);
    const y = prev.getUTCFullYear();
    const mo = String(prev.getUTCMonth() + 1).padStart(2, '0');
    const d = String(prev.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return cal;
}

/** Classify door name → check_in / check_out / null (unknown). */
export function doorKind(doorName: string): 'check_in' | 'check_out' | null {
  const d = doorName.toLowerCase();
  const isExit = d.includes('exit') || d.includes('out');
  if (isExit) return 'check_out';
  const isEntry = d.includes('entry') || d.includes('main') || d.includes('in');
  if (isEntry) return 'check_in';
  return null;
}

/** Sat/Sun in UZB for a `YYYY-MM-DD` date string. */
export function isUzbWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return false;
  // Noon UTC on that calendar date ≈ safe weekday in UZB (+5).
  const utc = Date.UTC(y, m - 1, d, 12, 0, 0) - UZB_OFFSET_MS;
  const local = new Date(utc + UZB_OFFSET_MS);
  const dow = local.getUTCDay(); // 0=Sun … 6=Sat
  return dow === 0 || dow === 6;
}

/** Inclusive list of `YYYY-MM-DD` from `from` to `to` (UZB calendar strings). */
export function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${mo}-${day}`);
  }
  return out;
}

/** Monday–Sunday week containing `anchor` (`YYYY-MM-DD`). */
export function weekRangeContaining(anchor: string): { from: string; to: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${anchor}`);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const local = new Date(utcNoon);
  const dow = local.getUTCDay(); // 0 Sun
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

export function formatUzbHhMmSs(utc: Date): string {
  const local = new Date(utc.getTime() + UZB_OFFSET_MS);
  const h = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  const s = String(local.getUTCSeconds()).padStart(2, '0');
  return `${h}:${mi}:${s}`;
}

export function formatDurationHours(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return '00:00';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
