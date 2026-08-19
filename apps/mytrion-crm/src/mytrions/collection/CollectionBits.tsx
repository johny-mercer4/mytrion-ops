/**
 * The six pieces this desk needed and the design system does not have.
 *
 * Everything here composes tokens and `@/ds` primitives — none of it invents a colour, a radius
 * or a control. They live together because they are read together: five of the six appear on the
 * worklist row, and four of them on the case record.
 */
import type { ReactNode } from 'react';
import { Badge, Icon, type BadgeIntent, type IconName } from '@/ds';
import type { ContactChannel, Metro2Field, PlanProgress } from '@/api/collectionDesk';
import { findCollectionTab, type CollectionTabId } from './collectionNav';
import { money } from './collectionFormat';

/** Kicker → title → sub, matching every other Mytrion's page head. */
export function CollectionPageHead({
  tab,
  actions,
}: {
  tab: CollectionTabId;
  actions?: ReactNode;
}) {
  const meta = findCollectionTab(tab);
  return (
    <header className="co-head">
      <div>
        <div className="co-kicker">Recovery</div>
        <h1 className="co-title">{meta.label}</h1>
        <p className="co-sub">{meta.description}</p>
      </div>
      {actions ? <div className="co-head-actions">{actions}</div> : null}
    </header>
  );
}

/**
 * AGING METER — four bands (0–30 · 30–90 · 90–180 · 180+), filled to where the debt sits.
 *
 * It repeats the number beside it ON PURPOSE. A column of raw day counts cannot be scanned, and
 * colour alone is not a channel: the digits stay, the meter is what makes the column readable at
 * a glance. Band edges come from the server's DESK_POLICY, so the meter and the lanes agree.
 */
export function AgingMeter({ days, bands }: { days: number; bands?: readonly number[] }) {
  const edges = bands ?? [30, 90, 180];
  const filled = edges.reduce((n, edge) => (days >= edge ? n + 1 : n), 1);
  const tone = filled >= 4 ? 'bad' : filled === 3 ? 'hot' : filled === 2 ? 'warn' : 'ok';
  return (
    <span
      className="co-aging"
      data-tone={tone}
      role="img"
      aria-label={`${days} days past due`}
      title={`${days} days past due`}
    >
      {[0, 1, 2, 3].map((i) => (
        <i key={i} data-on={i < filled ? 'true' : undefined} />
      ))}
    </span>
  );
}

/** The day count and its meter as one cell — the pairing is the point, so it ships as a unit. */
export function AgeCell({ days, bands }: { days: number; bands?: readonly number[] }) {
  const tone = days >= 180 ? 'bad' : days >= 90 ? 'warn' : undefined;
  return (
    <span className="co-age">
      <span className="num" data-tone={tone}>
        {days}d
      </span>
      <AgingMeter days={days} {...(bands ? { bands } : {})} />
    </span>
  );
}

/**
 * RECOVERY BAR — one invoiced total split three ways.
 *
 * Scheduled-on-plan is NOT recovered and never shares the paid colour: money a debtor has agreed
 * to pay and money that has arrived are different facts, and the whole reason this bar exists is
 * that reading them off three separate figures made people subtract by hand.
 */
