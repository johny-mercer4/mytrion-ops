/** Step UI blocks for the Retention Phase 1 case wizard. */
import type { FormEvent } from 'react';
import { Icon, type IconName } from './icons';
import { s } from './dc';
import { CHANNEL_BRAND, RetentionChannelIcon } from './RetentionChannelIcons';
import { DissatisfiedForm, ScreenshotField } from './RetentionWizardBits';
import {
  CHANNEL_OPTIONS,
  formatUsPhone,
  isOverdue,
  type RetentionCaseRow,
  type RetentionChannel,
  type RetentionDissatisfactionReason,
  type RetentionPhase1Outcome,
} from './retentionData';
export interface PendingCallLog {
  sessionId?: string;
  peer: string;
  result?: string;
  durationMs?: number;
}
function callPeerLine(pending: PendingCallLog): string {
  const phone = formatUsPhone(pending.peer) || pending.peer;
  const bits = [
    phone || undefined,
    pending.result || undefined,
    pending.durationMs != null ? `${Math.round(pending.durationMs / 1000)}s` : undefined,
  ].filter(Boolean);
  return bits.join(' · ');
}
export type StatusPick = 'out_of_reach' | 'reached' | 'vacation' | 'dissatisfied' | '';
/** Stage card chrome — colors match `KANBAN_COLS` on the Retention board. */
const STAGE_CARD: Record<Exclude<StatusPick, ''>, { color: string; icon: IconName }> = {
  out_of_reach: { color: 'var(--warn)', icon: 'warn' },
  reached: { color: 'var(--ok)', icon: 'checkCircle' },
  vacation: { color: 'var(--violet)', icon: 'calendar' },
  dissatisfied: { color: 'var(--danger)', icon: 'alert' },
};
/** High-contrast label on bright stage fills (warn/ok/violet/danger). */
const STAGE_ON = '#04131c';
export function WizardChrome(props: {
  stage: string;
  stepLabel?: string;
  steps?: Array<{ n: number; label: string; active: boolean; done: boolean }>;
}) {
  return (
    <div
      style={s(
        'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
      )}
    >
      <div>
        <div
          style={s(
            'font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)',
          )}
        >
          Stage
        </div>
        <div style={s('font-size:15px;font-weight:800;color:var(--text);margin-top:2px')}>
          {props.stage}
        </div>
      </div>
      {props.steps ? (
        <div style={s('display:flex;align-items:center;gap:8px')}>
          {props.steps.map((st, i) => (
            <div key={st.n} style={s('display:flex;align-items:center;gap:8px')}>
              {i > 0 && (
                <div style={s('width:18px;height:2px;background:var(--border);border-radius:99px')} />
              )}
              <StepPill n={st.n} label={st.label} active={st.active} done={st.done} />
            </div>
          ))}
        </div>
      ) : props.stepLabel ? (
        <div
          style={s(
            "font-size:12px;font-weight:700;color:var(--muted);font-family:var(--font-mono)",
          )}
        >
          {props.stepLabel}
        </div>
      ) : null}
    </div>
  );
}
function StepPill({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  const col = active || done ? 'var(--accent)' : 'var(--muted)';
  return (
    <div
      style={s(
        `display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${col}`,
      )}
    >
      <span
        style={s(
          `width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;border:1px solid ${col};background:${active || done ? 'color-mix(in srgb,var(--accent) 14%,transparent)' : 'transparent'}`,
        )}
      >
        {done ? '✓' : n}
      </span>
      {label}
    </div>
  );
}
export function CallEndedBanner({ pendingCall }: { pendingCall: PendingCallLog }) {
  const line = callPeerLine(pendingCall);
  return (
    <div
      style={s(
        'padding:12px 14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--border));background:color-mix(in srgb,var(--warn) 12%,transparent);font-size:13px;color:var(--text);line-height:1.45',
      )}
    >
      <div style={s('font-weight:800')}>Call ended — choose a stage.</div>
      {line ? (
        <div
          style={s(
            "margin-top:6px;font-family:var(--font-mono);font-size:15px;font-weight:700;letter-spacing:.02em;color:var(--accent-text)",
          )}
        >
          {line}
        </div>
      ) : null}
    </div>
  );
}
function CallDialButton(props: {
  canCall: boolean;
  awaitingCallEnd: boolean;
  height: number;
  idleLabel: string;
  onCall: () => void;
}) {
  const { canCall, awaitingCallEnd, height, idleLabel, onCall } = props;
  return (
    <button
      type="button"
      disabled={!canCall}
      onClick={onCall}
      className="ss-btn-p"
      aria-busy={awaitingCallEnd}
      style={s(
        `height:${height}px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:14px;cursor:${canCall ? 'pointer' : 'not-allowed'};opacity:${canCall || awaitingCallEnd ? 1 : 0.5};display:inline-flex;align-items:center;justify-content:center;gap:8px`,
      )}
    >
      {awaitingCallEnd ? (
        <>
          <Icon name="spinner" size={16} color="currentColor" style={s('animation:ss-spin .8s linear infinite')} />
          Waiting for call to end…
        </>
      ) : (
        <>
          <Icon name="calls" size={16} color="currentColor" />
          {idleLabel}
        </>
      )}
    </button>
  );
}
export function CallFirstBlock(props: {
  busy: boolean;
  contactPhone: string | null;
  phoneLoading?: boolean;
  awaitingCallEnd?: boolean;
  onCall: () => void;
}) {
  const { busy, contactPhone, phoneLoading = false, awaitingCallEnd = false } = props;
  const phone = formatUsPhone(contactPhone) || contactPhone?.trim() || '';
  const canCall = !busy && !phoneLoading && !awaitingCallEnd && !!contactPhone?.trim();
  const idleLabel = phoneLoading ? 'Loading number…' : phone ? `Call ${phone}` : 'No phone on file';
  return (
    <section
      style={s(
        'padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);display:flex;flex-direction:column;gap:14px',
      )}
    >
      <div>
        <SectionTitle>Step 1 · Call the client</SectionTitle>
        <div style={s('font-size:13px;color:var(--text2);line-height:1.5;margin-top:6px')}>
          Call first. When the call ends, a stage dialog opens — Out of Reach, Reached,
          Dissatisfied, or Vacation. Out of Reach auto-logs attempt 1 for RingCentral.
        </div>
      </div>
      {phoneLoading ? (
        <div
          className="ss-skel"
          aria-label="Loading phone"
          style={s('height:22px;width:160px;border-radius:6px')}
        />
      ) : phone ? (
        <div
          style={s(
            "font-family:var(--font-mono);font-size:20px;font-weight:700;letter-spacing:.03em;color:var(--accent-text)",
          )}
        >
          {phone}
        </div>
      ) : (
        <div style={s('font-size:13px;font-weight:600;color:var(--warn)')}>
          No phone on file — add a number on the deal before calling.
        </div>
      )}
      <CallDialButton
        canCall={canCall}
        awaitingCallEnd={awaitingCallEnd}
        height={46}
        idleLabel={idleLabel}
        onCall={props.onCall}
      />
    </section>
  );
}
export function AttemptStep(props: {
  row: RetentionCaseRow;
  busy: boolean;
  contactPhone: string | null;
  forceAttempt: boolean;
  awaitingCallEnd?: boolean;
  pendingCall: PendingCallLog | null;
  channel: RetentionChannel;
  attemptNote: string;
  evidenceFile: File | null;
  evidencePreview: string | null;
  setChannel: (v: RetentionChannel) => void;
  setAttemptNote: (v: string) => void;
  setEvidenceFile: (f: File | null) => void;
  onCall: () => void;
  onLogPhoneCall: () => Promise<void>;
  onLogOtherChannel: () => Promise<void>;
}) {
  const { busy, contactPhone, forceAttempt, pendingCall, row, awaitingCallEnd = false } = props;
  const brand =
    props.channel !== 'ringcentral' ? CHANNEL_BRAND[props.channel] : null;
  const phone = formatUsPhone(contactPhone) || contactPhone?.trim() || '';
  // Messenger / email: note required; screenshot optional (encourage both).
  const noteMissing = !props.attemptNote.trim();
  const canCall = !busy && !awaitingCallEnd && !!contactPhone?.trim();
  return (
    <section
      style={s(
        `padding:14px;border-radius:var(--radius-md);border:1px solid ${forceAttempt ? 'color-mix(in srgb,var(--warn) 45%,var(--border))' : 'var(--border)'};background:${forceAttempt ? 'color-mix(in srgb,var(--warn) 8%,var(--alt))' : 'var(--alt)'};display:flex;flex-direction:column;gap:12px`,
      )}
    >
      <div>
        <SectionTitle>Log attempt — call or messenger + short note</SectionTitle>
        <div style={s('font-size:13px;color:var(--text2);line-height:1.45;margin-top:6px')}>
          Attempt {row.outOfReachAttempts}/5. RingCentral logs on call end. Other channels need a
          short note (screenshot optional). At 5 → Open Pool.
        </div>
      </div>

      {forceAttempt && pendingCall && (
        <div
          style={s(
            'padding:12px 14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--border));background:color-mix(in srgb,var(--warn) 12%,transparent);display:flex;flex-direction:column;gap:10px',
          )}
        >
          <div style={s('font-size:13px;color:var(--text);line-height:1.4')}>
            <strong>Call ended — retry logging.</strong>
            {callPeerLine(pendingCall) ? (
              <div
                style={s(
                  "margin-top:6px;font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--accent-text)",
                )}
              >
                {callPeerLine(pendingCall)}
              </div>
            ) : null}
          </div>
          {!busy && (
            <button
              type="button"
              onClick={() => void props.onLogPhoneCall()}
              className="ss-btn-p"
              style={s(
                'height:36px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer',
              )}
            >
              Retry RingCentral log
            </button>
          )}
        </div>
      )}
      <CallDialButton
        canCall={canCall}
        awaitingCallEnd={awaitingCallEnd}
        height={40}
        idleLabel={phone ? `Call ${phone}` : 'No phone on file'}
        onCall={props.onCall}
      />

      {!forceAttempt && (
        <>
          <div style={s('font-size:12px;font-weight:700;color:var(--muted)')}>
            Or message another channel
          </div>
          <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
            {(Object.keys(CHANNEL_BRAND) as Array<keyof typeof CHANNEL_BRAND>).map((id) => {
              const meta = CHANNEL_BRAND[id];
              const active = props.channel === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={meta.label}
                  aria-label={meta.label}
                  aria-pressed={active}
                  onClick={() => props.setChannel(id)}
                  style={s(
                    `width:42px;height:42px;border-radius:12px;border:1px solid ${active ? meta.color : 'var(--border)'};background:${active ? `color-mix(in srgb,${meta.color} 16%,var(--surface))` : 'var(--surface)'};color:${active ? meta.color : 'var(--text2)'};cursor:pointer;display:inline-flex;align-items:center;justify-content:center`,
                  )}
                >
                  <RetentionChannelIcon channel={id} size={18} />
                </button>
              );
            })}
          </div>
          {brand && (
            <div style={s(`font-size:13px;font-weight:700;color:${brand.color}`)}>
              Logging via {brand.label}
            </div>
          )}
          <input
            value={props.attemptNote}
            onChange={(e) => props.setAttemptNote(e.target.value)}
            placeholder="Short note (required)…"
            className="ss-in"
            aria-required
            style={s(
              `height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid ${noteMissing ? 'var(--danger)' : 'var(--border)'};background:var(--surface);color:var(--text);font-size:13px;box-shadow:${noteMissing ? '0 0 0 1px color-mix(in srgb,var(--danger) 35%,transparent)' : 'none'}`,
            )}
          />
          {noteMissing && (
            <div style={s('font-size:12px;font-weight:700;color:var(--danger);margin-top:-6px')}>
              Note required for messenger / email attempts
            </div>
          )}
          <ScreenshotField
            preview={props.evidencePreview}
            fileName={props.evidenceFile?.name ?? null}
            onPick={props.setEvidenceFile}
          />
          <button
            type="button"
            disabled={busy || props.channel === 'ringcentral' || noteMissing}
            onClick={() => void props.onLogOtherChannel()}
            style={s(
              `height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-weight:700;font-size:13px;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.7 : 1}`,
            )}
          >
            Log {CHANNEL_OPTIONS.find((c) => c.id === props.channel)?.label ?? 'channel'} attempt
          </button>
        </>
      )}
    </section>
  );
}

