import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './ApprovalBar.module.css';

export type ApprovalRisk = 'low' | 'medium' | 'high';
export type ApprovalOutcome = 'approved' | 'rejected';
export type ApprovalBusy = 'approve' | 'reject';

export interface ApprovalBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * A short imperative naming the action — "Update 3 deals in Zoho CRM", "Send the renewal email".
   * It is the accessible name of the whole bar and the text of the one announcement, so it must
   * make sense read on its own, with nothing around it.
   */
  action: string;
  /**
   * WHAT HAPPENS IF THIS IS APPROVED, in plain words, including anything irreversible. Required by
   * the type on purpose — see the docblock. "Sets Stage to Closed Won on 3 deals. Writes to the live
   * CRM; the previous stage is not recoverable." is a summary. "Proceed?" is not.
   */
  summary: ReactNode;
  /**
   * How much damage a wrong approval does. Optional — omit it when the summary already carries the
   * consequence. Rendered as an icon + a WORD, never as a colour on its own.
   */
  risk?: ApprovalRisk;
  onApprove: () => void;
  onReject: () => void;
  /** Default `Approve`. The action is appended to the accessible name either way. */
  approveLabel?: string;
  /** Default `Reject`. */
  rejectLabel?: string;
  /**
   * Which side is running. Shows a spinner on that button and blocks BOTH — a half-executed
   * approval is the one state this component must never let a second click produce.
   */
  busy?: ApprovalBusy | null;
  /**
   * The decision, once made. The bar stops being a control and becomes the record of what was
   * decided. Set it as soon as the call settles: a resolved approval that still renders two live
   * buttons is a transcript that invites the same person to approve the same thing twice.
   */
  outcome?: ApprovalOutcome | null;
  /** Beside the outcome — who decided, when, or what the run returned. */
  outcomeNote?: ReactNode;
  /**
   * The evidence: an `InlineDiff`, a record list, a query preview. Optional, and it never replaces
   * `summary` — a diff shows what changes, only words say what happens.
   */
  children?: ReactNode;
  /**
   * Announce arrival and outcome in this component's own polite live region. Default on. Turn it
   * OFF when the host surface already owns a live region that reports the same transitions —
   * two polite regions describing one event interleave into noise.
   */
  announce?: boolean;
}

const RISK_ICON: Record<ApprovalRisk, IconName> = {
  low: 'info',
  medium: 'warning',
  high: 'gpp_bad',
};

/** The word is the channel. The colour is the accelerator. */
const RISK_WORD: Record<ApprovalRisk, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

const OUTCOME_ICON: Record<ApprovalOutcome, IconName> = {
  approved: 'check_circle',
  rejected: 'block',
};

const OUTCOME_WORD: Record<ApprovalOutcome, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * The human-in-the-loop gate: an agent has proposed an action and will not run it until a person
 * says yes.
 *
 * IT MUST SAY WHAT WILL HAPPEN. `summary` is a required prop and that is the whole design. An
 * approval control whose label is "Confirm" over a body that says "The agent would like to proceed"
 * is how people approve things they did not understand, and the cost lands on a live CRM, a
 * customer's inbox or a payment. The type system is the only place that rule can actually be
 * enforced, so it is enforced there.
 *
 * FOCUS IS NEVER STOLEN, AND APPROVE IS NEVER AUTOFOCUSED. There is no `autoFocus` prop, not even
 * for the safe side. Two reasons: this bar arrives mid-stream, so moving focus would yank a
 * keyboard user out of the composer they are typing in; and any default focus on the consequential
 * button turns a reflexive Enter — the keystroke that sent the message — into an approval. The bar
 * announces itself instead, and is reached by Tab in reading order.
 *
 * KEYBOARD
 * - Tab order is Reject, then Approve. The safe option comes first deliberately: a hurried keyboard
 *   user lands on the one that cannot hurt them.
 * - Enter / Space activate the focused button, because they are native `<button>`s.
 * - THERE IS NO ACCELERATOR. No Cmd+Enter to approve, no `y`/`n`. Approving must cost a deliberate
 *   Tab to a named target; a shortcut that fires while focus is elsewhere is an accidental approval
 *   with no undo, and this component has no undo to offer.
 * - While `busy`, both buttons are disabled and `aria-busy` is set on the bar.
 *
 * SCREEN READERS — one polite live region, transitions only: "Approval required: …" on arrival,
 * "Approving…" while it runs, "Approved: …" when it settles. Three utterances for the life of the
 * bar. The Approve button is additionally described by the summary, so tabbing to it reads the
 * consequence before the user can press it.
 *
 * WHEN NOT TO USE IT
 * - An action the user themselves just triggered. That is a `Button`, possibly with a confirm
 *   dialog. This bar is for something the AGENT proposed.
 * - A destructive action a person initiated and must confirm — use a modal confirm, which is
 *   focus-trapped and blocking. This bar is deliberately non-blocking: the transcript scrolls past
 *   it, so it must never be the only thing standing between a user and data loss they asked for.
 * - More than two outcomes. An approve/reject/edit/defer set is an `ElicitationPicker`, not this.
 * - A notification that something already ran. Nothing here is a control at that point; render the
 *   result, not a disabled gate.
 */