export function RecoveryBar({
  invoiced,
  paid,
  scheduled,
  height = 10,
  legend = false,
}: {
  invoiced: number;
  paid: number;
  scheduled: number;
  height?: number;
  legend?: boolean;
}) {
  const total = Math.max(invoiced, paid + scheduled, 1);
  const pct = (n: number): string => `${Math.max(0, Math.min(100, (n / total) * 100)).toFixed(1)}%`;
  const outstanding = Math.max(0, invoiced - paid - scheduled);
  return (
    <div className="co-recovery">
      <div
        className="co-recbar"
        style={{ height }}
        role="img"
        aria-label={`${money(paid)} paid, ${money(scheduled)} scheduled, ${money(outstanding)} outstanding of ${money(invoiced)} invoiced`}
      >
        <i data-part="paid" style={{ width: pct(paid) }} />
        <i data-part="plan" style={{ width: pct(scheduled) }} />
        <i data-part="open" style={{ width: pct(outstanding) }} />
      </div>
      {legend ? (
        <div className="co-legend">
          <span>
            <i data-part="paid" />
            Paid <b className="num">{money(paid)}</b>
          </span>
          <span>
            <i data-part="plan" />
            Scheduled on plan <b className="num">{money(scheduled)}</b>
          </span>
          <span>
            <i data-part="open" />
            Unscheduled <b className="num">{money(outstanding)}</b>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * PROMISE CHIP — a dated commitment, which is not a status.
 *
 * Dashed border so it never reads as a settled fact, and it flips to danger the day it lapses.
 * A promise deliberately does NOT live in the stage badge: a case on a payment plan can carry an
 * open promise for this month's instalment and the two mean different things.
 */
export function PromiseChip({
  amount,
  dueDate,
  daysLate,
}: {
  amount: string;
  dueDate: string;
  daysLate: number;
}) {
  const late = daysLate > 0;
  const when = late
    ? `${daysLate}d late`
    : daysLate === 0
      ? 'due today'
      : `due ${new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  return (
    <span className="co-promise" data-late={late ? 'true' : undefined}>
      <Icon name={late ? 'warning' : 'schedule'} size="sm" />
      <span className="num">
        {money(amount)} · {when}
      </span>
    </span>
  );
}

const METRO2_LABEL: Record<Metro2Field, string> = {
  dateOfBirth: 'Date of birth',
  address: 'Address',
  mcDot: 'MC / DOT',
  firstDelinquency: 'Date of first delinquency',
};

/**
 * READINESS DOTS — the four Metro 2 fields a filing needs, in a fixed order.
 *
 * NEVER the only signal: the caller always names the blocking field in words beside it. The
 * order is the server's `metro2Fields`, passed through rather than re-derived, so a column of
 * these is scannable down the page.
 */
export function ReadinessDots({
  fields,
  readiness,
}: {
  fields: readonly Metro2Field[];
  readiness: Record<Metro2Field, boolean>;
}) {
  const missing = fields.filter((f) => !readiness[f]);
  const label =
    missing.length === 0
      ? 'All four Metro 2 fields present'
      : `Missing: ${missing.map((f) => METRO2_LABEL[f]).join(', ')}`;
  return (
    <span className="co-dots" role="img" aria-label={label} title={label}>
      {fields.map((f) => (
        <i key={f} data-missing={readiness[f] ? undefined : 'true'} />
      ))}
    </span>
  );
}

/** Instalment pips — paid, missed, still to come. The plan's whole state in one strip. */
export function PlanPips({ progress }: { progress: PlanProgress }) {
  const cells = Array.from({ length: progress.total }, (_, i) => {
    if (i < progress.paid) return 'paid';
    if (i < progress.paid + progress.missed) return 'missed';
    return 'due';
  });
  return (
    <span
      className="co-pips"
      role="img"
      aria-label={`${progress.paid} paid, ${progress.missed} missed, ${progress.total - progress.paid - progress.missed} to come`}
    >
      {cells.map((state, i) => (
        <i key={i} data-state={state} />
      ))}
    </span>
  );
}

const CHANNEL_ICON: Record<ContactChannel, IconName> = {
  call: 'call',
  email: 'mail',
  sms: 'chat',
  letter: 'description',
};

/**
 * LAST TOUCH — how long since anyone reached out, and how.
 *
 * `Never` is not zero and must not render as a number: a case nobody has ever contacted is a
 * different problem from one contacted this morning, and a `0d` would hide it.
 */
export function LastTouch({
  days,
  channel,
  silentAfter = 30,
}: {
  days: number | null;
  channel: ContactChannel | null;
  silentAfter?: number;
}) {
  if (days === null) {
    return <span className="co-touch" data-tone="never">Never</span>;
  }
  return (
    <span className="co-touch" data-tone={days >= silentAfter ? 'stale' : undefined}>
      {channel ? <Icon name={CHANNEL_ICON[channel]} size="sm" /> : null}
      <span className="num">{days}d</span>
    </span>
  );
}

/** A labelled figure — the fact strip on the case record and the worklist row's right edge. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="co-fact">
      <span className="t-eyebrow">{label}</span>
      <span className="co-fact-v">{children}</span>
    </span>
  );
}

/** Small, tinted, non-interactive — the shared shape for a lane or a placement state. */
export function StateChip({
  intent,
  icon,
  children,
}: {
  intent: BadgeIntent;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <Badge intent={intent} {...(icon ? { icon } : {})}>
      {children}
    </Badge>
  );
}