export function StageStep(props: {
  row: RetentionCaseRow;
  busy: boolean;
  reason: RetentionDissatisfactionReason | '';
  reasonNote: string;
  statusPick: StatusPick;
  showOutOfReach: boolean;
  /** Already on OoR — confirming OoR stays on the stage and refreshes the 1 BD timer. */
  alreadyOutOfReach?: boolean;
  /** Force-modal layout — no nested card chrome. */
  embedded?: boolean;
  title?: string;
  setStatusPick: (v: StatusPick) => void;
  setReason: (v: RetentionDissatisfactionReason | '') => void;
  setReasonNote: (v: string) => void;
  onAct: (o: RetentionPhase1Outcome) => Promise<void>;
  onDissatisfied: (e: FormEvent) => void;
  onConfirmStage: () => void;
}) {
  const { busy, statusPick, setStatusPick, onAct, row, showOutOfReach } = props;
  const alreadyOoR = props.alreadyOutOfReach === true;
  const embedded = props.embedded === true;
  const oorHint =
    row.outOfReachAttempts >= 5
      ? '5/5 → Open Pool'
      : alreadyOoR
        ? `Stay Out of Reach · attempt ${row.outOfReachAttempts}/5 · 1 BD`
        : 'Channel attempts · 5×1 BD';
  const pickColor = statusPick ? STAGE_CARD[statusPick].color : 'var(--accent)';
  const confirmLabel =
    statusPick === 'out_of_reach'
      ? alreadyOoR
        ? 'Continue Out of Reach →'
        : 'Move to Out of Reach →'
      : statusPick === 'reached'
        ? 'Save Reached — watch 5 BD'
        : statusPick === 'vacation'
          ? 'Start vacation hold →'
          : 'Save stage & close';

  return (
    <section
      style={s(
        embedded
          ? 'display:flex;flex-direction:column;gap:14px'
          : 'padding:14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);display:flex;flex-direction:column;gap:12px',
      )}
    >
      {!embedded && (
        <div>
          <SectionTitle>{props.title ?? 'Choose stage'}</SectionTitle>
          <div style={s('font-size:13px;color:var(--text2);line-height:1.45;margin-top:6px')}>
            {alreadyOoR
              ? 'After each attempt, pick a stage. Out of Reach stays available until attempt 5 → Open Pool.'
              : showOutOfReach
                ? 'Pick one stage. The card moves to that column on the board.'
                : 'Reached, Dissatisfied, or Vacation — or keep logging Out of Reach attempts above.'}
          </div>
        </div>
      )}

      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        {showOutOfReach && (
          <StatusCard
            active={statusPick === 'out_of_reach'}
            stage="out_of_reach"
            title="Out of Reach"
            hint={oorHint}
            onClick={() => setStatusPick('out_of_reach')}
          />
        )}
        <StatusCard
          active={statusPick === 'reached'}
          stage="reached"
          title="Reached"
          hint="Spoke — watch fuel · 5 BD (else Pool)"
          onClick={() => setStatusPick('reached')}
        />
        <StatusCard
          active={statusPick === 'vacation'}
          stage="vacation"
          title="Vacation"
          hint="Away — 14-day hold → Ops path"
          onClick={() => setStatusPick('vacation')}
        />
        <StatusCard
          active={statusPick === 'dissatisfied'}
          stage="dissatisfied"
          title="Dissatisfied"
          hint="Unhappy → stays with Sales"
          onClick={() => setStatusPick('dissatisfied')}
        />
      </div>

      {statusPick === 'dissatisfied' && <DissatisfiedForm {...props} />}

      {statusPick === 'vacation' && (
        <input
          value={props.reasonNote}
          onChange={(e) => props.setReasonNote(e.target.value)}
          placeholder="Return date / vacation note (recommended)…"
          className="ss-in"
          style={s(
            'height:38px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--violet) 40%,var(--border));background:var(--surface);color:var(--text);font-size:13px',
          )}
        />
      )}

      {statusPick && statusPick !== 'dissatisfied' && (
        <button
          type="button"
          disabled={busy}
          onClick={props.onConfirmStage}
          style={s(
            `height:46px;width:100%;border:none;border-radius:var(--radius-md);background:${pickColor};color:${STAGE_ON};font-weight:800;font-size:15px;letter-spacing:.01em;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.85 : 1};box-shadow:0 8px 22px color-mix(in srgb,${pickColor} 35%,transparent)`,
          )}
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
      )}

      {isOverdue(row) && showOutOfReach && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAct('no_action_2bd')}
          style={s(
            'height:34px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:transparent;color:var(--danger);font-weight:700;font-size:12px;cursor:pointer',
          )}
        >
          Escalate — no action in 2 BD
        </button>
      )}
    </section>
  );
}

