/**
 * Place a case with a collection agency.
 *
 * TWO THINGS THIS DOES NOT DO, and both are stated in the dialog rather than only here:
 *   1. It does not transmit anything to Array. The monthly Metro 2 file is still built by the
 *      existing Zoho cron; this marks the case as placed so the queue stops offering it.
 *   2. It does not check the four Metro 2 fields for you at save time — the queue does that, and
 *      this dialog renders the result. Filing a tradeline short of a field is how the July
 *      exclusions happened, so a missing field blocks the button rather than warning past it.
 */
import { useState } from 'react';
import { Button, Dialog, DateField, Icon, Input, Textarea, useToast } from '@/ds';
import { placeWithAgency, type Metro2Field, type PlacementRow } from '@/api/collectionDesk';
import type { CollectionCaseRow } from '@/api/collection';
import { caseName } from '../cases/casesModel';
import { money } from '../collectionFormat';
import { ActionField, ActionNote } from './ActionField';
import { todayIso } from './actionsModel';

const FIELD_LABEL: Record<Metro2Field, string> = {
  dateOfBirth: 'Date of birth',
  address: 'Address',
  mcDot: 'MC / DOT',
  firstDelinquency: 'Date of first delinquency',
};

/** The default. A free-text field, because nothing in the data models the agency list yet. */
const DEFAULT_AGENCY = 'Array Recovery';

export function PlacementDialog({
  row,
  placement,
  open,
  onClose,
  onDone,
}: {
  row: CollectionCaseRow;
  /**
   * The queue's own verdict on this carrier. Null when the dialog is opened from a surface that
   * has not loaded the queue — the readiness block is then omitted rather than guessed at.
   */
  placement: PlacementRow | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [agency, setAgency] = useState(DEFAULT_AGENCY);
  const [placementDate, setPlacementDate] = useState<string | null>(todayIso());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const missing = placement?.missing ?? [];
  const blocked = missing.length > 0;
  const canSave = !blocked && agency.trim().length > 0 && Boolean(placementDate);

  const submit = async (): Promise<void> => {
    if (!canSave || !placementDate) return;
    setSaving(true);
    try {
      await placeWithAgency(row.id, {
        agency: agency.trim(),
        placementDate,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast({
        intent: 'success',
        title: 'Marked as placed',
        description: `${caseName(row)} is now with ${agency.trim()}.`,
      });
      onDone();
      onClose();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not place the case', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Place with an agency"
      subtitle={`${caseName(row)} · ${money(row.totalDebtAmount)} · ${row.daysPastDue} days past due`}
      size="md"
      footer={
        <div className="ca-foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="send"
            loading={saving}
            disabled={!canSave}
            onClick={() => void submit()}
          >
            Mark as placed
          </Button>
        </div>
      }
    >
      <div className="ca-body">
        {placement ? (
          <section className="ca-ready">
            <span className="t-eyebrow">Metro 2 readiness</span>
            <ul className="ca-ready-list">
              {(Object.keys(FIELD_LABEL) as Metro2Field[]).map((field) => {
                const ok = placement.readiness[field];
                return (
                  <li key={field} data-ok={ok ? 'true' : undefined}>
                    <Icon name={ok ? 'check_circle' : 'error'} size="sm" aria-hidden />
                    <span>{FIELD_LABEL[field]}</span>
                    <span className="ca-ready-state">{ok ? 'Present' : 'Missing'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {blocked ? (
          <ActionNote tone="danger">
            Array rejects a consumer tradeline with no{' '}
            {missing.map((f) => FIELD_LABEL[f].toLowerCase()).join(' and ')}. Filing without it means
            this row is dropped from the file and reported nowhere — which is how the last round of
            silent exclusions happened. Fill the field on the carrier record first.
          </ActionNote>
        ) : null}

        <div className="ca-grid">
          <ActionField label="Agency">
            <Input fullWidth value={agency} onChange={(e) => setAgency(e.currentTarget.value)} />
          </ActionField>
          <ActionField label="Placement date">
            <DateField value={placementDate} onChange={(v) => setPlacementDate(v)} />
          </ActionField>
        </div>

        <ActionField label="Note">
          <Textarea
            rows={3}
            placeholder="Anything the agency needs that is not on the record."
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </ActionField>

        <ActionNote tone="warning">
          This records the placement and moves the case to <b>With agency</b>, closing any running
          payment plan. It does not send anything to Array — the Metro 2 file is still built by the
          existing sync.
        </ActionNote>
      </div>
    </Dialog>
  );
}
