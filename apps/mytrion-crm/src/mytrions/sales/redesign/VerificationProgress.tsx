/**
 * What Verification has done with this application, on the Sales side.
 *
 * "It's with Verification" is not an answer a Sales agent can give a carrier who is waiting on a
 * fuel card. This renders the same ten-phase rail the desk works — read-only — so the agent can say
 * where it actually is, and can see immediately when it has stopped on something they can fix.
 *
 * The rows are the desk's own rows, projected. Nothing here re-derives a status.
 */
import { Icon } from './icons';
import { s } from './dc';
import type { ApplicationDetail, VerificationRailPhase } from '@/api/verificationFlow';

type Tone = 'done' | 'active' | 'stopped' | 'skipped' | 'waiting';

const TONE_COLOR: Record<Tone, string> = {
  done: 'var(--ok)',
  active: 'var(--accent)',
  stopped: 'var(--warn)',
  skipped: 'var(--muted)',
  waiting: 'var(--border)',
};

/** Phase status → what it means to a Sales agent, in their words rather than the desk's. */
function toneOf(phase: VerificationRailPhase): Tone {
  switch (phase.status) {
    case 'passed':
      return 'done';
    case 'in_progress':
      return 'active';
    case 'pending_docs':
    case 'manager_review':
    case 'failed':
      return 'stopped';
    case 'skipped':
      return 'skipped';
    default:
      return 'waiting';
  }
}

const STATUS_WORD: Record<string, string> = {
  passed: 'Cleared',
  in_progress: 'In progress',
  pending_docs: 'Waiting on you',
  manager_review: 'With a manager',
  failed: 'Stopped',
  skipped: 'Not applicable',
  not_started: 'Not started',
};

/**
 * The one phase that is currently blocking, if any.
 *
 * A stop is worth more than the whole rail put together — it is the only part an agent can act on —
 * so it is lifted out and stated above the timeline rather than left to be spotted in a list of ten.
 */
function blockingPhase(phases: VerificationRailPhase[]): VerificationRailPhase | null {
  return phases.find((p) => toneOf(p) === 'stopped') ?? null;
}

export function VerificationProgress({ detail }: { detail: ApplicationDetail }) {
  const phases = detail.phases ?? [];
  const open = detail.case.verificationProcess;

  if (!open) {
    return (
      <section style={s('display:grid;gap:8px')}>
        <Head />
        <p style={s('margin:0;font-size:13px;color:var(--muted);line-height:1.55')}>
          Underwriting has not started. Complete the details and documents above, then submit — the
          ten phases below begin the moment you do.
        </p>
        <Rail phases={phases} dimmed />
      </section>
    );
  }

  const blocking = blockingPhase(phases);
  const cleared = phases.filter((p) => p.status === 'passed').length;
  const applicable = phases.filter((p) => p.applies).length;

  return (
    <section style={s('display:grid;gap:12px')}>
      <Head detail={`${cleared} of ${applicable} phases cleared`} />

      {blocking ? (
        <div
          role="status"
          style={s(
            'display:flex;gap:10px;padding:12px 14px;border-radius:var(--radius-md);' +
              'background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.32)',
          )}
        >
          <Icon name="alert" size={16} color="var(--warn)" />
          <div style={s('display:grid;gap:3px')}>
            <span style={s('font-size:13px;font-weight:600;color:var(--text)')}>
              Stopped at phase {blocking.order} — {blocking.label}
            </span>
            <span style={s('font-size:12.5px;color:var(--text2);line-height:1.5')}>
              {blocking.note ??
                (blocking.status === 'pending_docs'
                  ? 'Verification has asked for more documents. Upload them above and it continues from this phase.'
                  : 'Verification has escalated this for a manager to look at. You do not need to do anything yet.')}
            </span>
          </div>
        </div>
      ) : null}

      <Rail phases={phases} />
    </section>
  );
}

function Head({ detail }: { detail?: string }) {
  return (
    <div style={s('display:flex;align-items:baseline;justify-content:space-between;gap:10px')}>
      <h3
        style={s(
          'margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)',
        )}
      >
        Verification progress
      </h3>
      {detail ? <span style={s('font-size:12px;color:var(--muted)')}>{detail}</span> : null}
    </div>
  );
}

function Rail({ phases, dimmed }: { phases: VerificationRailPhase[]; dimmed?: boolean }) {
  if (phases.length === 0) {
    return (
      <p style={s('margin:0;font-size:13px;color:var(--muted)')}>
        The phase list appears once the application is created.
      </p>
    );
  }

  return (
    <ol
      style={s(
        `display:grid;gap:2px;margin:0;padding:0;list-style:none${dimmed ? ';opacity:.62' : ''}`,
      )}
    >
      {phases.map((p) => {
        const tone = toneOf(p);
        const color = TONE_COLOR[tone];
        return (
          <li
            key={p.code}
            style={s(
              'display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:8px 10px;border-radius:var(--radius-sm)',
            )}
          >
            <span
              aria-hidden
              style={s(
                `display:flex;align-items:center;justify-content:center;width:22px;height:22px;` +
                  `border-radius:999px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;` +
                  `color:${tone === 'waiting' || tone === 'skipped' ? 'var(--muted)' : color};` +
                  `border:1px solid ${tone === 'waiting' ? 'var(--border)' : color};` +
                  `background:${tone === 'done' || tone === 'active' || tone === 'stopped' ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent'}`,
              )}
            >
              {p.order}
            </span>

            <span style={s('display:grid;gap:1px;min-width:0')}>
              <span
                style={s(
                  `font-size:13px;font-weight:${tone === 'active' || tone === 'stopped' ? '600' : '500'};` +
                    `color:${tone === 'skipped' || tone === 'waiting' ? 'var(--muted)' : 'var(--text)'}`,
                )}
              >
                {p.label}
              </span>
              {/* Skips are stated, never silent — a quiet gap reads as "this was checked". */}
              {p.skipReason ? (
                <span style={s('font-size:11.5px;color:var(--muted)')}>{p.skipReason}</span>
              ) : null}
            </span>

            <span
              style={s(
                `font-size:11.5px;white-space:nowrap;color:${tone === 'waiting' || tone === 'skipped' ? 'var(--muted)' : color}`,
              )}
            >
              {STATUS_WORD[p.status] ?? p.status}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
