/**
 * The four data panels on Verification Main.
 *
 * Split from `VerificationMain.tsx` so neither file approaches the 600-line cap and so each panel
 * can be read against the one question it answers: what is holding the desk up, where the open
 * cases sit, how long they have waited, and what has been decided.
 *
 * Every panel takes its slice of `VerificationOverview` and nothing else — no fetching, no clock,
 * no fallback rows. An empty panel renders `EmptyState`, which is a different fact from a panel
 * that failed to load; the page owns the error case.
 */
import { Avatar, Badge, Button, EmptyState, Icon, type IconName } from '@/ds';
import { initials } from '@/lib/initials';
import {
  DECISION_SLA_DAYS,
  type AgingBucket,
  type DecisionRow,
  type NeedsRow,
  type NeedsTone,
  type PipelineRow,
} from './verificationOverview';

/** The bucket ramp, best → worst. Order matches `buildOverview`'s aging array. */
const AGING_TONES = ['var(--success)', 'var(--accent)', 'var(--warning)', 'var(--danger)'] as const;

/**
 * What a queued case is waiting on, as a glyph. Paired with the reason text beside it — the icon is
 * reinforcement, never the only channel (CONVENTIONS §6).
 */
const NEED_ICON: Record<NeedsTone, IconName> = {
  danger: 'lock',
  warning: 'gavel',
  info: 'bolt',
  plain: 'account_balance',
};

/** `narrowSymbol` so a non-US locale renders $12,000 rather than US$12,000 — see VerificationMain. */
function money(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

export function NeedsTodayPanel({
  rows,
  onOpenQueue,
  onOpenCase,
}: {
  rows: readonly NeedsRow[];
  onOpenQueue: () => void;
  /** Opens the case in the Verification Case workspace — the desk's actual next action. */
  onOpenCase: (caseId: string) => void;
}) {
  return (
    <div className="vm-panel">
      <div className="vm-panel-head">
        <div className="vm-panel-lead">
          <h2 className="vm-panel-title">Needs you today</h2>
          <Badge intent="neutral" size="sm">
            {rows.length}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" iconEnd="arrow_forward" onClick={onOpenQueue}>
          Open queue
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          size="panel"
          icon="check_circle"
          title="Nothing waiting on you"
          description={`Nothing past the ${DECISION_SLA_DAYS}-day SLA and nothing in manager review.`}
        />
      ) : (
        <div>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="vm-need"
              data-tone={row.tone}
              // The row's whole job is the case behind it; Avatar contributes no name, so the
              // control carries one (CONVENTIONS §6, Avatar's docblock).
              aria-label={`Open ${row.name} — ${row.why}`}
              onClick={() => onOpenCase(row.id)}
            >
              <span className="vm-need-chip" aria-hidden="true">
                <Icon name={NEED_ICON[row.tone]} size="sm" />
              </span>
              <span className="vm-need-body">
                <span className="vm-need-name">{row.name}</span>
                <span className="vm-need-why">{row.why}</span>
              </span>
              <span className="vm-need-tail">
                <span className="vm-need-age">
                  <b className="num">{row.ageDays}d</b>
                  <span className="t-eyebrow">in queue</span>
                </span>
                {/* The owner's mark, beside the name it depicts — decorative by Avatar's contract. */}
                <span className="vm-need-avatar" title={row.ownerName}>
                  <Avatar initials={initials(row.ownerName)} size="sm" />
                </span>
                <Icon name="chevron_right" size="sm" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PipelinePanel({
  rows,
  openCount,
}: {
  rows: readonly PipelineRow[];
  openCount: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="vm-panel">
      <div className="vm-panel-head">
        <h2 className="vm-panel-title">Pipeline by phase</h2>
        <span className="vm-panel-note">
          <strong className="num">{openCount}</strong> open
        </span>
      </div>
      <div className="vm-phases">
        {rows.map((row) => (
          <div
            key={row.code}
            className="vm-phase"
            data-empty={row.count === 0}
            data-blocked={row.blocked}
          >
            <span className="vm-phase-n num">{row.order}</span>
            <span className="vm-phase-body">
              <span className="vm-phase-label">
                {row.label}
                {row.blocked ? (
                  <span className="vm-phase-flag">
                    <Icon name="warning" size="sm" label="Blocked" />
                  </span>
                ) : null}
              </span>
              <span className="vm-phase-track" aria-hidden="true">
                <span
                  className="vm-phase-fill"
                  style={{ width: `${Math.round((row.count / max) * 100)}%` }}
                />
              </span>
            </span>
            <span className="vm-phase-count num">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgingPanel({
  buckets,
  pastSla,
  openCount,
}: {
  buckets: readonly AgingBucket[];
  pastSla: number;
  openCount: number;
}) {
  const total = Math.max(1, buckets.reduce((sum, b) => sum + b.count, 0));

  return (
    <div className="vm-panel">
      <div className="vm-panel-head">
        <h2 className="vm-panel-title">Age of open cases</h2>
        {openCount === 0 ? (
          <Badge intent="neutral" size="sm" icon="schedule">
            Nothing open
          </Badge>
        ) : (
          <Badge
            intent={pastSla > 0 ? 'danger' : 'success'}
            size="sm"
            icon={pastSla > 0 ? 'warning' : 'check_circle'}
          >
            {pastSla > 0 ? `${pastSla} past SLA` : 'All inside SLA'}
          </Badge>
        )}
      </div>
      <div className="vm-panel-pad">
        <div className="vm-aging-bar" aria-hidden="true">
          {buckets.map((bucket, i) => (
            <i
              key={bucket.label}
              style={{
                flexBasis: openCount === 0 ? '25%' : `${Math.round((bucket.count / total) * 100)}%`,
                ['--vm-bucket' as string]: openCount === 0 ? 'var(--field)' : AGING_TONES[i],
              }}
            />
          ))}
        </div>
        <div className="vm-aging-grid">
          {buckets.map((bucket, i) => (
            <div
              key={bucket.label}
              className="vm-aging-item"
              style={{ ['--vm-bucket' as string]: AGING_TONES[i] }}
            >
              <span className="vm-aging-count num">{bucket.count}</span>
              <span className="t-eyebrow">{bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DecisionsPanel({ rows }: { rows: readonly DecisionRow[] }) {
  return (
    <div className="vm-panel">
      <div className="vm-panel-head">
        <h2 className="vm-panel-title">Recent decisions</h2>
        <span className="vm-panel-note">last 7 days</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          size="panel"
          icon="gavel"
          title="No decisions yet"
          description="Sign-offs appear here with the limit granted."
        />
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.id} className="vm-dec">
              <span className="vm-dec-body">
                <span className="vm-dec-name">{row.name}</span>
                <span className="vm-dec-meta">{row.meta}</span>
              </span>
              <span className="vm-dec-limit num">{money(row.limit)}</span>
              {row.outcome === 'approved' ? (
                <Badge intent="success" icon="check_circle">
                  Approved
                </Badge>
              ) : row.outcome === 'declined' ? (
                <Badge intent="danger" icon="block">
                  Declined
                </Badge>
              ) : (
                <Badge intent="neutral" icon="schedule">
                  Closed
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
