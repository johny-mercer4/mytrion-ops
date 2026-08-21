/**
 * Full Details — every persisted application input plus attachments, in one modal.
 *
 * Assumption: this is the Verification desk Record (`CaseView`). Sales already is the intake
 * form; after submit Sales cannot edit. Not a second UI, and not Data Center vendor payloads.
 *
 * Fields reuse `IntakePane` (same groups, same PATCH). System-owned columns stay read-only
 * above the form. Red cases stay editable — `patchDeskIntake` already allows that; only a
 * decided case is read-only.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, ConfirmDialog, Dialog } from '@/ds';
import {
  patchDeskIntake,
  type VerificationDeskDetail,
} from '@/api/verificationFlow';
import { addDeskPrincipal, removeDeskPrincipal } from '@/api/verificationDeskWrites';
import { caseName, PHASE_SHORT, STATUS_LABEL } from './applicantsModel';
import { IntakePane } from './CaseIntakePane';
import { CaseFullDetailsAttachments } from './CaseFullDetailsAttachments';
import './caseFullDetails.css';

const FORM_ID = 'va-full-details-form';

export function CaseFullDetailsControl({
  caseId,
  detail,
  wexCardCutoff,
  onUpdated,
}: {
  caseId: string;
  detail: VerificationDeskDetail;
  wexCardCutoff: number | null;
  onUpdated: (next: VerificationDeskDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" icon="description" onClick={() => setOpen(true)}>
        Full Details
      </Button>
      <CaseFullDetailsModal
        open={open}
        caseId={caseId}
        detail={detail}
        wexCardCutoff={wexCardCutoff}
        onClose={() => setOpen(false)}
        onUpdated={onUpdated}
      />
    </>
  );
}

export function CaseFullDetailsModal({
  open,
  caseId,
  detail,
  wexCardCutoff,
  onClose,
  onUpdated,
}: {
  open: boolean;
  caseId: string;
  detail: VerificationDeskDetail;
  wexCardCutoff: number | null;
  onClose: () => void;
  onUpdated: (next: VerificationDeskDetail) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [principalBusy, setPrincipalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const closed = Boolean(detail.case.closedAt);

  useEffect(() => {
    if (open) return;
    setDirty(false);
    setError(null);
    setSaving(false);
    setPrincipalBusy(false);
    setDiscardOpen(false);
  }, [open]);

  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);

  const requestClose = (): void => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const saveFields = async (body: Record<string, unknown>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await patchDeskIntake(caseId, body));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save the application.';
      setError(message);
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setSaving(false);
    }
  };

  const c = detail.case;
  const statusText = STATUS_LABEL[c.statusCode] ?? c.statusCode;
  const phaseText = PHASE_SHORT[c.phaseCode] ?? c.phaseCode;
  const opened = new Date(c.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const facts: Array<{ k: string; v: string }> = [
    { k: 'Status', v: statusText },
    { k: 'Phase', v: phaseText },
    { k: 'Opened', v: opened },
  ];

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        size="lg"
        mobile="fullscreen"
        title="Full details"
        subtitle={caseName(c)}
        closeLabel="Close full details"
        footer={
          closed ? (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={requestClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form={FORM_ID}
                icon="save"
                loading={saving}
                disabled={!dirty || principalBusy}
              >
                Save
              </Button>
            </>
          )
        }
      >
        <div className="va-full">
          <section className="va-full-meta" aria-label="Case record">
            {facts.map((f) => (
              <span className="va-fact" key={f.k}>
                <span className="t-eyebrow">{f.k}</span>
                <span className="va-fact-v num">{f.v}</span>
              </span>
            ))}
          </section>

          {error ? (
            <p className="va-aside-error" role="alert">
              {error}
            </p>
          ) : null}

          <IntakePane
            detail={detail}
            closed={closed}
            busy={saving}
            principalBusy={principalBusy}
            wexCardCutoff={wexCardCutoff}
            idPrefix="va-full"
            formId={FORM_ID}
            hideSave
            hideCounts
            hideHead
            fileHint=""
            onDirtyChange={onDirtyChange}
            onSave={saveFields}
            onAddPrincipal={async (fullName) => {
              setPrincipalBusy(true);
              setError(null);
              try {
                onUpdated(await addDeskPrincipal(caseId, { fullName }));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not add that owner.');
              } finally {
                setPrincipalBusy(false);
              }
            }}
            onRemovePrincipal={async (principalId) => {
              setPrincipalBusy(true);
              setError(null);
              try {
                onUpdated(await removeDeskPrincipal(caseId, principalId));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not remove that owner.');
              } finally {
                setPrincipalBusy(false);
              }
            }}
          />

          <CaseFullDetailsAttachments
            caseId={caseId}
            documents={detail.documents}
            canEdit={!closed}
            onUpdated={onUpdated}
          />
        </div>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        body="Edits will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
