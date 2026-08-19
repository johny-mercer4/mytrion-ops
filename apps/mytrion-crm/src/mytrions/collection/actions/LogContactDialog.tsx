/**
 * Log a contact attempt — the most-used write on the desk, and the one that feeds `Last touch`.
 *
 * The promise a debtor makes on a call is taken HERE rather than in a second dialog: it is one
 * action for the collector, and splitting it in two is how a promise ends up never recorded. The
 * server takes both in one request and writes two rows.
 */
import { useState } from 'react';
import { Button, DateField, Dialog, Input, Radio, RadioGroup, Switch, Textarea, useToast } from '@/ds';
import {
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  logContact,
  type ContactChannel,
  type ContactOutcome,
} from '@/api/collectionDesk';
import type { CollectionCaseRow } from '@/api/collection';
import { caseName } from '../cases/casesModel';
import { ActionField } from './ActionField';
import { moneyInput, todayIso } from './actionsModel';

const CHANNEL_LABEL: Record<ContactChannel, string> = {
  call: 'Call',
  email: 'Email',
  sms: 'SMS',
  letter: 'Letter',
};

const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  reached: 'Reached',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  wrong_number: 'Wrong number',
  refused: 'Refused to pay',
};

export function LogContactDialog({
  row,
  channel: initialChannel = 'call',
  open,
  onClose,
  onDone,
}: {
  row: CollectionCaseRow;
  /** Pre-selected from the button that opened this — the composer offers one per channel. */
  channel?: ContactChannel;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<ContactChannel>(initialChannel);
  const [outcome, setOutcome] = useState<ContactOutcome>('reached');
  const [note, setNote] = useState('');
  const [contactName, setContactName] = useState(row.debtorFullName ?? '');
  const [promising, setPromising] = useState(false);
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(todayIso());
  const [saving, setSaving] = useState(false);

  const promiseAmount = moneyInput(amount);
  const amountBad = promising && amount !== '' && promiseAmount === null;
  const canSave = !promising || (promiseAmount !== null && Boolean(dueDate));

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      await logContact(row.id, {
        channel,
        outcome,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
        ...(promising && promiseAmount && dueDate
          ? { promise: { amount: promiseAmount, dueDate } }
          : {}),
      });
      toast({
        intent: 'success',
        title: 'Logged',
        description: promising
          ? 'Contact and promise saved to the record.'
          : 'Contact saved to the record.',
      });
      onDone();
      onClose();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not save the contact', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log a contact attempt"
      subtitle={caseName(row)}
      size="md"
      footer={
        <div className="ca-foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="check_circle"
            loading={saving}
            disabled={!canSave}
            onClick={() => void submit()}
          >
            Save to record
          </Button>
        </div>
      }
    >
      <div className="ca-body">
        <RadioGroup
          label="How"
          orientation="horizontal"
          value={channel}
          onChange={(v) => setChannel(v as ContactChannel)}
        >
          {CONTACT_CHANNELS.map((c) => (
            <Radio key={c} value={c} label={CHANNEL_LABEL[c]} />
          ))}
        </RadioGroup>

        <RadioGroup
          label="Outcome"
          orientation="horizontal"
          value={outcome}
          onChange={(v) => setOutcome(v as ContactOutcome)}
        >
          {CONTACT_OUTCOMES.map((o) => (
            <Radio key={o} value={o} label={OUTCOME_LABEL[o]} />
          ))}
        </RadioGroup>

        <ActionField label="Who you spoke to">
          <Input
            fullWidth
            value={contactName}
            placeholder="Name and role at the carrier"
            onChange={(e) => setContactName(e.currentTarget.value)}
          />
        </ActionField>

        <ActionField label="What was said">
          {/* No `autoGrow`: ds/Textarea measures scrollHeight in a layout effect, and inside a
              native <dialog> that has not been shown yet it measures 0 and pins height: 0px.
              A fixed `rows` box is correct here anyway — the field's size should not move while
              someone is typing a call note. */}
          <Textarea
            rows={4}
            placeholder="Kept short and factual — this is the record another collector reads before the next call."
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </ActionField>

        <div className="ca-rule" />

        <Switch
          checked={promising}
          onChange={(e) => setPromising(e.currentTarget.checked)}
          label="They promised to pay"
          description="Puts this case back on Today the morning it falls due."
        />

        {promising ? (
          <div className="ca-grid">
            <ActionField
              label="Amount"
              hint={amountBad ? 'Dollars and cents, e.g. 2400.00' : undefined}
            >
              <Input
                fullWidth
                inputMode="decimal"
                placeholder="2400.00"
                value={amount}
                invalid={amountBad}
                onChange={(e) => setAmount(e.currentTarget.value)}
              />
            </ActionField>
            <ActionField label="By">
              <DateField value={dueDate} min={todayIso()} onChange={(v) => setDueDate(v)} />
            </ActionField>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
