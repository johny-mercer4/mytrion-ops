/**
 * Forced post-call stage modal for Retention New cases.
 * Portaled into `.ss-root` so theme CSS vars resolve (body portals lose tokens).
 */
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { s } from './dc';
import { StageStep, type PendingCallLog, type StatusPick } from './RetentionWizardSteps';
import {
  formatUsPhone,
  type RetentionCaseRow,
  type RetentionDissatisfactionReason,
  type RetentionPhase1Outcome,
} from './retentionData';

function fmtDuration(ms?: number): string {
  const secs = Math.round((ms ?? 0) / 1000);
  if (secs <= 0) return 'no answer';
  const m = Math.floor(secs / 60);
  const rem = secs % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

export function RetentionCallStageModal(props: {
  companyName: string;
  pendingCall: PendingCallLog;
  row: RetentionCaseRow;
  busy: boolean;
  reason: RetentionDissatisfactionReason | '';
  reasonNote: string;
  statusPick: StatusPick;
  setStatusPick: (v: StatusPick) => void;
  setReason: (v: RetentionDissatisfactionReason | '') => void;
  setReasonNote: (v: string) => void;
  onAct: (o: RetentionPhase1Outcome) => Promise<void>;
  onDissatisfied: (e: FormEvent) => void;
  onConfirmStage: () => void;
}) {
  const phone = formatUsPhone(props.pendingCall.peer) || props.pendingCall.peer;
  const bits = [
    phone || undefined,
    fmtDuration(props.pendingCall.durationMs),
    props.pendingCall.result || undefined,
  ].filter(Boolean);

  if (typeof document === 'undefined') return null;
  // Same host as AutoFloatingDrop — theme tokens live under `.ss-root`.
  const host = document.querySelector('.ss-root') ?? document.body;

  return createPortal(
    <div
      role="presentation"
      style={s(
        'position:fixed;inset:0;z-index:160;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(3,7,14,.72);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)',
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Call ended — choose stage"
        onClick={(e) => e.stopPropagation()}
        style={s(
          'width:100%;max-width:540px;max-height:88vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden',
        )}
      >
        <div style={s('flex-shrink:0;padding:18px 22px;border-bottom:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;gap:10px')}>
            <span
              style={s(
                'width:36px;height:36px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)',
              )}
            >
              <Icon name="calls" size={17} />
            </span>
            <div style={s('flex:1;min-width:0')}>
              <div style={s('font-size:16px;font-weight:800;color:var(--text)')}>
                Call ended — update {props.companyName || 'case'}
              </div>
              <div
                style={s(
                  "font-size:13px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px",
                )}
              >
                {bits.join(' · ')}
              </div>
            </div>
          </div>
          <div style={s('font-size:13px;color:var(--text2);margin-top:10px;line-height:1.4')}>
            Pick a stage to move the card — required after this call.
          </div>
        </div>

        <div
          className="ss-scroll"
          style={s('flex:1;min-height:0;padding:16px 20px 20px;display:flex;flex-direction:column')}
        >
          <StageStep
            row={props.row}
            busy={props.busy}
            reason={props.reason}
            reasonNote={props.reasonNote}
            statusPick={props.statusPick}
            showOutOfReach
            embedded
            title="Choose stage"
            setStatusPick={props.setStatusPick}
            setReason={props.setReason}
            setReasonNote={props.setReasonNote}
            onAct={props.onAct}
            onDissatisfied={props.onDissatisfied}
            onConfirmStage={props.onConfirmStage}
          />
        </div>
      </div>
    </div>,
    host,
  );
}