function StatusCard(props: {
  active: boolean;
  stage: Exclude<StatusPick, ''>;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  const { color, icon } = STAGE_CARD[props.stage];
  const border = props.active ? color : `color-mix(in srgb,${color} 42%,var(--border))`;
  const bg = props.active
    ? `color-mix(in srgb,${color} 18%,var(--surface))`
    : `color-mix(in srgb,${color} 8%,var(--surface))`;
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      style={s(
        `text-align:left;padding:13px 12px;border-radius:var(--radius-md);border:1.5px solid ${border};background:${bg};cursor:pointer;transition:border-color .15s,background .15s,transform .12s,box-shadow .15s;box-shadow:${props.active ? `0 0 0 1px color-mix(in srgb,${color} 55%,transparent),0 10px 24px color-mix(in srgb,${color} 18%,transparent)` : 'none'};transform:${props.active ? 'translateY(-1px)' : 'none'}`,
      )}
    >
      <div style={s('display:flex;align-items:center;gap:9px')}>
        <span
          style={s(
            `width:30px;height:30px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${color} 22%,transparent);color:${color}`,
          )}
        >
          <Icon name={icon} size={15} strokeWidth={2.5} color={color} />
        </span>
        <div style={s(`font-size:14px;font-weight:800;color:${color}`)}>{props.title}</div>
      </div>
      <div style={s('font-size:12px;color:var(--text2);margin-top:8px;line-height:1.4;padding-left:39px')}>
        {props.hint}
      </div>
    </button>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <div
      style={s(
        'font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)',
      )}
    >
      {children}
    </div>
  );
}

export function InfoBanner({ title, children }: { title: string; children: string }) {
  return (
    <div
      style={s(
        'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:13px;color:var(--text2);line-height:1.45',
      )}
    >
      <strong style={s('color:var(--text)')}>{title}</strong> {children}
    </div>
  );
}

export function ToneBtn({
  label,
  onClick,
  busy,
  tone = 'accent',
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  tone?: 'accent' | 'warn' | 'danger' | 'muted';
}) {
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
        `height:36px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,${col} 35%,var(--border));background:color-mix(in srgb,${col} 12%,transparent);color:${col};font-weight:700;font-size:13px;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.7 : 1}`,
      )}
    >
      {label}
    </button>
  );
}