export const ApprovalBar = forwardRef<HTMLDivElement, ApprovalBarProps>(function ApprovalBar(
  {
    action,
    summary,
    risk,
    onApprove,
    onReject,
    approveLabel = 'Approve',
    rejectLabel = 'Reject',
    busy = null,
    outcome = null,
    outcomeNote,
    children,
    announce = true,
    className,
    ...rest
  },
  ref,
) {
  const baseId = useId();
  const actionId = `${baseId}-action`;
  const summaryId = `${baseId}-summary`;

  // TRANSITIONS ONLY — never a running commentary. Arrival, in-flight, settled: three states, and
  // the string is stable within each, so a polite region announces each one exactly once.
  const live = outcome
    ? `${OUTCOME_WORD[outcome]}: ${action}`
    : busy === 'approve'
      ? 'Approving'
      : busy === 'reject'
        ? 'Rejecting'
        : `Approval required: ${action}`;

  return (
    <div
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      // A group, not a region: a transcript with nine approvals in it would otherwise put nine
      // landmarks in the screen reader's landmark list.
      role="group"
      aria-labelledby={actionId}
      data-risk={risk}
      data-outcome={outcome ?? undefined}
      aria-busy={busy ? true : undefined}
      {...rest}
    >
      <div className={styles.head}>
        <p className={styles.action} id={actionId}>
          {action}
        </p>
        {risk ? (
          <span className={styles.risk} data-risk={risk}>
            {/* Unlabelled: the word beside it says the same thing, and announcing both makes a
                screen reader read "warning High risk". */}
            <Icon name={RISK_ICON[risk]} size="sm" />
            {RISK_WORD[risk]}
          </span>
        ) : null}
      </div>

      <p className={styles.summary} id={summaryId}>
        {summary}
      </p>

      {children != null ? <div className={styles.evidence}>{children}</div> : null}

      {outcome ? (
        <p className={styles.outcome} data-outcome={outcome}>
          <Icon name={OUTCOME_ICON[outcome]} size="sm" />
          <span className={styles.outcomeWord}>{OUTCOME_WORD[outcome]}</span>
          {outcomeNote != null ? <span className={styles.outcomeNote}>{outcomeNote}</span> : null}
        </p>
      ) : (
        <div className={styles.actions}>
          {/* Reject first in the DOM and first on the left, so reading order, tab order and visual
              order are the same sequence and the safe option is the one you reach first. */}
          <Button
            className={styles.reject}
            variant="danger"
            // "Reject" alone tells a screen-reader user nothing about what they are rejecting. The
            // visible label is the first word of the accessible name, so label-in-name holds.
            aria-label={`${rejectLabel}: ${action}`}
            loading={busy === 'reject'}
            disabled={busy === 'approve' || undefined}
            onClick={onReject}
          >
            {rejectLabel}
          </Button>
          <Button
            className={styles.approve}
            variant="primary"
            aria-label={`${approveLabel}: ${action}`}
            // Focusing the consequential button reads the consequence. This is the accessibility
            // half of "state plainly what will happen".
            aria-describedby={summaryId}
            loading={busy === 'approve'}
            disabled={busy === 'reject' || undefined}
            onClick={onApprove}
          >
            {approveLabel}
          </Button>
        </div>
      )}

      {announce ? (
        <p className={styles.srOnly} aria-live="polite">
          {live}
        </p>
      ) : null}
    </div>
  );
});
