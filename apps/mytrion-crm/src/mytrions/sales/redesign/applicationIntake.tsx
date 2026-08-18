/**
 * Sales application intake — the pre-Phase-1 gate.
 *
 * Sales fills data and files, then watches progress. Completeness is the server's: every
 * case-data write returns a verdict and Submit reads that, never a browser re-derivation.
 *
 * Attachments are a separate store from the typed form. Document routes return a full
 * ApplicationDetail; reseeding the form from that payload is what wiped unsaved inputs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { VerificationProgress } from './VerificationProgress';
import { useSales } from './ctx';
import { BTN_DISABLED, BTN_PRIMARY, BTN_PRIMARY_BUSY } from './createTicketShared';
import {
  ApplicantTypePicker,
  GateBanner,
  IntakeSkeleton,
  Section,
} from './applicationFields';
import { DocumentsSection, isSlottedDocType } from './applicationDocs';
import { ErrorNote, PrefillPanel } from './applicationIntakePanels';
import { ApplicationIntakeFields, STATEMENT_LABELS } from './applicationIntakeFields';
import {
  APPLICANT_TYPE_OPTIONS,
  applicantTypeSelectValue,
  caseDisplayName,
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

export function ApplicationIntake({
  applicationId,
  onCreated,
  onSubmitted,
}: {
  applicationId?: string;
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

  if (loading) return <IntakeSkeleton />;
  if (error?.scope === 'load') {
    return (
      <div className="ss-vf-case">
        <ErrorNote message={error.message} />
      </div>
    );
  }

  if (!applicantType) {
    return (
      <div className="ss-vf-case">
        <Section title="Who is applying?">
          <div style={s('grid-column:1/-1')}>
            <ApplicantTypePicker
              value=""
              pending={pending === 'type'}
              onChange={(v) => void choose(v)}
            />
          </div>
        </Section>
        {pending === 'type' ? <IntakeSkeleton compact /> : null}
        {error ? <ErrorNote message={error.message} /> : null}
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

  const appliedOn = detail?.case.createdAt
    ? new Date(detail.case.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      })
    : null;

  return (
    <div className="ss-vf-case">
      <header className="ss-vf-case-head">
        <h1 className="ss-vf-case-title">{caseDisplayName(detail!.case)}</h1>
        <p className="ss-vf-case-meta">
          <span>
            <select
              aria-label="Applicant type"
              className="ss-vf-type-select"
              value={applicantTypeSelectValue(applicantType)}
              disabled={locked || exclusiveBusy}
              aria-busy={pending === 'type' || undefined}
              onChange={(e) => {
                const next = e.currentTarget.value as VerificationApplicantType;
                if (next === applicantTypeSelectValue(applicantType)) return;
                void choose(next);
              }}
            >
              {APPLICANT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          {appliedOn ? <span>Applied {appliedOn}</span> : null}
          <span data-surface={surface}>
            {surface === 'needs_more'
              ? 'Needs documents'
              : surface === 'complete'
                ? (detail!.case.statusLabel ?? 'Decided')
                : surface === 'in_progress'
                  ? 'With Verification'
                  : surface === 'ready'
                    ? 'Ready to submit'
                    : 'Incomplete'}
          </span>
        </p>
      </header>

      {detail ? <VerificationProgress detail={detail} /> : null}

      <div className="ss-vf-record">
        <div className="ss-vf-record-main">
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
              removingId={[...fileOps].find((op) => op.startsWith('doc:'))?.slice('doc:'.length) ?? null}
              error={
                error &&
                (error.scope.startsWith('upload:') || error.scope === 'open' || error.scope.startsWith('doc:'))
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
            <div className="ss-vf-case-actions">
              <button
                type="button"
                onClick={() => void save()}
                disabled={writeBusy}
                aria-busy={pending === 'save' || undefined}
                style={s(pending === 'save' ? BTN_PRIMARY_BUSY : writeBusy ? BTN_DISABLED : BTN_PRIMARY)}
              >
                {pending === 'save' ? (
                  <>
                    <Icon name="spinner" size={15} className="ss-spin" />
                    Saving…
                  </>
                ) : (
                  'Save application'
                )}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={writeBusy || !complete || submitted}
                aria-busy={pending === 'submit' || undefined}
                title={complete ? undefined : 'Fill everything listed above first.'}
                style={s(
                  pending === 'submit'
                    ? BTN_PRIMARY_BUSY
                    : writeBusy || !complete || submitted
                      ? BTN_DISABLED
                      : BTN_PRIMARY,
                )}
              >
                {pending === 'submit' ? (
                  <>
                    <Icon name="spinner" size={15} className="ss-spin" />
                    Submitting…
                  </>
                ) : submitted ? (
                  'Already submitted'
                ) : (
                  'Submit to Verification'
                )}
              </button>
            </div>
          ) : null}
        </div>

        <aside className="ss-vf-record-aside">
          <GateBanner
            complete={complete}
            missing={gateMissing}
            submitted={submitted}
            awaitingSave={!complete && gateMissing.length === 0}
          />

          {surface === 'needs_more' ? (
            <div role="status" className="ss-vf-case-ask">
              <Icon name="upload" size={18} color="var(--warn)" strokeWidth={2.2} />
              <span>Verification asked for more documents.</span>
            </div>
          ) : null}

          {locked ? (
            <div role="status" className="ss-vf-case-lock">
              <Icon name="lock" size={16} color="var(--muted)" />
              <span>Read-only while Verification is underwriting.</span>
            </div>
          ) : null}

          {prefill?.match && prefill.suggestions.length > 0 ? (
            <PrefillPanel
              result={prefill}
              applicantType={applicantType}
              applied={applied}
              locked={locked || exclusiveBusy}
              onApply={applySuggestion}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
