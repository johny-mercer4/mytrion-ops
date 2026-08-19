/**
 * Sales application intake — the pre-Phase-1 gate.
 *
 * Sales fills data and files, then watches progress. Completeness is the server's: every
 * case-data write returns a verdict and Submit reads that, never a browser re-derivation.
 *
 * Attachments are a separate store from the typed form. Document routes return a full
 * ApplicationDetail; reseeding the form from that payload is what wiped unsaved inputs.
 *
 * THE CHROME IS THE VERIFICATION DESK'S. Header, banners, the ten-phase spine and the
 * pane/aside split are `CaseView`'s own `.va-*` shell, hosted under
 * `data-mytrion="verification"` so that stylesheet applies — Sales and the desk work the SAME
 * `verification_cases` row through two doors, and a case that arrives looking like a different
 * object reads as a different product.
 *
 * WHAT STAYS SALES'. The form inside the pane does: `ApplicationIntakeFields`, `DocSlot` and
 * `DocumentsSection` carry drag-and-drop, per-slot progress, pre-upload refusals and paste that
 * the desk's flat `IntakePane` has no equivalent for. Only Sales mounts them, so they are the
 * intake language and the shell around them is the desk's.
 *
 * WHAT SALES NEVER SEES. The phase spine is read-only and there is no phase picker: an agent
 * watches the pipeline, they do not open its panes. No findings, no verdicts, no decision bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ds';
import { Icon } from './icons';
import {
  ApplicationCaseAside,
  ApplicationCaseBanner,
  ApplicationCaseHead,
} from './applicationCaseHead';
import { VerificationProgress } from './VerificationProgress';
import { useSales } from './ctx';
import { ApplicantTypePicker, IntakeSkeleton } from './applicationFields';
import { DocumentsSection, isSlottedDocType } from './applicationDocs';
import { ErrorNote } from './applicationIntakePanels';
import { ApplicationIntakeFields, STATEMENT_LABELS } from './applicationIntakeFields';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import {
  caseSurface,
  documentsAfterDelete,
  fieldVisiblyMissing,
  formFromCase,
  mergeDocuments,
  visibleMissingItems,
} from './applicationIntakeState';
import {
  addPrincipal,
  createApplication,
  deleteApplicationDocument,
  getApplication,
  getApplicationPrefill,
  openDocument,
  patchApplication,
  removePrincipal,
  submitApplication,
  uploadApplicationDocuments,
  type ApplicationDetail,
  type PrefillResult,
  type PrefillSuggestion,
  type VerificationApplicantType,
  type VerificationDocType,
  type VerificationDocument,
} from '@/api/verificationFlow';

function missingSet(detail: ApplicationDetail | null): Set<string> {
  return new Set((detail?.intake.missing ?? []).map((m) => m.field));
}

/**
 * Whose list this is — the View-as target when one is picked, else the signed-in worker. Used only
 * to decide whether the Sales owner on the header is worth naming; see the header's own note.
 */
function viewerZohoId(): string | null {
  return getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? null;
}

