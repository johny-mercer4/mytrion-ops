/**
 * Shared, pure helpers for the four write dialogs. No React, no fetch — covered directly by
 * `actionsModel.test.ts`, because the money parser and the schedule preview are the two places a
 * quiet bug turns into a wrong number on a payment agreement.
 */
import type { PlanFrequency } from '@/api/collectionDesk';

/**
 * Normalise a typed amount into the decimal STRING the API takes, or null when it is not money.
 *
 * Never returns a number. The wire format is a string all the way to Postgres `numeric`; parsing
 * to a float here and re-serialising is exactly how a cent goes missing on a $26,120.15 write-off.
 * Accepts what a person types — `$2,400`, `2400`, `2400.5` — and rejects what they mistype.
 */
export function moneyInput(raw: string): string | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return cleaned.includes('.') ? cleaned : `${cleaned}.00`;
}

/** Today as `YYYY-MM-DD` in the viewer's own timezone — a due date is a local calendar day. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** `todayIso()` shifted by whole days. Used for the plan's default first payment. */
export function isoPlusDays(days: number): string {
  const base = new Date(`${todayIso()}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export interface ScheduledInstalment {
  seq: number;
  dueDate: string;
  amount: string;
  balanceAfter: string;
}

/**
 * The schedule preview shown before a plan is saved.
 *
 * Mirrors `collectionPlanRepo.scheduleDates` on the server, including the month-end clamp — a
 * plan starting on the 31st bills on the 28th in February rather than rolling into March. The
 * duplication is deliberate and narrow: the preview must be exact before anything is written, and
 * a round trip per keystroke to compute twelve dates is not a trade worth making. The server
 * remains the authority; `actionsModel.test.ts` pins the two to the same cases.
 */
export function previewSchedule(input: {
  amount: string;
  count: number;
  frequency: PlanFrequency;
  firstPaymentDate: string;
  outstanding: number;
}): ScheduledInstalment[] {
  const start = new Date(`${input.firstPaymentDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const per = Number(input.amount);
  if (!Number.isFinite(per)) return [];
  const out: ScheduledInstalment[] = [];
  let balance = input.outstanding;
  for (let i = 0; i < input.count; i += 1) {
    let due: Date;
    if (input.frequency === 'monthly') {
      const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate();
      target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
      due = target;
    } else {
      due = new Date(start.getTime());
      due.setUTCDate(due.getUTCDate() + (input.frequency === 'weekly' ? 7 : 14) * i);
    }
    balance = Math.max(0, balance - per);
    out.push({
      seq: i + 1,
      dueDate: due.toISOString().slice(0, 10),
      amount: per.toFixed(2),
      balanceAfter: balance.toFixed(2),
    });
  }
  return out;
}

/**
 * Does the plan actually clear the debt? Returns the shortfall, or 0 when it does.
 *
 * A plan that leaves money on the table is legitimate — a partial settlement is a real outcome —
 * but it must be stated, not discovered eleven months later.
 */
export function planShortfall(outstanding: number, amount: string, count: number): number {
  const per = Number(amount);
  if (!Number.isFinite(per) || count <= 0) return outstanding;
  return Math.max(0, Math.round((outstanding - per * count) * 100) / 100);
}
