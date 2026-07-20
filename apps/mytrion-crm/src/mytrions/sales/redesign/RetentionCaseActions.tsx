/**
 * Phase 1 action panels — outcome first, then OoR channel attempts (log → result).
 */
import type { FormEvent } from 'react';
import { Icon } from './icons';
import { s } from './dc';
import {
  CHANNEL_OPTIONS,
  isOverdue,
  REASON_OPTIONS,
  type RetentionCaseRow,
  type RetentionChannel,
  type RetentionDissatisfactionReason,
  type RetentionPhase1Outcome,
} from './retentionData';

export function RetentionCaseActions(props: {
  row: RetentionCaseRow;
  busy: boolean;
  contactPhone: string | null;
  reason: RetentionDissatisfactionReason | '';
  reasonNote: string;
  channel: RetentionChannel;
  attemptNote: string;
  setReason: (v: RetentionDissatisfactionReason | '') => void;
  setReasonNote: (v: string) => void;
  setChannel: (v: RetentionChannel) => void;
  setAttemptNote: (v: string) => void;
  onAct: (o: RetentionPhase1Outcome) => Promise<void>;
  onDissatisfied: (e: FormEvent) => void;
  onLogPhoneCall: () => Promise<void>;
  onLogOtherChannel: () => Promise<void>;
}) {
  const { row, busy, onAct, contactPhone } = props;
  const canDecide =
    row.statusCode === 'p1_new' ||
    row.statusCode === 'p1_in_progress' ||
    row.statusCode === 'p1_pool_assigned';
  const inOoR = row.statusCode === 'p1_out_of_reach';
  const inVacation =
    row.statusCode === 'p1_vacation' || row.statusCode === 'p1_vacation_followup';
  const awaitingOps = row.statusCode === 'p1_awaiting_ops';
  const watchingReached = row.statusCode === 'p1_reached';

  const btn = (
    label: string,
    onClick: () => void,
    tone: 'accent' | 'warn' | 'danger' | 'muted' = 'accent',
  ) => {
    const col =
      tone === 'warn'
        ? 'var(--warn)'
        : tone === 'danger'
          ? 'var(--danger)'
          : tone === 'muted'
            ? 'var(--muted)'
            : 'var(--accent)';
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        style={s(
          `height:36px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,${col} 35%,var(--border));background:color-mix(in srgb,${col} 12%,transparent);color:${col};font-weight:700;font-size:12px;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.7 : 1}`,
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')}>
      {canDecide && (
        <>
          <SectionTitle>Agent outcome</SectionTitle>
          <div style={s('font-size:11px;color:var(--muted);line-height:1.4;margin-top:-4px')}>
            Record a result (2 BD). Returned closes automatically when they fuel again.
          </div>
          <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
            {row.statusCode === 'p1_new' && btn('Start working', () => void onAct('start_working'))}
            {btn('Reached', () => void onAct('reached'))}
            {btn('Out of reach', () => void onAct('out_of_reach'), 'warn')}
            {btn('Vacation', () => void onAct('vacation'), 'muted')}
            {isOverdue(row) &&
              btn('No action (2 BD)', () => void onAct('no_action_2bd'), 'danger')}
          </div>
          <DissatisfiedForm {...props} />
        </>
      )}

      {watchingReached && (
        <div
          style={s(
            'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12px;color:var(--text2);line-height:1.45',
          )}
        >
          <strong style={s('color:var(--text)')}>Reached — 5 BD for a new transaction.</strong>{' '}
          Hourly sync closes the case if they fuel. If not, the timer sends the deal to Open Pool.
        </div>
      )}

      {awaitingOps && (
        <>
          <SectionTitle>Ops Manager — vacation confirm</SectionTitle>
          <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
            {btn('Confirm on vacation → Phase 1', () => void onAct('ops_confirm_vacation'))}
            {btn('Not on vacation / OoR → CITI', () => void onAct('ops_deny_vacation'), 'danger')}
          </div>
        </>
      )}

      {inOoR && (
        <>
          <SectionTitle>Out of Reach — log attempts</SectionTitle>
          <div style={s('font-size:11px;color:var(--muted);line-height:1.4;margin-top:-4px')}>
            Choose a channel, log the attempt (1 BD each). At 5 failed attempts → Open Pool.
          </div>
          <AttemptPanel {...props} contactPhone={contactPhone} />
          {row.outOfReachAttempts >= 5 &&
            btn('Send to Open Pool', () => void onAct('send_to_open_pool'), 'warn')}
        </>
      )}

      {inVacation && (
        <div
          style={s(
            'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12px;color:var(--text2);line-height:1.45',
          )}
        >
          <strong style={s('color:var(--text)')}>
            {row.statusCode === 'p1_vacation_followup'
              ? 'Vacation follow-up · 2 BD.'
              : 'Vacation · 14-day countdown.'}
          </strong>{' '}
          If they fuel again, sync closes the case. Timers advance the board automatically.
        </div>
      )}

      {!canDecide &&
        !inOoR &&
        !inVacation &&
        !awaitingOps &&
        !watchingReached &&
        row.isOpen &&
        row.phaseCode === 'phase_1_agent' && (
        <div style={s('font-size:12px;color:var(--muted)')}>
          This case is waiting on the next workflow step (pool / sync). No further agent outcome
          here.
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div
      style={s(
        'font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)',
      )}
    >
      {children}
    </div>
  );
}

function DissatisfiedForm(props: {
  busy: boolean;
  reason: RetentionDissatisfactionReason | '';
  reasonNote: string;
  setReason: (v: RetentionDissatisfactionReason | '') => void;
  setReasonNote: (v: string) => void;
  onDissatisfied: (e: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={props.onDissatisfied}
      style={s(
        'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);display:flex;flex-direction:column;gap:8px',
      )}
    >
      <div style={s('font-size:12px;font-weight:700')}>Dissatisfied → Retention</div>
      <select
        value={props.reason}
        onChange={(e) => props.setReason(e.target.value as RetentionDissatisfactionReason | '')}
        className="ss-in"
        style={s(
          'height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px',
        )}
      >
        <option value="">Choose reason…</option>
        {REASON_OPTIONS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        value={props.reasonNote}
        onChange={(e) => props.setReasonNote(e.target.value)}
        placeholder="Note (required for Switched / other)"
        rows={2}
        className="ss-in"
        style={s(
          'padding:8px 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;resize:vertical',
        )}
      />
      <button
        type="submit"
        disabled={props.busy}
        style={s(
          'height:36px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger);font-weight:700;font-size:12px;cursor:pointer',
        )}
      >
        Mark dissatisfied
      </button>
    </form>
  );
}

function AttemptPanel(props: {
  row: RetentionCaseRow;
  busy: boolean;
  contactPhone: string | null;
  channel: RetentionChannel;
  attemptNote: string;
  setChannel: (v: RetentionChannel) => void;
  setAttemptNote: (v: string) => void;
  onLogPhoneCall: () => Promise<void>;
  onLogOtherChannel: () => Promise<void>;
}) {
  const { row, busy, contactPhone } = props;
  return (
    <div
      style={s(
        'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);display:flex;flex-direction:column;gap:8px',
      )}
    >
      <div style={s('font-size:12px;font-weight:700')}>
        Attempts {row.outOfReachAttempts}/5 · channels TG · WA · SMS · RC · IG · FB · EM
      </div>
      <div style={s('font-size:11px;color:var(--muted);line-height:1.4')}>
        {contactPhone
          ? `RC dials ${contactPhone}, then logs the result.`
          : 'No DWH phone — RC still logs a call attempt. Other channels count toward 5.'}
      </div>
      <input
        value={props.attemptNote}
        onChange={(e) => props.setAttemptNote(e.target.value)}
        placeholder="Optional result note…"
        className="ss-in"
        style={s(
          'height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px',
        )}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void props.onLogPhoneCall()}
        className="ss-btn-p"
        style={s(
          'height:38px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px',
        )}
      >
        {busy ? (
          <span
            style={s(
              'width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite',
            )}
          />
        ) : (
          <Icon name="calls" size={14} color="currentColor" />
        )}
        {contactPhone ? 'Call & log result' : 'Log RC call result'}
      </button>
      <div style={s('font-size:11px;font-weight:700;color:var(--muted);margin-top:4px')}>
        Other channels
      </div>
      <div style={s('display:flex;flex-wrap:wrap;gap:6px')}>
        {CHANNEL_OPTIONS.filter((c) => c.id !== 'ringcentral').map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => props.setChannel(c.id)}
            style={s(
              `height:28px;padding:0 10px;border-radius:99px;border:1px solid ${props.channel === c.id ? 'var(--accent)' : 'var(--border)'};background:${props.channel === c.id ? 'rgba(var(--accent-rgb),.14)' : 'var(--surface)'};color:${props.channel === c.id ? 'var(--accent)' : 'var(--text2)'};font-size:11px;font-weight:700;cursor:pointer`,
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {props.channel !== 'ringcentral' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void props.onLogOtherChannel()}
          style={s(
            'height:34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-weight:700;font-size:12px;cursor:pointer',
          )}
        >
          Log {CHANNEL_OPTIONS.find((c) => c.id === props.channel)?.label ?? 'channel'} result
        </button>
      )}
    </div>
  );
}
