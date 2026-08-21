/**
 * Reopen a signed-off phase — the desk's way back.
 *
 * The rail only ever moved forward, so a phase passed on the wrong reading, or on facts a later
 * correction has changed, had no remedy short of a database edit. This is the control the desk asked
 * for: "return to a previous stage, refix".
 *
 * A DIALOG, not a button, because a reason is required. `ds/Dialog` rather than a `window.confirm`:
 * the reason has to be typed, and the copy has to say what reopening actually costs — every phase after
 * this one is un-decided too, since a later sign-off made on facts this phase is reconsidering is not a
 * sign-off worth keeping. That sentence is the whole point of the dialog; a bare "Reopen?" would hide it.
 *
 * It never appears on a DECIDED case. Un-approving a live credit line is a separate, admin-gated act
 * with its own audit trail — the server refuses it here too (`loadWorkable`), so the two agree.
 */
import { useState } from 'react';
import { Button, Dialog, Textarea } from '@/ds';

export function CaseReopenButton({
  phaseLabel,
  laterPhases,
  busy,
  onReopen,
}: {
  phaseLabel: string;
  /** How many applicable phases sit after this one — what the agent is giving up. */
  laterPhases: number;
  busy: boolean;
  onReopen: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const ready = reason.trim().length >= 3;

  return (
    <>
      <Button variant="ghost" size="sm" icon="undo" onClick={() => setOpen(true)}>
        Reopen
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setReason('');
        }}
        title={`Reopen ${phaseLabel}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="undo"
              loading={busy}
              disabled={!ready}
              onClick={() => {
                onReopen(reason.trim());
                setOpen(false);
                setReason('');
              }}
            >
              Reopen phase
            </Button>
          </>
        }
      >
        <p className="va-pane-body">
          The case returns to {phaseLabel} and its decision is withdrawn.
          {laterPhases > 0
            ? ` The ${laterPhases} phase${laterPhases === 1 ? '' : 's'} after it are un-decided too — a sign-off made on facts this phase is reconsidering is not one to keep. Findings already recorded stay on each phase; only the verdicts go.`
            : ' Findings already recorded stay on the phase; only the verdict goes.'}
        </p>
        {/* `Textarea` carries no label prop by design; the desk's own panes pair it with
            `.va-field-label`, which is also what gives the field the rest of the form's type. */}
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-reopen-reason">
            Why is it being reopened?
          </label>
          <Textarea
            id="va-reopen-reason"
            value={reason}
            rows={3}
            placeholder="What was wrong, or what changed."
            onChange={(e) => setReason(e.currentTarget.value)}
            {...(reason.trim().length > 0 && !ready
              ? { invalid: true, message: 'A few words at least — this goes on the case timeline.' }
              : { message: 'Recorded on the case timeline and in the audit log.' })}
          />
        </div>
      </Dialog>
    </>
  );
}
