/**
 * Close a case.
 *
 * The five reasons are the REAL enum (`COLLECTION_CLOSED_REASONS`), not a new vocabulary invented
 * for the screen — the finder writes the same values and the list filters on them.
 *
 * `case_lost` is the only one that asks for a write-off amount, and the only one that says out
 * loud what closing does NOT do: the Array tradeline stays reported. Someone closing a $26k debt
 * should not have to already know that.
 */
import { useState } from 'react';
import { Button, Dialog, Input, Radio, RadioGroup, Textarea, useToast } from '@/ds';
import { closeCase } from '@/api/collectionDesk';
import { COLLECTION_CLOSED_REASONS, type CollectionCaseRow, type CollectionClosedReason } from '@/api/collection';
import { caseName } from '../cases/casesModel';
import { money, moneyExact } from '../collectionFormat';
import { ActionField, ActionNote } from './ActionField';
import { moneyInput } from './actionsModel';

const REASON_COPY: Record<CollectionClosedReason, { label: string; description: string }> = {
  paid_in_full: {
    label: 'Paid in full',
    description: 'The balance reached zero and every invoice settled.',
  },
  below_threshold: {
    label: 'Below threshold',
    description: 'What is left has fallen under the $100 the finder opens a case at.',
  },
  left_cmp: {
    label: 'Left CMP',
    description: 'The carrier is no longer on the platform. The debt stands; the case does not.',
  },
  case_lost: {
    label: 'Case lost',
    description: 'Uncollectable. Written off, and reported to Array as a P&L write-off.',
  },
  manual: {
    label: 'Closed manually',
    description: 'None of the above — say why in the note.',
  },
};

/** Enum order puts `manual` fourth; on screen it reads last, because it is the fallback. */
const REASON_ORDER: readonly CollectionClosedReason[] = [
  ...COLLECTION_CLOSED_REASONS.filter((r) => r !== 'manual'),
  'manual',
];

export function CloseCaseDialog({
  row,
  open,
  onClose,
  onDone,
}: {
  row: CollectionCaseRow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const outstanding = Number(row.totalDebtAmount) || 0;
  const [reason, setReason] = useState<CollectionClosedReason>(
    outstanding <= 0 ? 'paid_in_full' : 'case_lost',
  );
  const [writeOff, setWriteOff] = useState(outstanding > 0 ? outstanding.toFixed(2) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const wantsWriteOff = reason === 'case_lost' && outstanding > 0;
  const parsedWriteOff = moneyInput(writeOff);
  const writeOffBad = wantsWriteOff && parsedWriteOff === null;
  const noteRequired = reason === 'manual';
  const canSave = !writeOffBad && (!noteRequired || note.trim().length > 0);

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      await closeCase(row.id, {
        reason,
        ...(wantsWriteOff && parsedWriteOff ? { writeOffAmount: parsedWriteOff } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast({
        intent: reason === 'case_lost' ? 'warning' : 'success',
        title: 'Case closed',
        description: `${caseName(row)} — ${REASON_COPY[reason].label.toLowerCase()}.`,
      });
      onDone();
      onClose();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not close the case', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close this case"
      subtitle={`${caseName(row)} · ${money(row.totalDebtAmount)} outstanding`}
      size="md"
      footer={
        <div className="ca-foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={reason === 'case_lost' ? 'danger' : 'primary'}
            icon="flag"
            loading={saving}
            disabled={!canSave}
            onClick={() => void submit()}
          >
            {reason === 'case_lost' ? 'Close and write off' : 'Close the case'}
          </Button>
        </div>
      }
    >
      <div className="ca-body">
        <RadioGroup
          label="Reason"
          value={reason}
          onChange={(v) => setReason(v as CollectionClosedReason)}
        >
          {REASON_ORDER.map((r) => (
            <Radio
              key={r}
              value={r}
              label={REASON_COPY[r].label}
              description={REASON_COPY[r].description}
            />
          ))}
        </RadioGroup>

        {wantsWriteOff ? (
          <ActionField
            label="Amount written off"
            hint={writeOffBad ? 'Dollars and cents, e.g. 26120.00' : undefined}
          >
            <Input
              fullWidth
              inputMode="decimal"
              value={writeOff}
              invalid={writeOffBad}
              onChange={(e) => setWriteOff(e.currentTarget.value)}
            />
          </ActionField>
        ) : null}

        <ActionField
          label={noteRequired ? 'Note (required)' : 'Note'}
          hint="The last thing anyone reads if this is ever reopened."
        >
          <Textarea
            rows={3}
            autoGrow
            value={note}
            invalid={noteRequired && note.trim().length === 0}
            placeholder={
              reason === 'case_lost'
                ? 'Why this is uncollectable.'
                : 'Anything the next person needs to know.'
            }
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </ActionField>

        {reason === 'case_lost' ? (
          <ActionNote tone="danger">
            Writing off <b className="num">{moneyExact(row.totalDebtAmount)}</b>. Closing here does
            not withdraw the Array tradeline — it stays reported. Reopening restores the balance and
            increments the reopen count.
          </ActionNote>
        ) : null}
      </div>
    </Dialog>
  );
}
