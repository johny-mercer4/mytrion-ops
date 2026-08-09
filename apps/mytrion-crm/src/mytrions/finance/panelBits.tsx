import { useState, type ReactNode } from 'react';
import { CalendarRange, ChevronDown, FileText, RefreshCw } from 'lucide-react';
import { formatCachedAt } from '../_shared/swrCache';
import { rangeLabel, rollingRange, type EfsDays, type EfsRange } from '../../api/finance';

/**
 * Finance panel primitives, and the caching contract every panel follows.
 *
 * Two things live here: the presentational atoms shared by the modal's panels (Section, Row, Badge,
 * Rollup, PanelState, statusTone) and the cache keys / staleness windows / "Updated Xs ago" control.
 * They were split across modalPanels.tsx before, which made efsPanels.tsx import its Badge from a
 * sibling panel file and pushed modalPanels past the 600-line cap.
 *
 * WHY THIS EXISTS. The modal's tab strip mounts one panel at a time, so switching tabs unmounted the
 * previous panel and remounted it later — and a plain `useLoad` refetched from scratch every time. Four
 * tab presses meant four round-trips for data that had not changed, and the money-code read is a ~7s
 * live EFS call. Every panel now goes through `useCachedLoad` (the shared SWR store), so a tab you have
 * already opened repaints from cache instantly and only revalidates in the background once its entry is
 * stale. Closing and reopening the same carrier is a cache hit too.
 *
 * The trade is that a panel can show data captured a moment ago rather than right now, which for money
 * is not a detail to leave implicit — so every cached panel states its age and offers a Refresh. That is
 * the same contract Finance → Home already makes about the EFS balance snapshot.
 *
 * KEYS MUST CARRY EVERY INPUT. A key that omits a filter serves one filter's rows under another's
 * heading — the failure looks like real data, so it is worse than a slow panel. The builders below are
 * the only place keys are constructed; do not inline a template string at a call site.
 */

/** All finance keys share this prefix so `invalidateSwrCache('finance:')` can clear the module. */
const NS = 'finance:';

export const financeKeys = {
  roster: (): string => `${NS}clients`,
  client: (carrierId: string): string => `${NS}client:${carrierId}`,
  invoices: (carrierId: string): string => `${NS}invoices:${carrierId}`,
  payments: (carrierId: string): string => `${NS}payments:${carrierId}`,
  transactions: (carrierId: string, range: string): string => `${NS}txns:${carrierId}:${range}`,
  // `rangeLabel` covers both shapes — '30d' or '2026-06-01_2026-06-30' — so a custom range gets its
  // own entry instead of colliding with whichever preset was last viewed.
  efsLoads: (carrierId: string, range: EfsRange): string =>
    `${NS}efs-loads:${carrierId}:${rangeLabel(range)}`,
  moneyCodes: (carrierId: string, range: EfsRange, status: string): string =>
    `${NS}money-codes:${carrierId}:${rangeLabel(range)}:${status}`,
  moneyCode: (codeId: string): string => `${NS}money-code:${codeId}`,
} as const;

/**
 * How long a panel's data is served without a background refetch.
 *
 * Tuned to how fast the underlying thing actually moves, not to a single house number:
 *   - `TXNS` is historical fuel activity — a settled line item never changes.
 *   - `MONEY_CODES` is the ~7s parent-wide EFS call; a code's state changes when a driver redeems it,
 *     which is minutes-to-hours, so paying that cost every 3 minutes at most is right.
 *   - `EFS_LOADS` tracks the sweep/top-up cron, which runs every 30 minutes.
 *   - `ROSTER` is 1.6 MB uncompressed (the API does not gzip), so it is the one worth holding longest.
 */
export const STALE = {
  ROSTER: 180_000,
  CLIENT: 120_000,
  INVOICES: 120_000,
  PAYMENTS: 120_000,
  TXNS: 300_000,
  EFS_LOADS: 120_000,
  MONEY_CODES: 180_000,
  MONEY_CODE: 300_000,
} as const;

/** EFS's ceiling, mirrored from the backend so the picker can refuse a too-wide span before sending. */
export const EFS_MAX_DAYS = 90;
const PRESETS: { id: EfsDays; label: string }[] = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];

/** yyyy-mm-dd for an offset from today, in LOCAL calendar terms (what a date input shows). */
function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = (): string => ymdDaysAgo(0);

/** Inclusive day count between two yyyy-mm-dd strings — 01→01 is one day. */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * '2026-07-01' → '1 Jul'. Built by hand because `new Date('2026-07-01')` is UTC midnight, which
 * renders as 30 June west of UTC — the same trap `dateOnly` documents in financeFormat.
 */
function shortDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Compact label for an applied custom range, with the year only when it isn't the current one. */
function rangeChipLabel(from: string, to: string): string {
  const year = new Date().getFullYear();
  const suffix = from.slice(0, 4) === String(year) && to.slice(0, 4) === String(year) ? '' : ` ${to.slice(0, 4)}`;
  return `${shortDay(from)} – ${shortDay(to)}${suffix}`;
}

/**
 * Window picker: three rolling presets plus a custom from/to range.
 *
 * The custom range is DRAFTED locally and only applied on submit. Firing a fetch on every keystroke
 * of a date input would send a request for each half-typed year — and these are multi-second live EFS
 * calls, so it would also mean four wasted vendor round-trips per edit.
 *
 * The 90-day ceiling is enforced here as well as server-side, so an over-wide span is a disabled
 * button with a reason rather than a round-trip that comes back 400.
 */
export function RangePicker({
  value,
  busy,
  onChange,
}: {
  value: EfsRange;
  busy: boolean;
  onChange: (range: EfsRange) => void;
}) {
  const [open, setOpen] = useState(value.kind === 'custom');
  const [from, setFrom] = useState(value.kind === 'custom' ? value.from : ymdDaysAgo(30));
  const [to, setTo] = useState(value.kind === 'custom' ? value.to : today());

  const span = from && to ? spanDays(from, to) : 0;
  const inverted = Boolean(from && to) && from > to;
  const tooWide = span > EFS_MAX_DAYS;
  const problem = inverted
    ? 'Start date is after the end date'
    : tooWide
      ? `${span} days — EFS keeps only ${EFS_MAX_DAYS}`
      : '';
  const canApply = Boolean(from && to) && !problem;

  return (
    <div className="fi-rangebar">
      <div className="fi-subbar">
        <span className="fi-subbar-l">Window</span>
        <div className={`fi-chiprow${busy ? ' is-busy' : ''}`}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="fi-chip"
              aria-pressed={value.kind === 'days' && value.days === p.id}
              onClick={() => {
                setOpen(false);
                onChange(rollingRange(p.id));
              }}
            >
              {p.label}
            </button>
          ))}
          {/* Doubles as the readout: once a range is applied the chip shows the dates, so the
              applied window is visible with the drawer shut. */}
          <button
            type="button"
            className="fi-chip fi-chip-custom"
            aria-pressed={value.kind === 'custom'}
            aria-expanded={open}
            title={value.kind === 'custom' ? `${value.from} → ${value.to}` : 'Pick an exact date range'}
            onClick={() => setOpen((o) => !o)}
          >
            <CalendarRange size={13} />
            {value.kind === 'custom' ? (
              <span className="fi-chip-dates">{rangeChipLabel(value.from, value.to)}</span>
            ) : (
              'Custom'
            )}
            <ChevronDown size={12} className="fi-chip-caret" />
          </button>
        </div>
      </div>

      {open ? (
        <form
          className="fi-daterange"
          onSubmit={(e) => {
            e.preventDefault();
            if (canApply) onChange({ kind: 'custom', from, to });
          }}
        >
          <label className="fi-daterange-f">
            <span>From</span>
            <input type="date" value={from} max={to || today()} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="fi-daterange-f">
            <span>To</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="fi-btn" disabled={!canApply || busy}>
            Apply
          </button>
          {problem ? (
            <span className="fi-daterange-err">{problem}</span>
          ) : (
            <span className="fi-daterange-n">
              {span} day{span === 1 ? '' : 's'}
            </span>
          )}
        </form>
      ) : null}
    </div>
  );
}

/**
 * "Updated 12s ago · Refresh" — the honesty half of caching.
 *
 * `revalidating` spins the icon rather than hiding the panel: the whole point of the SWR store is that
 * a refresh never blanks data that is already readable.
 */
export function CacheBar({
  cachedAt,
  revalidating,
  onRefresh,
}: {
  cachedAt: number | null;
  revalidating: boolean;
  onRefresh: () => void;
}) {
  const age = formatCachedAt(cachedAt);
  return (
    <div className="fi-cachebar">
      {age ? (
        <span className="fi-cachebar-t">
          {revalidating ? 'Refreshing…' : `Updated ${age}`}
        </span>
      ) : null}
      <button
        type="button"
        className="fi-cachebtn"
        onClick={onRefresh}
        disabled={revalidating}
        aria-label="Refresh this panel"
      >
        <RefreshCw size={12} className={revalidating ? 'fi-spin' : ''} />
        Refresh
      </button>
    </div>
  );
}
// ─── Shared bits ─────────────────────────────────────────────────────────────────────────────

/** A section: heading + label/value rows. `tone` colours the heading icon. */
export function Section({
  icon,
  title,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <section className="fi-sect">
      <div className="fi-sect-head" style={tone ? { ['--p' as string]: tone } : undefined}>
        {icon}
        {title}
      </div>
      <div className="fi-sect-body">{children}</div>
    </section>
  );
}

