/**
 * Retention Phase 1 stage wizard:
 *   New → Call → choose stage → stage workflow (OoR attempts / Reached watch / …)
 */
import type { FormEvent } from 'react';
import { s } from './dc';
import {
  AttemptStep,
  CallEndedBanner,
  CallFirstBlock,
  InfoBanner,
  StageStep,
  ToneBtn,
  WizardChrome,
  type PendingCallLog,
  type StatusPick,
} from './RetentionWizardSteps';
import type {
  RetentionCaseRow,
  RetentionChannel,
  RetentionDissatisfactionReason,
  RetentionPhase1Outcome,
} from './retentionData';

export type { PendingCallLog, StatusPick };

/** UI step for New cases (before a stage is saved). */
export type NewWizardStep = 'call' | 'stage';

export function RetentionCaseActions(props: {
  row: RetentionCaseRow;
  busy: boolean;
  contactPhone: string | null;
  newWizardStep: NewWizardStep;
  setNewWizardStep: (v: NewWizardStep) => void;
  /** Call ended while New — must pick a stage. */
  forceStage: boolean;
  /** Call ended while OoR — must log RC attempt. */
  forceAttempt: boolean;
  pendingCall: PendingCallLog | null;
  reason: RetentionDissatisfactionReason | '';
  reasonNote: string;
  channel: RetentionChannel;
  attemptNote: string;
  evidenceFile: File | null;
  evidencePreview: string | null;
  statusPick: StatusPick;
  setStatusPick: (v: StatusPick) => void;
  setReason: (v: RetentionDissatisfactionReason | '') => void;
  setReasonNote: (v: string) => void;
  setChannel: (v: RetentionChannel) => void;
  setAttemptNote: (v: string) => void;
  setEvidenceFile: (f: File | null) => void;
  onCall: () => void;
  onAct: (o: RetentionPhase1Outcome) => Promise<void>;
  onDissatisfied: (e: FormEvent) => void;
  onConfirmStage: () => void;
  onLogPhoneCall: () => Promise<void>;
  onLogOtherChannel: () => Promise<void>;
}) {
  const {
    row,
    busy,
    contactPhone,
    forceStage,
    pendingCall,
    onAct,
    newWizardStep,
    setNewWizardStep,
  } = props;
  const isNew =
    row.statusCode === 'p1_new' ||
    row.statusCode === 'p1_in_progress' ||
    row.statusCode === 'p1_pool_assigned';
  const outOfReach = row.statusCode === 'p1_out_of_reach';
  const watchingReached = row.statusCode === 'p1_reached';
  const inVacation =
    row.statusCode === 'p1_vacation' || row.statusCode === 'p1_vacation_followup';
  const awaitingOps = row.statusCode === 'p1_awaiting_ops';
  const dissatisfied =
    row.agentOutcome === 'dissatisfied' || row.statusCode === 'p1_dissatisfied';

  if (dissatisfied) {
    return (
      <div style={s('display:flex;flex-direction:column;gap:12px')}>
        <WizardChrome stage="Dissatisfied" stepLabel="Handed to Retention" />
        <InfoBanner title="Dissatisfied — routed to Retention immediately.">
          No Open Pool. Retention owns the 10 BD watch. Any new fuel still closes the case
          automatically.
        </InfoBanner>
      </div>
    );
  }

  if (watchingReached) {
    return (
      <div style={s('display:flex;flex-direction:column;gap:12px')}>
        <WizardChrome stage="Reached" stepLabel="Watching for fuel · 5 BD" />
        <InfoBanner title="Reached — no more call attempts.">
          Wait for a new transaction (hourly sync closes the case). If none within 5 business days →
          Sales Open Pool (Ryan + deal owner notified).
        </InfoBanner>
      </div>
    );
  }

  if (awaitingOps) {
    return (
      <div style={s('display:flex;flex-direction:column;gap:12px')}>
        <WizardChrome stage="Vacation" stepLabel="Ops confirm" />
        <div style={s('font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)')}>
          Ops Manager — vacation confirm
        </div>
        <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
          <ToneBtn
            label="Confirm on vacation → New"
            busy={busy}
            onClick={() => void onAct('ops_confirm_vacation')}
          />
          <ToneBtn
            label="Not on vacation / OoR → CITI"
            busy={busy}
            tone="danger"
            onClick={() => void onAct('ops_deny_vacation')}
          />
        </div>
      </div>
    );
  }

  if (inVacation) {
    const followUp = row.statusCode === 'p1_vacation_followup';
    return (
      <div style={s('display:flex;flex-direction:column;gap:12px')}>
        <WizardChrome
          stage="Vacation"
          stepLabel={followUp ? 'Follow-up · 2 BD' : 'Countdown · 14 days'}
        />
        <InfoBanner
          title={
            followUp
              ? 'Vacation follow-up — agent check · 2 BD.'
              : 'Vacation — 14-day hold (no channel attempts).'
          }
        >
          {followUp
            ? 'If still quiet, Ops confirms vacation (back to New) or denies (→ CITI). Any fuel closes the case.'
            : 'Client confirmed away. After 14 days → follow-up task. Any new fuel closes the case automatically.'}
          {row.reasonNote ? ` Return note: ${row.reasonNote}` : ''}
        </InfoBanner>
      </div>
    );
  }

  if (isNew) {
    const onStageStep = newWizardStep === 'stage' || forceStage;
    return (
      <div style={s('display:flex;flex-direction:column;gap:14px')}>
        <WizardChrome
          stage="New"
          steps={[
            { n: 1, label: 'Call', active: !onStageStep, done: onStageStep },
            { n: 2, label: 'Stage', active: onStageStep, done: false },
          ]}
        />
        {!onStageStep ? (
          <CallFirstBlock
            busy={busy}
            contactPhone={contactPhone}
            onCall={props.onCall}
            onContinue={() => setNewWizardStep('stage')}
          />
        ) : (
          <>
            {forceStage && pendingCall && <CallEndedBanner pendingCall={pendingCall} />}
            <StageStep {...props} showOutOfReach title="Choose stage" />
            {!forceStage && (
              <button
                type="button"
                onClick={() => setNewWizardStep('call')}
                style={s(
                  'align-self:flex-start;background:none;border:none;padding:0;font-size:11px;font-weight:700;color:var(--muted);cursor:pointer;text-decoration:underline',
                )}
              >
                ← Back to call
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (outOfReach) {
    return (
      <div style={s('display:flex;flex-direction:column;gap:14px')}>
        <WizardChrome
          stage="Out of Reach"
          stepLabel={`Attempt ${row.outOfReachAttempts}/5 · 5 BD each`}
        />
        <AttemptStep {...props} />
        {/* After every attempt (RC or other), stage picker includes OoR again. */}
        <StageStep
          {...props}
          showOutOfReach
          alreadyOutOfReach
          title="Choose stage"
        />
      </div>
    );
  }

  return (
    <div style={s('font-size:12px;color:var(--muted)')}>
      This case is waiting on the next workflow step (pool / sync).
    </div>
  );
}
