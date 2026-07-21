/**
 * Sales Mytrion redesign — daily-goal + streak helpers over REAL per-day application counts.
 *
 * The counts come from Zoho CRM COQL (the Deals `Application_Date` field, owner-scoped) via
 * GET /v1/data-center/app-stats → a { 'YYYY-MM-DD': count } map. These pure functions derive the
 * goal-bar / streak / best-day / week values the Home tab shows. The ONLY persisted state is a tiny
 * per-user "already celebrated today" guard, so the goal/PB celebration fires at most once per day.
 */
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { nyDaysAgo, nyToday } from './salesData';

/** Applications to submit in a day to "hit goal". Product config — tune to real agent throughput
 *  (live data shows ~1–3/day). A per-rep target could replace this later. */
export const DAILY_APPS_GOAL = 3;

type DayMap = Record<string, number>;

/** Coerce a day-map cell to a finite count (JSON/number/string-safe). */
function dayCount(days: DayMap, key: string): number {
  const v = days[key];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Applications filled today (NY calendar). */
export function todayApps(days: DayMap): number {
  return dayCount(days, nyToday());
}

/** Best single-day application count in the window (personal best). */
export function topDay(days: DayMap): number {
  let best = 0;
  for (const k in days) {
    const n = dayCount(days, k);
    if (n > best) best = n;
  }
  return best;
}

/** Applications filled over the last 7 NY-calendar days. */
export function weekTotal(days: DayMap): number {
  let t = 0;
  for (let i = 0; i < 7; i++) t += dayCount(days, nyDaysAgo(i));
  return t;
}

/**
 * Consecutive days meeting the goal, ending today — or yesterday when today isn't met yet, so the
 * badge doesn't drop to zero mid-morning. A missing / below-goal day breaks the run.
 */
export function currentStreak(days: DayMap, goal: number): number {
  let streak = 0;
  for (let i = dayCount(days, nyToday()) >= goal ? 0 : 1; i < 400; i++) {
    if (dayCount(days, nyDaysAgo(i)) >= goal) streak++;
    else break;
  }
  return streak;
}

/** True when today's count strictly beats every prior day in the window (a genuine new best). */
export function isNewBest(days: DayMap): boolean {
  const today = nyToday();
  const todayCount = dayCount(days, today);
  let bestOther = 0;
  for (const k in days) {
    if (k === today) continue;
    const n = dayCount(days, k);
    if (n > bestOther) bestOther = n;
  }
  return todayCount > bestOther && bestOther > 0;
}

// ---- one-shot celebration guard (the only persisted state) ----

const CELEB_KEY = 'octane.sales.redesign.streakCeleb.v1';

function celebKey(): string {
  const uid = getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? 'anon';
  return `${CELEB_KEY}:${uid}`;
}

/**
 * Returns true at most once per NY day per kind, so a goal-hit / personal-best celebration doesn't
 * re-fire on every Home load or tab switch. Marks the kind as claimed for today when it returns true.
 */
export function claimCelebration(kind: 'goal' | 'best'): boolean {
  const key = celebKey();
  const today = nyToday();
  let rec: { date?: string; goal?: boolean; best?: boolean };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    rec = parsed && typeof parsed === 'object' ? (parsed as typeof rec) : {};
  } catch {
    rec = {};
  }
  if (rec.date !== today) rec = { date: today };
  if (rec[kind]) return false;
  rec[kind] = true;
  try {
    localStorage.setItem(key, JSON.stringify(rec));
  } catch {
    /* storage disabled — celebrate anyway (may repeat, harmless) */
  }
  return true;
}