/** One label/value row. Empty values render an em-dash in muted rather than a blank gap. */
export function Row({
  label,
  value,
  mono,
  variant,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  /** `undefined` is explicit so callers can pass a conditional under exactOptionalPropertyTypes. */
  variant?: 'debt' | 'paid' | 'strong' | undefined;
}) {
  const raw = value == null ? '' : String(value).trim();
  const empty = raw === '';
  const cls = [
    'fi-dt-v',
    mono ? 'fi-mono' : '',
    empty ? 'fi-empty-v' : '',
    !empty && variant === 'debt' ? 'fi-debt-v' : '',
    !empty && variant === 'paid' ? 'fi-paid-v' : '',
    !empty && variant === 'strong' ? 'fi-strong-v' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="fi-dt">
      <span className="fi-dt-l">{label}</span>
      <span className={cls}>{empty ? '—' : raw}</span>
    </div>
  );
}

/** Row whose value is arbitrary content (a badge, say) rather than text. */
export function RowNode({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fi-dt">
      <span className="fi-dt-l">{label}</span>
      <span className="fi-dt-v">{children}</span>
    </div>
  );
}

/** Dot badge. One recipe; `--p` carries the hue. */
export function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span className="fi-badge" style={{ ['--p' as string]: tone }}>
      {label}
    </span>
  );
}

/**
 * Status → hue. CMP invoice statuses and payment-rail statuses share this map so the same word
 * never means two colours. Unknown values stay neutral rather than being guessed at.
 */
export function statusTone(status: string): string {
  const s = status.toUpperCase();
  if (['PAID', 'COMPLETED', 'SUCCEEDED', 'SETTLED'].includes(s)) return 'var(--fi-paid)';
  if (['PENDING', 'PARTIALLY_PAID', 'PROCESSING', 'OPEN'].includes(s)) return 'var(--fi-pending)';
  if (['FAILED', 'RETURNED', 'CANCELLED', 'DELETED', 'VOID'].includes(s)) return 'var(--fi-debt)';
  return 'var(--fi-idle)';
}

/** Debt ages: 30d+ warm, 60d+ hot. Matches how Billing talks about aged receivables. */
export function ageClass(d: number): string {
  if (d >= 60) return 'fi-num fi-age-hot';
  if (d >= 30) return 'fi-num fi-age-warm';
  return 'fi-num';
}

export function Rollup({ cells }: { cells: { label: string; value: string; variant?: 'debt' | 'paid' }[] }) {
  return (
    <div className="fi-rollup">
      {cells.map((c) => (
        <div key={c.label} className="fi-rollup-cell">
          <div className="fi-rollup-l">{c.label}</div>
          <div
            className="fi-rollup-v"
            style={
              c.variant
                ? { color: c.variant === 'debt' ? 'var(--fi-debt)' : 'var(--fi-paid)' }
                : undefined
            }
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Loading shape for the modal's data panels.
 *
 * Every PanelState body is the same three-part stack — cache bar, rollup of stat cells, then the
 * table — so the skeleton is built from those same containers (`.fi-rollup`, `.fi-tablewrap`) and
 * inherits their real geometry for free.
 *
 * It replaces a flat `.fi-sk-block`, which was 200px for every panel while the content that landed
 * measured ~380px. So each load pushed the modal body down by most of its own height at the moment
 * the data arrived — the "flicker" is a skeleton that never had the shape of the thing it stood in
 * for. Matching the geometry is what makes the swap invisible.
 */
export function PanelSkeleton() {
  return (
    <div className="fi-stack" aria-hidden>
      <div className="fi-sk fi-sk-bar" />
      <div className="fi-rollup">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="fi-rollup-cell">
            <div className="fi-sk fi-sk-txt fi-sk-lbl" />
            <div className="fi-sk fi-sk-txt fi-sk-val" />
          </div>
        ))}
      </div>
      <div className="fi-tablewrap">
        <div className="fi-sk-thead" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="fi-sk-trow" />
        ))}
      </div>
    </div>
  );
}

export function PanelState({
  loading,
  error,
  empty,
  emptyTitle,
  emptyMsg,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyTitle: string;
  emptyMsg: string;
  children: ReactNode;
}) {
  if (loading) return <PanelSkeleton />;
  if (error) return <div className="fi-error">{error}</div>;
  if (empty) {
    return (
      <div className="fi-empty">
        <FileText size={26} />
        <div className="fi-empty-title">{emptyTitle}</div>
        <p style={{ maxWidth: '46ch', lineHeight: 1.6 }}>{emptyMsg}</p>
      </div>
    );
  }
  return <>{children}</>;
}

