/**
 * The per-phase panes. Each one ends in a decision, per the SOP — every phase has a DECISION box,
 * so every pane here has a sign-off control rather than an implicit "next".
 *
 * Panes that show computed numbers (hard stops, capacity) render them READ-ONLY with the inputs
 * that produced them. A screen that lets someone type over a derived figure is a screen where the
 * audit trail stops meaning anything.
 */
import { useState } from 'react';
import { Icon } from '../../sales/redesign/icons';
import { s } from './style';
import type {
  VerificationDeskDetail,
  VerificationPhaseOutcome,
  VerificationRailPhase,
  VerificationScreeningHit,
  VerificationScreeningVerdict,
} from '@/api/verificationFlow';

const BTN =
  'min-height:44px;padding:0 16px;border-radius:var(--radius-md);font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--text-primary)';
const BTN_OK = `${BTN};border-color:var(--intent-success-bd);color:var(--success)`;
const BTN_WARN = `${BTN};border-color:var(--intent-warning-bd);color:var(--warning)`;
const BTN_BAD = `${BTN};border-color:var(--intent-danger-bd);color:var(--danger)`;

/**
 * The outcomes every phase offers, in SOP order.
 *
 * "Additional verification" is separate from "Manager review" on purpose: the SOP's Phase 2 routes
 * INCONSISTENT / SUSPICIOUS to "Additional Verification / Manager Review", and those are different
 * asks. Additional verification means go and check something; manager review means a human above
 * you decides. Collapsing them would have lost a distinction the model already carries.
 */
const OUTCOMES: ReadonlyArray<{
  id: VerificationPhaseOutcome;
  label: string;
  hint: string;
  style: string;
}> = [
  { id: 'pass', label: 'Pass', hint: 'Consistent and complete — continue.', style: BTN_OK },
  {
    id: 'pending_docs',
    label: 'Request documents',
    hint: 'Information is missing.',
    style: BTN_WARN,
  },
  {
    id: 'additional_verification',
    label: 'Additional verification',
    hint: 'Something needs checking before this can pass.',
    style: BTN_WARN,
  },
  {
    id: 'manager_review',
    label: 'Manager review',
    hint: 'Inconsistent, borderline, or an exception is being considered.',
    style: BTN_WARN,
  },
  { id: 'decline', label: 'Decline', hint: 'Not approved.', style: BTN_BAD },
];

export function PaneShell({
  phase,
  children,
  footer,
}: {
  phase: VerificationRailPhase;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section style={s('display:grid;gap:16px')}>
      <header style={s('display:grid;gap:4px')}>
        <span style={s('font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted)')}>
          Phase {phase.order} of 10
        </span>
        <h2 style={s('margin:0;font-size:18px;font-weight:800;color:var(--text-primary)')}>{phase.label}</h2>
        <p style={s('margin:0;font-size:13px;color:var(--text-muted);line-height:1.55')}>{phase.description}</p>
      </header>
      {children}
      {footer}
    </section>
  );
}

/**
 * Sign-off. Declining is two-step: the first click arms, the second commits. A credit decline is
 * not something to lose to a mis-click, and the same guard already exists on the legacy desk.
 */