export function ApplicationIntake({
  applicationId,
  onBack,
  onCreated,
  onSubmitted,
}: {
  applicationId?: string;
  /** Back to the queue. Absent on the standalone create flow, which has no queue behind it. */
  onBack?: () => void;
  onCreated?: (id: string) => void;
  onSubmitted?: (id: string) => void;
}) {
  const { pushToast } = useSales();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [attachments, setAttachments] = useState<VerificationDocument[]>([]);
  const [loading, setLoading] = useState(Boolean(applicationId));
  const [pending, setPending] = useState<string | null>(null);
  const [fileOps, setFileOps] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [principalName, setPrincipalName] = useState('');
  const [prefill, setPrefill] = useState<PrefillResult | null>(null);
  const [applied, setApplied] = useState<Set<string>>(() => new Set());
  const uploadSeq = useRef(0);

  /** Case-data writes may reseed the form. File writes must not. */
  const seedCase = useCallback((next: ApplicationDetail) => {
    setDetail(next);
    setForm(formFromCase(next.case));
  }, []);

  const seedAll = useCallback((next: ApplicationDetail) => {
    seedCase(next);
    setAttachments(next.documents);
  }, [seedCase]);

  const applyAttachments = useCallback((next: ApplicationDetail) => {
    setAttachments((prev) => mergeDocuments(prev, next.documents));
    setDetail((prev) => (prev ? { ...prev, intake: next.intake, phases: next.phases } : next));
  }, []);

  /** Type is a Sales decision. The patch returns a full case; reseeding would wipe typed fields. */
  const applyTypeChange = useCallback((next: ApplicationDetail) => {
    setDetail((prev) =>
      prev ? { ...prev, case: next.case, intake: next.intake, phases: next.phases } : next,
    );
  }, []);

  useEffect(() => {
    if (!applicationId) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    getApplication(applicationId)
      .then((d) => {
        if (live) {
          seedAll(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) {
          setError({
            scope: 'load',
            message: e instanceof Error ? e.message : 'Could not load the application.',
          });
        }
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [applicationId, seedAll]);

  const id = detail?.case.id ?? applicationId ?? null;
  const applicantType = (detail?.case.applicantType as VerificationApplicantType | null) ?? null;
  const serverMissing = useMemo(() => missingSet(detail), [detail]);
  const complete = detail?.intake.complete ?? false;
  const submitted = Boolean(detail?.case.verificationProcess);
  const locked = submitted && detail?.case.statusCode !== 'pending_docs';
  const surface = detail ? caseSurface(detail) : 'intake';
  const flagged = (field: string) => fieldVisiblyMissing(serverMissing, field, form[field] ?? '');

  const statementDocs = attachments.filter(
    (d) => d.docType === 'bank_statement' && d.status === 'received',
  );
  const identityDocs = useMemo(() => {
    const out: Partial<Record<string, { id: string; fileName: string | null }>> = {};
    for (const d of attachments) {
      if (d.status !== 'received') continue;
      if (d.docType !== 'drivers_license' && d.docType !== 'ssn_card') continue;
      out[d.docType] ??= { id: d.id, fileName: d.fileName };
    }
    return out;
  }, [attachments]);

  const leftoverDocs = useMemo(
    () => attachments.filter((d) => !isSlottedDocType(d.docType)),
    [attachments],
  );
  const leftoverType: VerificationDocType =
    leftoverDocs.find((d) => d.status === 'requested')?.docType ?? 'other';

  const statementSlots = useMemo(() => {
    const labelled = new Map<string, (typeof statementDocs)[number]>();
    const loose: typeof statementDocs = [];
    for (const doc of statementDocs) {
      const slot = STATEMENT_LABELS.indexOf(doc.label ?? '');
      if (slot >= 0 && !labelled.has(doc.label ?? '')) labelled.set(doc.label ?? '', doc);
      else loose.push(doc);
    }
    return STATEMENT_LABELS.map((label) => labelled.get(label) ?? loose.shift() ?? null);
  }, [statementDocs]);

  const fail = (e: unknown, fallback: string, scope: string): void => {
    const message = e instanceof Error ? e.message : fallback;
    setError({ scope, message });
    pushToast('Could not save', message);
  };

  const under = async (scope: string, fn: () => Promise<void>, fallback: string): Promise<void> => {
    setPending(scope);
    try {
      await fn();
      setError(null);
    } catch (e) {
      fail(e, fallback, scope);
    } finally {
      setPending(null);
    }
  };

  const runFileOp = async (scope: string, fn: () => Promise<void>, fallback: string): Promise<void> => {
    setFileOps((prev) => new Set(prev).add(scope));
    try {
      await fn();
      setError(null);
    } catch (e) {
      fail(e, fallback, scope);
    } finally {
      setFileOps((prev) => {
        const next = new Set(prev);
        next.delete(scope);
        return next;
      });
    }
  };

  async function choose(type: VerificationApplicantType): Promise<void> {
    await under(
      'type',
      async () => {
        if (!id) {
          const created = await createApplication({ applicantType: type });
          seedAll(created);
          onCreated?.(created.case.id);
        } else {
          applyTypeChange(await patchApplication(id, { applicantType: type }));
        }
      },
      'Could not set the applicant type.',
    );
  }

  async function save(): Promise<void> {
    if (!id) return;
    await under(
      'save',
      async () => {
        seedCase(
          await patchApplication(id, {
            ...form,
            trucksCount: form.trucksCount === '' ? null : Number(form.trucksCount),
            fuelCardsRequested:
              form.fuelCardsRequested === '' ? null : Number(form.fuelCardsRequested),
            requestedLimit: form.requestedLimit === '' ? null : Number(form.requestedLimit),
          }),
        );
        pushToast('Saved', 'The application has been updated.');
      },
      'Could not save the application.',
    );
  }

  async function uploadSlotDoc(
    file: File,
    docTypeForSlot: VerificationDocType,
    label: string,
  ): Promise<void> {
    if (!id) return;
    await runFileOp(
      `slot:${label}`,
      async () => {
        applyAttachments(await uploadApplicationDocuments(id, [file], { docType: docTypeForSlot, label }));
      },
      `Could not upload ${label.toLowerCase()}.`,
    );
  }

  async function openStored(documentId: string, fileName: string | null): Promise<void> {
    if (!id) return;
    try {
      await openDocument('sales', id, documentId, fileName ?? 'document');
      setError(null);
    } catch (e) {
      fail(e, 'Could not open that document.', 'open');
    }
  }

  async function removeDocument(documentId: string, scope: string): Promise<void> {
    if (!id) return;
    await runFileOp(
      scope,
      async () => {
        const next = await deleteApplicationDocument(id, documentId);
        setAttachments((prev) => documentsAfterDelete(prev, next.documents, documentId));
        setDetail((prev) => (prev ? { ...prev, intake: next.intake, phases: next.phases } : next));
      },
      'Could not remove that document.',
    );
  }

  useEffect(() => {
    if (!id) return;
    let live = true;
    getApplicationPrefill(id)
      .then((r) => live && setPrefill(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, applicantType]);

  async function upload(files: File[]): Promise<void> {
    if (!id || files.length === 0) return;
    const scope = `upload:${++uploadSeq.current}`;
    await runFileOp(
      scope,
      async () => {
        applyAttachments(await uploadApplicationDocuments(id, files, { docType: leftoverType }));
      },
      'Could not upload the document.',
    );
  }

  async function submit(): Promise<void> {
    if (!id) return;
    await under(
      'submit',
      async () => {
        const next = await submitApplication(id);
        seedCase(next);
        pushToast('Submitted', 'Verification can now begin underwriting.');
        onSubmitted?.(next.case.id);
      },
      'Could not submit the application.',
    );
  }

  /**
   * Back to the queue, on its own, when there is no case to hang a header on.
   *
   * The breadcrumb lives INSIDE `.va-case-head` (that is where the design puts it), so the loading,
   * failed and choose-a-type states — which have no header — would otherwise strand the agent on a
   * screen with no way out.
   */
  const backOnly = onBack ? (
    <div className="va-crumbs va-crumbs-bare">
      <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
        All applications
      </Button>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="va-case" data-mytrion="verification">
        {backOnly}
        <IntakeSkeleton />
      </div>
    );
  }

  if (error?.scope === 'load') {
    return (
      <div className="va-case" data-mytrion="verification">
        {backOnly}
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warn" size={15} strokeWidth={2.2} />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">Could not open this application</span>
            <p className="va-banner-body">{error.message}</p>
          </span>
        </div>
      </div>
    );
  }

  if (!applicantType) {
    return (
      <div className="va-case" data-mytrion="verification">
        {backOnly}
        <section className="va-phase">
          <header className="va-phase-head">
            <div className="va-phase-titles">
              <span className="t-eyebrow va-phase-kicker">Before anything else</span>
              <h2 className="va-phase-title">Who is applying?</h2>
              <p className="va-phase-desc">
                This decides which details Verification needs. The Deal in Zoho did not say, so it is
                yours to answer.
              </p>
            </div>
          </header>
          <div className="va-phase-main">
            <ApplicantTypePicker
              value=""
              pending={pending === 'type'}
              onChange={(v) => void choose(v)}
            />
            {pending === 'type' ? <IntakeSkeleton compact /> : null}
            {error ? <ErrorNote message={error.message} /> : null}
          </div>
        </section>
      </div>
    );
  }

  const exclusiveBusy = pending !== null;
  const filesBusy = fileOps.size > 0;
  const writeBusy = exclusiveBusy || filesBusy;
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const gateMissing = visibleMissingItems(detail?.intake.missing ?? [], form);

  const applySuggestion = (sugg: PrefillSuggestion): void => {
    if (sugg.field === 'principalName') setPrincipalName(sugg.value);
    else setForm((f) => ({ ...f, [sugg.field]: sugg.value }));
    setApplied((a) => new Set(a).add(sugg.field));
  };

  /**
   * What this section IS, in the agent's terms — the desk's `va-phase-desc` slot.
   *
   * Three states, because the same form means three different things: yours to finish, yours to
   * add to, or a record you can only read. Deliberately NOT a second "Verification cannot start
   * until this is complete" — the banner two hundred pixels above already says that, and a note
   * that restates the alarm it sits under is a line the agent learns to skip.
   */
  const paneNote = locked
    ? 'Saved and with Verification. The pipeline above is how far it has got — nothing here is editable while underwriting runs.'
    : submitted
      ? 'Verification has asked for more. Attach what they need; everything else stays as submitted.'
      : 'Everything Verification underwrites comes from here. Save as you go — nothing reaches the desk until you submit.';

  return (
    <div className="va-case" data-mytrion="verification">
      <ApplicationCaseHead
        detail={detail!}
        surface={surface}
        viewerZohoId={viewerZohoId()}
        typeBusy={pending === 'type'}
        typeLocked={locked}
        onBack={onBack}
        onChangeType={(next) => void choose(next)}
      />

      <ApplicationCaseBanner
        detail={detail!}
        surface={surface}
        outstanding={detail?.intake.missing.length ?? 0}
      />

      {/* The desk's own ten-phase spine, read-only: no `onPick`, so the steps are not buttons. */}
      {detail ? <VerificationProgress detail={detail} /> : null}

      <section className="va-phase">
        <header className="va-phase-head">
          <div className="va-phase-titles">
            <span className="t-eyebrow va-phase-kicker">Application</span>
            <h2 className="va-phase-title">Your details and documents</h2>
            <p className="va-phase-desc">{paneNote}</p>
          </div>
        </header>

        <div className="va-phase-body">
          <div className="va-phase-main">
            <div className="va-stack ss-vf-intake-form">
              <ApplicationIntakeFields
                form={form}
                set={set}
                flagged={flagged}
                serverMissing={serverMissing}
                applicantType={applicantType}
                locked={locked}
                exclusiveBusy={exclusiveBusy}
                pendingPrincipal={pending === 'principal'}
                principalError={error?.scope === 'principal' ? error.message : null}
                principalName={principalName}
                onPrincipalName={setPrincipalName}
                onAddPrincipal={async () => {
                  if (!id || principalName.trim().length === 0) return;
                  await under(
                    'principal',
                    async () => {
                      seedCase(await addPrincipal(id, { fullName: principalName.trim() }));
                      setPrincipalName('');
                    },
                    'Could not add the principal.',
                  );
                }}
                onRemovePrincipal={async (principalId) => {
                  if (!id) return;
                  await under(
                    `principal:${principalId}`,
                    async () => {
                      seedCase(await removePrincipal(id, principalId));
                    },
                    'Could not remove the principal.',
                  );
                }}
                detail={detail}
                identityDocs={identityDocs}
                statementSlots={statementSlots}
                fileOps={fileOps}
                errorScope={error?.scope ?? null}
                errorMessage={error?.message ?? null}
                onPickSlot={(file, type, label) => void uploadSlotDoc(file, type, label)}
                onOpenDoc={(docId, fileName) => void openStored(docId, fileName)}
                onRemoveDoc={(docId, scope) => void removeDocument(docId, scope)}
              />

              {leftoverDocs.length > 0 ? (
                <DocumentsSection
                  documents={leftoverDocs}
                  leftoverType={leftoverType}
                  locked={locked}
                  uploading={[...fileOps].some((op) => op.startsWith('upload:'))}
                  removingId={
                    [...fileOps].find((op) => op.startsWith('doc:'))?.slice('doc:'.length) ?? null
                  }
                  error={
                    error &&
                    (error.scope.startsWith('upload:') ||
                      error.scope === 'open' ||
                      error.scope.startsWith('doc:'))
                      ? error.message
                      : null
                  }
                  onUpload={(files) => void upload(files)}
                  onDelete={(documentId) => void removeDocument(documentId, `doc:${documentId}`)}
                  onOpen={(documentId, fileName) => void openStored(documentId, fileName)}
                />
              ) : null}

              {error &&
              !error.scope.startsWith('slot:') &&
              !error.scope.startsWith('doc:') &&
              !error.scope.startsWith('upload:') &&
              error.scope !== 'open' ? (
                <ErrorNote message={error.message} />
              ) : null}

              {!locked ? (
                <div className="va-save">
                  <Button
                    variant="secondary"
                    icon="save"
                    loading={pending === 'save'}
                    disabled={writeBusy && pending !== 'save'}
                    onClick={() => void save()}
                  >
                    Save application
                  </Button>
                  <Button
                    variant="primary"
                    icon="check_circle"
                    loading={pending === 'submit'}
                    disabled={writeBusy || !complete || submitted}
                    onClick={() => void submit()}
                  >
                    {submitted ? 'Already submitted' : 'Submit to Verification'}
                  </Button>
                  {/* The reason Submit is off, said next to it rather than in a `title` nobody
                      hovers. The aside lists WHICH items; this says why the button will not move.
                      No "beside this": below 900px the pane/aside split collapses to one column and
                      the checklist is underneath, so the sentence would point the wrong way. */}
                  {!complete && !submitted ? (
                    <span className="va-save-hint">
                      Submit unlocks once every item on the checklist is in.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <ApplicationCaseAside
            surface={surface}
            complete={complete}
            submitted={submitted}
            locked={locked}
            gateMissing={gateMissing}
            prefill={prefill}
            applicantType={applicantType}
            applied={applied}
            busy={exclusiveBusy}
            onApplySuggestion={applySuggestion}
          />
        </div>
      </section>
    </div>
  );
}
