/**
 * Move a case to its next stage — offering only the moves the Zoho Blueprint allows.
 *
 * REPLACES "Advance stage", which walked a list and pretended the process was linear. It never
 * was: from Connected a case goes to a plan, to an agency, or to closed, and almost every stage
 * can jump straight back to Connected when the debtor finally picks up. A single forward arrow
 * could express none of that.
 *
 * The moves come from the server (`bundle.transitions`), not from a copy of the graph kept here,
 * so the desk cannot drift from what the API will accept. Each is labelled with the Blueprint's
 * own wording — "Refuses", "All agencies failed", "120 days · no payment → pick next agency" —
 * because that is the phrase collectors already use for the decision.
 */
import { useState } from 'react';
import { Button, Dialog, Textarea, useToast } from '@/ds';
import type { CollectionCaseRow } from '@/api/collection';
import { setStage, type StageTransition } from '@/api/collectionDesk';
import { caseName, stageLabel } from '../cases/casesModel';
import { ActionField } from './ActionField';

export function StageMoveDialog({
  row,
  transitions,
  /** Which court the $8,000 line points at. Marks the recommended one; never blocks the other. */
  suggestedCourt,
  open,
  onClose,
  onDone,
}: {
  row: CollectionCaseRow;
  transitions: StageTransition[];
  suggestedCourt: 'small_claims' | 'civil_court' | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [chosen, setChosen] = useState<StageTransition | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (transition: StageTransition): Promise<void> => {
    setSaving(true);
    try {
      await setStage(row.id, { stage: transition.to, ...(note.trim() ? { note: note.trim() } : {}) });
      toast({
        intent: 'success',
        title: transition.label,
        description: `${caseName(row)} is now ${stageLabel(transition.to).toLowerCase()}.`,
      });
      onDone();
      onClose();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not move the case', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Move stage"
      subtitle={`${caseName(row)} is on ${stageLabel(row.collectionStage)}`}
      size="md"
      footer={
        <div className="ca-foot">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="arrow_forward"
            disabled={!chosen || saving}
            loading={saving}
            onClick={() => chosen && void submit(chosen)}
          >
            {chosen ? chosen.label : 'Choose a move'}
          </Button>
        </div>
      }
    >
      <p className="ca-note" data-tone="info">
        These are the moves the process allows from here. The list comes from the same rule the
        API enforces, so anything missing is a move the process does not permit.
      </p>
      <div className="cd-moves">
        {transitions.length === 0 ? (
          <p className="cd-moves-empty">
            There is nowhere to move this case from {stageLabel(row.collectionStage)}.
          </p>
        ) : (
          transitions.map((t) => {
            const recommended = suggestedCourt !== null && t.to === suggestedCourt;
            return (
              <button
                key={`${t.to}:${t.label}`}
                type="button"
                className="cd-move"
                data-chosen={chosen?.label === t.label ? 'true' : undefined}
                data-recommended={recommended ? 'true' : undefined}
                disabled={saving}
                onClick={() => setChosen(t)}
              >
                <span className="cd-move-label">{t.label}</span>
                <span className="cd-move-to">→ {stageLabel(t.to)}</span>
                {t.hint ? <span className="cd-move-hint">{t.hint}</span> : null}
                {recommended ? <span className="cd-move-flag">Matches this debt</span> : null}
              </button>
            );
          })
        )}
      </div>

      <ActionField label="Note" hint="Optional. Goes on the timeline beside the move.">
        <Textarea
          rows={3}
          value={note}
          placeholder="Anything the next person needs to know."
          onChange={(e) => setNote(e.target.value)}
        />
      </ActionField>
    </Dialog>
  );
}