export function DecisionBar({
  disabled,
  busy,
  onDecide,
  extra,
}: {
  disabled?: boolean;
  busy?: boolean;
  onDecide: (outcome: VerificationPhaseOutcome, note?: string) => void;
  extra?: React.ReactNode;
}) {
  const [note, setNote] = useState('');
  const [arming, setArming] = useState<VerificationPhaseOutcome | null>(null);

  const fire = (outcome: VerificationPhaseOutcome): void => {
    const destructive = outcome === 'decline' || outcome === 'decline_blacklist';
    if (destructive && arming !== outcome) {
      setArming(outcome);
      return;
    }
    setArming(null);
    onDecide(outcome, note.trim() === '' ? undefined : note.trim());
    setNote('');
  };

  return (
    <div
      style={s(
        'display:grid;gap:12px;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
      )}
    >
      <label htmlFor="phase-note" style={s('font-size:12px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em')}>
        Note (optional)
      </label>
      <textarea
        id="phase-note"
        value={note}
        rows={2}
        onChange={(e) => setNote(e.currentTarget.value)}
        placeholder="What did you find?"
        style={s(
          'width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text-primary);font-size:13px;font-family:inherit;resize:vertical',
        )}
      />
      {extra}
      <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
        {OUTCOMES.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={disabled || busy}
            onClick={() => fire(o.id)}
            title={o.hint}
            style={s(
              `${o.style}${disabled || busy ? ';opacity:.5;cursor:not-allowed' : ''}${
                arming === o.id ? ';background:var(--danger);color:var(--on-accent);border-color:var(--danger)' : ''
              }`,
            )}
          >
            {arming === o.id ? 'Click again to confirm' : o.label}
          </button>
        ))}
      </div>
      {arming ? (
        <button
          type="button"
          onClick={() => setArming(null)}
          style={s('justify-self:start;border:none;background:transparent;color:var(--text-muted);font-size:12px;cursor:pointer;text-decoration:underline')}
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/** A labelled read-only figure. Used wherever a number was computed rather than typed. */
export function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'bad' | 'plain';
  hint?: string;
}) {
  const colour = tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'var(--text-primary)';
  return (
    <div style={s('display:grid;gap:3px')}>
      <span style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)')}>
        {label}
      </span>
      <span style={s(`font-size:18px;font-weight:800;color:${colour};font-variant-numeric:tabular-nums`)}>
        {value}
      </span>
      {hint ? <span style={s('font-size:11px;color:var(--text-muted);line-height:1.45')}>{hint}</span> : null}
    </div>
  );
}

export function FigureRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={s(
        'display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
      )}
    >
      {children}
    </div>
  );
}

/** Phase 3 — each hit needs a verdict before the phase can clear. */
export function ScreeningPane({
  detail,
  busy,
  onRun,
  onVerdict,
}: {
  detail: VerificationDeskDetail;
  busy: boolean;
  onRun: () => void;
  onVerdict: (hitId: string, verdict: VerificationScreeningVerdict) => void;
}) {
  const { hits, summary } = detail.screening;
  const blacklist = hits.filter((h) => h.checkType === 'blacklist');
  const duplicate = hits.filter((h) => h.checkType === 'duplicate');

  return (
    <div style={s('display:grid;gap:16px')}>
      <div style={s('display:flex;flex-wrap:wrap;gap:10px;align-items:center')}>
        <button type="button" onClick={onRun} disabled={busy} style={s(busy ? `${BTN};opacity:.5` : BTN)}>
          <Icon name="refresh" size={14} strokeWidth={2.2} /> {hits.length > 0 ? 'Re-run screening' : 'Run screening'}
        </button>
        <span style={s('font-size:12px;color:var(--text-muted)')}>
          Checks name, EIN, SSN, phone, email, address, MC and USDOT against our blacklist and existing applicants.
        </span>
      </div>

      {hits.length === 0 ? (
        <div
          style={s(
            'padding:16px;border-radius:var(--radius-md);border:1px solid var(--intent-success-bd);background:var(--intent-success-bg);font-size:13px;color:var(--text-primary)',
          )}
        >
          No blacklist or duplicate matches.
        </div>
      ) : (
        <>
          <HitGroup
            title="Check A — Blacklist"
            emptyLabel="No blacklist match."
            hits={blacklist}
            busy={busy}
            onVerdict={onVerdict}
          />
          <HitGroup
            title="Check B — Active customer / duplicate"
            emptyLabel="No duplicate match."
            hits={duplicate}
            busy={busy}
            onVerdict={onVerdict}
          />
        </>
      )}

      {summary.unresolved > 0 ? (
        <p
          role="status"
          style={s('margin:0;font-size:12px;font-weight:700;color:var(--warning)')}
        >
          {summary.unresolved} match{summary.unresolved === 1 ? '' : 'es'} still need a verdict before this
          phase can pass.
        </p>
      ) : null}
    </div>
  );
}

