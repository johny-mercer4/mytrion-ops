/** Step UI blocks for the Retention Phase 1 case wizard. */
import type { FormEvent } from 'react';
import { Icon } from './icons';
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
            'font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)',
          )}
        >
          Stage
        </div>
        <div style={s('font-size:14px;font-weight:800;color:var(--text);margin-top:2px')}>
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
            "font-size:11px;font-weight:700;color:var(--muted);font-family:'JetBrains Mono',monospace",
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
        `display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${col}`,
      )}
    >
      <span
        style={s(
          `width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;border:1px solid ${col};background:${active || done ? 'color-mix(in srgb,var(--accent) 14%,transparent)' : 'transparent'}`,
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
        'padding:12px 14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--border));background:color-mix(in srgb,var(--warn) 12%,transparent);font-size:12px;color:var(--text);line-height:1.45',
      )}
    >
      <div style={s('font-weight:800')}>Call ended — choose a stage.</div>
      {line ? (
        <div
          style={s(
            "margin-top:6px;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;letter-spacing:.02em;color:var(--accent-text)",
          )}
        >
          {line}
        </div>
      ) : null}
    </div>
  );
}

export function CallFirstBlock(props: {
  busy: boolean;
  contactPhone: string | null;
  onCall: () => void;
  onContinue: () => void;
}) {
  const { busy, contactPhone } = props;
  const phone = formatUsPhone(contactPhone) || contactPhone?.trim() || '';
  return (
    <section
      style={s(
        'padding:14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);display:flex;flex-direction:column;gap:12px',
      )}
    >
      <div>
        <SectionTitle>Step 1 · Call the client</SectionTitle>
        <div style={s('font-size:12px;color:var(--text2);line-height:1.45;margin-top:6px')}>
          2 business days to act. Call first, then choose Out of Reach, Reached, Dissatisfied, or
          Vacation. A RingCentral call auto-logs attempt 1 when you move to Out of Reach.
        </div>
      </div>

      {phone ? (
        <div
          style={s(
            "font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;letter-spacing:.03em;color:var(--accent-text)",
          )}
        >
          {phone}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || !contactPhone?.trim()}
        onClick={props.onCall}
        className="ss-btn-p"
        style={s(
          `height:44px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:${busy || !contactPhone ? 'not-allowed' : 'pointer'};opacity:${!contactPhone ? 0.5 : 1};display:inline-flex;align-items:center;justify-content:center;gap:8px`,
        )}
      >
        <Icon name="calls" size={16} color="currentColor" />
        {phone ? `Call ${phone}` : 'No phone on file'}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={props.onContinue}
        style={s(
          'height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-weight:700;font-size:12px;cursor:pointer',
        )}
      >
        Continue to choose stage →
      </button>
    </section>
  );
}

export function AttemptStep(props: {
  row: RetentionCaseRow;
  busy: boolean;
  contactPhone: string | null;
  forceAttempt: boolean;
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
  const { busy, contactPhone, forceAttempt, pendingCall, row } = props;
  const brand =
    props.channel !== 'ringcentral' ? CHANNEL_BRAND[props.channel] : null;
  const phone = formatUsPhone(contactPhone) || contactPhone?.trim() || '';
  const noteRequired = !props.evidenceFile;
  const noteMissing = noteRequired && !props.attemptNote.trim();

  return (
    <section
      style={s(
        `padding:14px;border-radius:var(--radius-md);border:1px solid ${forceAttempt ? 'color-mix(in srgb,var(--warn) 45%,var(--border))' : 'var(--border)'};background:${forceAttempt ? 'color-mix(in srgb,var(--warn) 8%,var(--alt))' : 'var(--alt)'};display:flex;flex-direction:column;gap:12px`,
      )}
    >
      <div>
        <SectionTitle>Log a channel attempt</SectionTitle>
        <div style={s('font-size:12px;color:var(--text2);line-height:1.45;margin-top:6px')}>
          RingCentral calls log automatically ({row.outOfReachAttempts}/5). Other channels need a
          note or screenshot. At 5 → Open Pool.
        </div>
      </div>

      {forceAttempt && pendingCall && (
        <div
          style={s(
            'padding:12px 14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--border));background:color-mix(in srgb,var(--warn) 12%,transparent);display:flex;flex-direction:column;gap:10px',
          )}
        >
          <div style={s('font-size:12px;color:var(--text);line-height:1.4')}>
            <strong>{busy ? 'Logging RingCentral attempt…' : 'Call ended — retry logging.'}</strong>
            {callPeerLine(pendingCall) ? (
              <div
                style={s(
                  "margin-top:6px;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--accent-text)",
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
                'height:36px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:12px;cursor:pointer',
              )}
            >
              Retry RingCentral log
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={busy || !contactPhone?.trim()}
        onClick={props.onCall}
        className="ss-btn-p"
        style={s(
          `height:40px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:${busy || !contactPhone ? 'not-allowed' : 'pointer'};opacity:${!contactPhone ? 0.5 : 1};display:inline-flex;align-items:center;justify-content:center;gap:8px`,
        )}
      >
        <Icon name="calls" size={16} color="currentColor" />
        {phone ? `Call ${phone}` : 'No phone on file'}
      </button>

      {!forceAttempt && (
        <>
          <div style={s('font-size:11px;font-weight:700;color:var(--muted)')}>
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
            <div style={s(`font-size:12px;font-weight:700;color:${brand.color}`)}>
              Logging via {brand.label}
            </div>
          )}
          <input
            value={props.attemptNote}
            onChange={(e) => props.setAttemptNote(e.target.value)}
            placeholder={noteRequired ? 'Result note (required)…' : 'Result note (optional with screenshot)…'}
            className="ss-in"
            aria-required={noteRequired}
            style={s(
              `height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid ${noteMissing ? 'var(--danger)' : 'var(--border)'};background:var(--surface);color:var(--text);font-size:12px;box-shadow:${noteMissing ? '0 0 0 1px color-mix(in srgb,var(--danger) 35%,transparent)' : 'none'}`,
            )}
          />
          {noteMissing && (
            <div style={s('font-size:11px;font-weight:700;color:var(--danger);margin-top:-6px')}>
              Note required when there’s no screenshot
            </div>
          )}
          <ScreenshotField
            preview={props.evidencePreview}
            fileName={props.evidenceFile?.name ?? null}
            onPick={props.setEvidenceFile}
          />
          <button
            type="button"
            disabled={
              busy ||
              props.channel === 'ringcentral' ||
              (!props.evidenceFile && !props.attemptNote.trim())
            }
            onClick={() => void props.onLogOtherChannel()}
            style={s(
              `height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-weight:700;font-size:12px;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.7 : 1};display:inline-flex;align-items:center;justify-content:center;gap:8px`,
            )}
          >
            {busy && <Icon name="refresh" size={14} style={s('animation:ss-spin .9s linear infinite')} />}
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
  /** Already on OoR — confirming OoR stays on the stage and refreshes the 5 BD timer. */
  alreadyOutOfReach?: boolean;
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
  const oorHint =
    row.outOfReachAttempts >= 5
      ? '5/5 → Open Pool'
      : alreadyOoR
        ? `Stay OoR · attempt ${row.outOfReachAttempts}/5 · 5 BD`
        : 'Channel attempts · 5×5 BD';

  return (
    <section
      style={s(
        'padding:14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);display:flex;flex-direction:column;gap:12px',
      )}
    >
      <div>
        <SectionTitle>{props.title ?? 'Choose stage'}</SectionTitle>
        <div style={s('font-size:12px;color:var(--text2);line-height:1.45;margin-top:6px')}>
          {alreadyOoR
            ? 'After each attempt, pick a stage. Out of Reach stays available until attempt 5 → Open Pool.'
            : showOutOfReach
              ? 'Pick one stage. The card moves to that column on the board.'
              : 'Reached, Dissatisfied, or Vacation — or keep logging OoR attempts above.'}
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
        {showOutOfReach && (
          <StatusCard
            active={statusPick === 'out_of_reach'}
            title="Out of Reach"
            hint={oorHint}
            onClick={() => setStatusPick('out_of_reach')}
          />
        )}
        <StatusCard
          active={statusPick === 'reached'}
          title="Reached"
          hint="Spoke — watch fuel · 5 BD (else Pool)"
          onClick={() => setStatusPick('reached')}
        />
        <StatusCard
          active={statusPick === 'vacation'}
          title="Vacation"
          hint="Away — 14-day hold → Ops path"
          onClick={() => setStatusPick('vacation')}
        />
        <StatusCard
          active={statusPick === 'dissatisfied'}
          title="Dissatisfied"
          hint="Unhappy → Retention (not Pool)"
          onClick={() => setStatusPick('dissatisfied')}
          tone="danger"
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
            'height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px',
          )}
        />
      )}

      {statusPick && statusPick !== 'dissatisfied' && (
        <button
          type="button"
          disabled={busy}
          onClick={props.onConfirmStage}
          className="ss-btn-p"
          aria-busy={busy}
          style={s(
            `height:42px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.85 : 1};display:inline-flex;align-items:center;justify-content:center;gap:8px`,
          )}
        >
          {busy && <Icon name="refresh" size={15} style={s('animation:ss-spin .9s linear infinite')} />}
          {busy
            ? 'Saving…'
            : statusPick === 'out_of_reach'
              ? alreadyOoR
                ? 'Continue Out of Reach →'
                : 'Move to Out of Reach →'
              : statusPick === 'reached'
                ? 'Save Reached — watch 5 BD'
                : statusPick === 'vacation'
                  ? 'Start vacation hold →'
                  : 'Save stage & close'}
        </button>
      )}

      {isOverdue(row) && showOutOfReach && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAct('no_action_2bd')}
          style={s(
            'height:34px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:transparent;color:var(--danger);font-weight:700;font-size:11px;cursor:pointer',
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
  title: string;
  hint: string;
  onClick: () => void;
  tone?: 'danger';
}) {
  const col = props.tone === 'danger' ? 'var(--danger)' : 'var(--accent)';
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      style={s(
        `text-align:left;padding:12px;border-radius:var(--radius-md);border:1px solid ${props.active ? col : 'var(--border)'};background:${props.active ? `color-mix(in srgb,${col} 12%,var(--surface))` : 'var(--surface)'};cursor:pointer`,
      )}
    >
      <div style={s(`font-size:13px;font-weight:800;color:${props.active ? col : 'var(--text)'}`)}>
        {props.title}
      </div>
      <div style={s('font-size:11px;color:var(--muted);margin-top:4px;line-height:1.35')}>
        {props.hint}
      </div>
    </button>
  );
}

export function SectionTitle({ children }: { children: string }) {
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

export function InfoBanner({ title, children }: { title: string; children: string }) {
  return (
    <div
      style={s(
        'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12px;color:var(--text2);line-height:1.45',
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
        `height:36px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,${col} 35%,var(--border));background:color-mix(in srgb,${col} 12%,transparent);color:${col};font-weight:700;font-size:12px;cursor:${busy ? 'wait' : 'pointer'};opacity:${busy ? 0.7 : 1}`,
      )}
    >
      {label}
    </button>
  );
}