function HitGroup({
  title,
  emptyLabel,
  hits,
  busy,
  onVerdict,
}: {
  title: string;
  emptyLabel: string;
  hits: VerificationScreeningHit[];
  busy: boolean;
  onVerdict: (hitId: string, verdict: VerificationScreeningVerdict) => void;
}) {
  return (
    <div style={s('display:grid;gap:10px')}>
      <h3 style={s('margin:0;font-size:13px;font-weight:800;color:var(--text-primary)')}>{title}</h3>
      {hits.length === 0 ? (
        <p style={s('margin:0;font-size:12px;color:var(--text-muted)')}>{emptyLabel}</p>
      ) : (
        <ul style={s('margin:0;padding:0;list-style:none;display:grid;gap:8px')}>
          {hits.map((hit) => (
            <li
              key={hit.id}
              style={s(
                'display:grid;gap:10px;padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
              )}
            >
              <div style={s('display:flex;flex-wrap:wrap;gap:8px;align-items:baseline')}>
                <span style={s('font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)')}>
                  {hit.entryType}
                </span>
                <span style={s('font-size:13px;font-weight:700;color:var(--text-primary)')}>
                  {hit.matchedValueDisplay ?? hit.matchedCaseLabel ?? 'match'}
                </span>
              </div>
              {hit.verdict === 'unverified' ? (
                <div style={s('display:flex;gap:8px;flex-wrap:wrap')}>
                  <button type="button" disabled={busy} onClick={() => onVerdict(hit.id, 'confirmed')} style={s(BTN_BAD)}>
                    Confirmed match
                  </button>
                  <button type="button" disabled={busy} onClick={() => onVerdict(hit.id, 'false_match')} style={s(BTN_OK)}>
                    False match
                  </button>
                </div>
              ) : (
                <span
                  style={s(
                    `font-size:12px;font-weight:800;color:${hit.verdict === 'confirmed' ? 'var(--danger)' : 'var(--success)'}`,
                  )}
                >
                  {hit.verdict === 'confirmed' ? 'Confirmed match' : 'Ruled a false match'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Phase 7 — computed, read-only, with the inputs that produced the verdict. */
export function HardStopsPane({ detail }: { detail: VerificationDeskDetail }) {
  const { hardStops, indicators, banking } = detail;
  return (
    <div style={s('display:grid;gap:16px')}>
      <FigureRow>
        <Figure
          label="Avg weekly net cash flow"
          value={banking?.avgWeeklyNetCashFlow ? `$${banking.avgWeeklyNetCashFlow}` : '—'}
          tone={hardStops.passed ? 'ok' : 'bad'}
          hint="Recurring income − recurring expenses"
        />
        <Figure label="Avg daily balance" value={banking?.avgDailyBalance ? `$${banking.avgDailyBalance}` : '—'} />
        <Figure
          label="NSF / returned ACH"
          value={String((banking?.nsfCount ?? 0) + (banking?.achReturnCount ?? 0))}
        />
      </FigureRow>

      {hardStops.triggered.length === 0 ? (
        <div
          style={s(
            'padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--intent-success-bd);background:var(--intent-success-bg);font-size:13px;color:var(--text-primary)',
          )}
        >
          Neither hard stop applies — a standard unsecured line is still on the table.
        </div>
      ) : (
        <div style={s('display:grid;gap:10px')}>
          {hardStops.triggered.map((stop) => (
            <div
              key={stop.code}
              style={s(
                'display:grid;gap:4px;padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--intent-danger-bd);background:var(--intent-danger-bg)',
              )}
            >
              <span style={s('font-size:13px;font-weight:800;color:var(--danger)')}>{stop.label}</span>
              <span style={s('font-size:12px;color:var(--text-secondary);line-height:1.5')}>{stop.detail}</span>
            </div>
          ))}
          <p style={s('margin:0;font-size:12px;color:var(--text-muted);line-height:1.55')}>
            A hard stop is not a decline. It rules out a standard unsecured line — Deposit 1:1, Prepaid or
            Manager Review.
          </p>
        </div>
      )}

      {indicators.length > 0 ? (
        <div style={s('display:grid;gap:8px')}>
          <h3 style={s('margin:0;font-size:13px;font-weight:800;color:var(--text-primary)')}>
            Manager-review indicators
          </h3>
          <p style={s('margin:0;font-size:12px;color:var(--text-muted)')}>
            Not declines by themselves — signals worth a second read.
          </p>
          <ul style={s('margin:0;padding-left:18px;display:grid;gap:4px')}>
            {indicators.map((flag) => (
              <li key={flag} style={s('font-size:12px;color:var(--text-secondary);line-height:1.5')}>
                {flag}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
