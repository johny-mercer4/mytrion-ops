/**
 * Sales application intake — the pre-Phase-1 gate.
 *
 * The agent fills the SOP's Flow A (owner-operator) or Flow B (carrier) depending on applicant type,
 * attaches three bank statements or marks Plaid connected, then submits. Until the server says the
 * application is complete the case stays RED and Verification cannot work it.
 *
 * The browser NEVER decides completeness. Every save returns the server's verdict and this component
 * renders it — so what the agent is told is missing is exactly what the underwriting gate is using.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { VerificationProgress } from './VerificationProgress';
import { useSales } from './ctx';
import { BTN_DISABLED, BTN_PRIMARY, BTN_PRIMARY_BUSY } from './createTicketShared';
import {
  ApplicantTypePicker,
  Field,
  GateBanner,
  IntakeSkeleton,
  Section,
  SelectField,
} from './applicationFields';
import { DocSlot, DocumentsSection } from './applicationDocs';
import {
  openDocument,
  addPrincipal,
  createApplication,
  deleteApplicationDocument,
  getApplication,
  getApplicationPrefill,
  patchApplication,
  removePrincipal,
  submitApplication,
  uploadApplicationDocuments,
  type ApplicationDetail,
  type PrefillResult,
  type PrefillSuggestion,
  type VerificationApplicantType,
  type VerificationDocType,
} from '@/api/verificationFlow';

const REQUIRED_STATEMENTS = 3;

/**
 * The SOP asks for "the last three bank statements", so the form asks for them one at a time.
 *
 * The label is how a slot finds its own file again after a reload — the server stores it on the
 * document and the completeness check counts `bank_statement` documents regardless of label, so
 * this is a UI affordance rather than a new contract.
 */
const STATEMENT_LABELS: readonly string[] = ['Statement 1', 'Statement 2', 'Statement 3'];

/**
 * Flow A's two identity documents. `missingKey` is the key the server's missing list uses, so a
 * slot flags itself red from the same verdict the banner reads.
 */
const IDENTITY_SLOTS: ReadonlyArray<{
  docType: VerificationDocType;
  label: string;
  missingKey: string;
}> = [
  { docType: 'drivers_license', label: "Driver's licence", missingKey: 'driversLicenseDoc' },
  { docType: 'ssn_card', label: 'SSN card', missingKey: 'ssnCardDoc' },
];

const MATCHED_ON_LABEL: Record<'phone' | 'dot' | 'email', string> = {
  phone: 'phone number',
  dot: 'USDOT number',
  email: 'email address',
};

/**
 * What the warehouse already knows about this applicant.
 *
 * Every value is OFFERED, never applied — the source matches about a quarter of cases and is
 * FMCSA data that can be months stale, so the agent who has spoken to the applicant decides.
 * Only fields the case has left empty appear here; nothing can paint over typing.
 *
 * The match key is named because it is what makes the row trustworthy or not: a DOT match is the
 * applicant, a phone match is probably them, and the agent can see which they got.
 */
function PrefillPanel({
  result,
  applied,
  locked,
  onApply,
}: {
  result: PrefillResult;
  applied: Set<string>;
  locked: boolean;
  onApply: (s: PrefillSuggestion) => void;
}) {
  const match = result.match;
  if (!match) return null;
  const outstanding = result.suggestions.filter((sg) => !applied.has(sg.field));
  return (
    <section
      style={s(
        'display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--alt)',
      )}
    >
      <div style={s('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
        <Icon name="verification" size={15} strokeWidth={2.2} />
        <span style={s('font-size:13px;font-weight:800;color:var(--text)')}>
          Found in carrier records
        </span>
        <span style={s('font-size:11px;color:var(--muted)')}>
          matched on {MATCHED_ON_LABEL[match.matchedOn]}
          {match.operatingStatus ? ` · authority ${match.operatingStatus.toLowerCase()}` : ''}
          {match.authorityAddedOn ? ` since ${match.authorityAddedOn.slice(0, 4)}` : ''}
        </span>
        {outstanding.length > 1 && !locked ? (
          <button
            type="button"
            onClick={() => outstanding.forEach(onApply)}
            style={s(
              'margin-left:auto;background:none;border:0;color:var(--accent-text);font-size:12px;font-weight:800;cursor:pointer',
            )}
          >
            Use all {outstanding.length}
          </button>
        ) : null}
      </div>
      <div style={s('display:grid;gap:6px')}>
        {result.suggestions.map((sg) => {
          const done = applied.has(sg.field);
          return (
            <div
              key={sg.field}
              style={s(
                'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border2)',
              )}
            >
              <span style={s('min-width:132px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em')}>
                {sg.label}
              </span>
              <span
                style={s('flex:1;min-width:0;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}
                title={sg.value}
              >
                {sg.value}
              </span>
              {done ? (
                <span style={s('font-size:11px;font-weight:800;color:var(--ok)')}>Added</span>
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onApply(sg)}
                  style={s(
                    `background:none;border:0;font-size:12px;font-weight:800;cursor:${locked ? 'not-allowed' : 'pointer'};color:${locked ? 'var(--muted)' : 'var(--accent-text)'}`,
                  )}
                >
                  Use
                </button>
              )}
            </div>
          );
        })}
      </div>
      <span style={s('font-size:11px;color:var(--muted)')}>
        From carrier registration records — check it against the applicant before saving.
      </span>
    </section>
  );
}

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
  const [loading, setLoading] = useState(Boolean(applicationId));
  /**
   * WHICH action is in flight — a key, not a boolean.
   *
   * One `busy` flag drove ten different controls, so picking a single bank statement put Save
   * application, Submit to Verification, every other document slot and both principal buttons into
   * their loading state at once. Four spinners for one request reads as a broken screen, and it is
   * the "one loader per region" rule stated the other way round.
   *
   * The keys are the REGIONS the agent sees: `type`, `save`, `submit`, `upload`, `principal`, and the
   * per-row `slot:<label>` / `doc:<id>` so a slot or a list row reports only itself.
   */
  const [pending, setPending] = useState<string | null>(null);
  /**
   * The failure, WITH the region that produced it.
   *
   * A 415 used to surface only in a banner at the FOOT of a long form — below the Documents section
   * that caused it, and off screen on anything short of a desktop. The scope decides where it
   * renders: a slot's refusal appears in that slot, an upload's in the upload panel, and anything
   * without a region of its own falls through to the form-level note.
   */
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [docType, setDocType] = useState<VerificationDocType>('bank_statement');
  const [principalName, setPrincipalName] = useState('');
  /**
   * Warehouse suggestions. Loaded once per application, lazily and off the critical path — the
   * lookup scans half a million carrier rows on a phone match (no index can serve a normalised
   * comparison), which measures ~600ms. The form is usable the whole time; the panel appears when
   * it appears, and stays absent for the three cases in four that do not match.
   */
  const [prefill, setPrefill] = useState<PrefillResult | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  /** Seed the editable form from a server payload. Server values win on every refresh. */
  const adopt = useCallback((next: ApplicationDetail) => {
    setDetail(next);
    const c = next.case;
    setForm({
      companyName: (c.companyName as string) ?? '',
      firstName: (c.firstName as string) ?? '',
      lastName: (c.lastName as string) ?? '',
      email: (c.email as string) ?? '',
      phone: (c.phone as string) ?? '',
      dateOfBirth: (c.dateOfBirth as string) ?? '',
      ssnLast4: (c.ssnLast4 as string) ?? '',
      dlLast4: (c.dlLast4 as string) ?? '',
      dlState: (c.dlState as string) ?? '',
      residentialAddress: (c.residentialAddress as string) ?? '',
      businessAddress: (c.businessAddress as string) ?? '',
      ein: (c.ein as string) ?? '',
      mc: (c.mc as string) ?? '',
      dot: (c.dot as string) ?? '',
      trucksCount: c.trucksCount == null ? '' : String(c.trucksCount),
      fuelCardsRequested: c.fuelCardsRequested == null ? '' : String(c.fuelCardsRequested),
      requestedLimit: (c.requestedLimit as string) ?? '',
      bankingSource: (c.bankingSource as string) ?? 'statements',
    });
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
          adopt(d);
          setError(null);
        }
      })
      .catch(
        (e: unknown) =>
          live &&
          setError({
            scope: 'load',
            message: e instanceof Error ? e.message : 'Could not load the application.',
          }),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [applicationId, adopt]);

  const id = detail?.case.id ?? applicationId ?? null;
  const applicantType = (detail?.case.applicantType as VerificationApplicantType | null) ?? null;
  const missing = useMemo(() => missingSet(detail), [detail]);
  const complete = detail?.intake.complete ?? false;
  const submitted = Boolean(detail?.case.verificationProcess);
  const locked = submitted && detail?.case.statusCode !== 'pending_docs';

  /**
   * The three statements, as three SLOTS rather than one counter.
   *
   * "2 of 3 uploaded" tells an agent they are short but not WHICH month is missing, so the fix was
   * to re-upload everything and hope. Each slot owns one document, matched by the label it was
   * uploaded with; anything uploaded before this existed (or through the generic Documents
   * section) has no slot label, so it fills the earliest free slot rather than disappearing.
   */
  const statementDocs = (detail?.documents ?? []).filter(
    (d) => d.docType === 'bank_statement' && d.status === 'received',
  );
  /** Newest received document per identity type — replacing one supersedes the old. */
  const identityDocs = useMemo(() => {
    const out: Partial<Record<string, { id: string; fileName: string | null }>> = {};
    for (const d of detail?.documents ?? []) {
      if (d.status !== 'received') continue;
      if (d.docType !== 'drivers_license' && d.docType !== 'ssn_card') continue;
      out[d.docType] ??= { id: d.id, fileName: d.fileName };
    }
    return out;
  }, [detail?.documents]);

  const statementSlots = useMemo(() => {
    const labelled = new Map<string, (typeof statementDocs)[number]>();
    const loose: typeof statementDocs = [];
    for (const doc of statementDocs) {
      const slot = STATEMENT_LABELS.indexOf(doc.label ?? '');
      if (slot >= 0 && !labelled.has(doc.label ?? '')) labelled.set(doc.label ?? '', doc);
      else loose.push(doc);
    }
    return STATEMENT_LABELS.map((label) => labelled.get(label) ?? loose.shift() ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.documents]);

  /**
   * One failure path. The toast is what reaches an agent who has scrolled away from the control; the
   * scoped `error` is what puts the reason next to the control itself.
   */
  const fail = (e: unknown, fallback: string, scope: string): void => {
    const message = e instanceof Error ? e.message : fallback;
    setError({ scope, message });
    pushToast('Could not save', message);
  };

  /** Run one action under its own key, so exactly one region reports. */
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

  /**
   * Set the applicant type.
   *
   * This click is the slowest on the form and it cannot be made fast: the write is several statements
   * against a database in Oregon, and setting a type always changes the missing-field list, so the
   * gate has to be re-derived and stored. What it CAN do is say so. Before this, `busy` was set and
   * then read by nothing on the branch that renders the picker, so a first-time agent clicked a card
   * and watched a still, silent page for a second or more — and clicked again.
   */
  async function choose(type: VerificationApplicantType): Promise<void> {
    await under(
      'type',
      async () => {
        if (!id) {
          const created = await createApplication({ applicantType: type });
          adopt(created);
          onCreated?.(created.case.id);
        } else {
          adopt(await patchApplication(id, { applicantType: type }));
        }
      },
      'Could not set the applicant type.',
    );
  }

  /** Save the whole form. One round trip per save keeps the server's verdict authoritative. */
  async function save(): Promise<void> {
    if (!id) return;
    await under(
      'save',
      async () => {
        adopt(
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

  /** One slot, one file, labelled so the slot can find it again on the next load. */
  async function uploadSlotDoc(
    file: File,
    docTypeForSlot: VerificationDocType,
    label: string,
  ): Promise<void> {
    if (!id) return;
    await under(
      `slot:${label}`,
      async () => {
        adopt(await uploadApplicationDocuments(id, [file], { docType: docTypeForSlot, label }));
      },
      `Could not upload ${label.toLowerCase()}.`,
    );
  }

  /**
   * PREVIEW a stored document.
   *
   * Not routed through `under`: this is a read that opens a tab, and putting the form into a pending
   * state for it would disable every control while a PDF loads. It reports a failure and nothing else.
   */
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
    await under(
      scope,
      async () => {
        adopt(await deleteApplicationDocument(id, documentId));
      },
      'Could not remove that document.',
    );
  }

  useEffect(() => {
    if (!id) return;
    let live = true;
    getApplicationPrefill(id)
      .then((r) => live && setPrefill(r))
      // A warehouse outage must not surface on a form that does not depend on it.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  async function upload(files: File[]): Promise<void> {
    if (!id || files.length === 0) return;
    await under(
      'upload',
      async () => {
        adopt(await uploadApplicationDocuments(id, files, { docType }));
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
        adopt(next);
        pushToast('Submitted', 'Verification can now begin underwriting.');
        onSubmitted?.(next.case.id);
      },
      'Could not submit the application.',
    );
  }

  /**
   * ONE loader for this surface, and it is a skeleton of the form that is coming.
   *
   * The old state was the sentence "Loading application…" centred in 28px of padding — no shape, no
   * indication of how much was arriving, and a full reflow the moment it did. `IntakeSkeleton` mirrors
   * the real blocks, so the page does not jump when the data lands.
   */
  if (loading) return <IntakeSkeleton />;

  // Step 1 — no type chosen yet, so there is no flow to render.
  if (!applicantType) {
    return (
      <div style={s('display:grid;gap:18px')}>
        <Section title="Who is applying?" hint="This decides which details the application needs.">
          <div style={s('grid-column:1/-1')}>
            {/* `pending` is what this branch was missing: the click writes to a database in Oregon and
                re-derives the gate, and the card used to sit inert for the whole round trip. */}
            <ApplicantTypePicker
              value=""
              pending={pending === 'type'}
              onChange={(v) => void choose(v)}
            />
          </div>
        </Section>
        {/* The form the choice is about to reveal, so the wait has a shape rather than being a
            frozen card. One region, one loader — the picker reports on the card, this shows what is
            coming. */}
        {pending === 'type' ? <IntakeSkeleton compact /> : null}
        {error ? <ErrorNote message={error.message} /> : null}
      </div>
    );
  }

  /**
   * Any action at all — for the reads that must not accept a SECOND write while one is running.
   *
   * Distinct from `pending === '<key>'`, which is what a control uses to say IT is the one working.
   * Both are needed: sharing the disable is correct (two concurrent writes to one case would race),
   * sharing the SPINNER is what produced four loaders for one click.
   */
  const anyPending = pending !== null;
  const isOwnerOperator = applicantType === 'owner_operator';
  const needsAuthority = applicantType === 'carrier';
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * Applying a suggestion fills the FORM, never the case. It lands in the same unsaved state as
   * anything the agent typed, so it goes through the same Save — a quarter-reliable source must
   * not be able to write to a record on its own.
   */
  const applySuggestion = (sugg: PrefillSuggestion): void => {
    if (sugg.field === 'principalName') setPrincipalName(sugg.value);
    else setForm((f) => ({ ...f, [sugg.field]: sugg.value }));
    setApplied((a) => new Set(a).add(sugg.field));
  };

  return (
    <div style={s('display:grid;gap:20px')}>
      <GateBanner
        complete={complete}
        missing={detail?.intake.missing ?? []}
        submitted={submitted}
      />

      {locked ? (
        <div
          role="status"
          style={s(
            'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border)',
          )}
        >
          <Icon name="lock" size={16} color="var(--muted)" />
          <span style={s('font-size:13px;color:var(--text2)')}>
            Verification is underwriting this application, so it is read-only here. You will be asked
            directly if anything else is needed.
          </span>
        </div>
      ) : null}

      {/* Where underwriting has actually got to. Dimmed until the gate opens, but always present:
          an agent should never have to ask another department for a status. */}
      {detail ? <VerificationProgress detail={detail} /> : null}

      {prefill?.match && prefill.suggestions.length > 0 ? (
        <PrefillPanel
          result={prefill}
          applied={applied}
          locked={locked || anyPending}
          onApply={applySuggestion}
        />
      ) : null}

      <Section title="Applicant type">
        <div style={s('grid-column:1/-1')}>
          <ApplicantTypePicker
            value={applicantType}
            pending={pending === 'type'}
            disabled={locked}
            onChange={(v) => void choose(v)}
          />
        </div>
      </Section>

      {isOwnerOperator ? (
        <Section title="Applicant" hint="As it appears on the licence and SSN card.">
          <Field label="First name" name="firstName" value={form.firstName ?? ''} onChange={set('firstName')} missing={missing.has('firstName')} />
          <Field label="Last name" name="lastName" value={form.lastName ?? ''} onChange={set('lastName')} missing={missing.has('lastName')} />
          <Field label="Date of birth" name="dateOfBirth" type="date" value={form.dateOfBirth ?? ''} onChange={set('dateOfBirth')} missing={missing.has('dateOfBirth')} />
          <Field label="Residential address" name="residentialAddress" value={form.residentialAddress ?? ''} onChange={set('residentialAddress')} missing={missing.has('residentialAddress')} />
          <Field
            label="SSN (last 4)"
            name="ssnLast4"
            value={form.ssnLast4 ?? ''}
            onChange={set('ssnLast4')}
            missing={missing.has('ssnLast4')}
            inputMode="numeric"
            maxLength={4}
            hint="Last 4 only. Upload the SSN card below — the full number is never stored here."
          />
          <Field label="Licence (last 4)" name="dlLast4" value={form.dlLast4 ?? ''} onChange={set('dlLast4')} missing={missing.has('dlLast4')} maxLength={8} />
          <Field label="Licence state" name="dlState" value={form.dlState ?? ''} onChange={set('dlState')} maxLength={4} />
          {/* The documents themselves, beside the numbers taken off them. Phase 2 cross-checks one
              against the other, so an application reaching the desk with only the last 4 gives the
              reviewer nothing to check against. */}
          <div style={s('grid-column:1/-1;display:grid;gap:8px')}>
            {IDENTITY_SLOTS.map((slot) => {
              const held = identityDocs[slot.docType] ?? null;
              const scope = `slot:${slot.label}`;
              return (
                <DocSlot
                  key={slot.docType}
                  label={slot.label}
                  doc={held}
                  locked={locked || (anyPending && pending !== scope)}
                  missing={missing.has(slot.missingKey)}
                  uploading={pending === scope}
                  removing={held ? pending === `doc:${held.id}` : false}
                  error={error?.scope === scope ? error.message : null}
                  onPick={(file) => void uploadSlotDoc(file, slot.docType, slot.label)}
                  onOpen={held ? () => void openStored(held.id, held.fileName) : null}
                  onRemove={held ? () => void removeDocument(held.id, `doc:${held.id}`) : null}
                />
              );
            })}
          </div>
        </Section>
      ) : (
        <Section
          title="Business"
          /* Three states, not two. An UNSET type is now the common arrival — the poller stopped
             guessing — and the old else-branch told those agents their application was headed for
             Manager Review before they had chosen anything. */
          /* MC/USDOT are COLLECTED, not required: the SOP routes an LLC or corporation with no
             authority to Manager Review instead of blocking it, so saying "required" here would
             promise a block that does not happen. */
          hint={
            needsAuthority
              ? 'Add MC and USDOT if the company holds authority. Without either, the application goes to Manager Review on submit.'
              : applicantType
                ? 'No MC/DOT for this applicant type — the application will go to Manager Review on submit.'
                : 'Choose an applicant type above — it decides which details are required.'
          }
        >
          <Field label="Full legal company name" name="companyName" value={form.companyName ?? ''} onChange={set('companyName')} missing={missing.has('companyName')} />
          <Field label="EIN" name="ein" value={form.ein ?? ''} onChange={set('ein')} missing={missing.has('ein')} />
          {needsAuthority ? (
            <>
              <Field label="MC number" name="mc" value={form.mc ?? ''} onChange={set('mc')} missing={missing.has('mc')} />
              <Field label="USDOT number" name="dot" value={form.dot ?? ''} onChange={set('dot')} missing={missing.has('dot')} inputMode="numeric" />
            </>
          ) : null}
          <Field label="Business address" name="businessAddress" value={form.businessAddress ?? ''} onChange={set('businessAddress')} missing={missing.has('businessAddress')} />
        </Section>
      )}

      {!isOwnerOperator ? (
        <PrincipalsSection
          detail={detail}
          missing={missing.has('principals')}
          locked={locked}
          adding={pending === 'principal'}
          busy={anyPending}
          error={error?.scope === 'principal' ? error.message : null}
          value={principalName}
          onValue={setPrincipalName}
          onAdd={async () => {
            if (!id || principalName.trim().length === 0) return;
            await under(
              'principal',
              async () => {
                adopt(await addPrincipal(id, { fullName: principalName.trim() }));
                setPrincipalName('');
              },
              'Could not add the principal.',
            );
          }}
          onRemove={async (principalId) => {
            if (!id) return;
            await under(
              `principal:${principalId}`,
              async () => {
                adopt(await removePrincipal(id, principalId));
              },
              'Could not remove the principal.',
            );
          }}
        />
      ) : null}

      <Section title="Contact">
        <Field label="Email" name="email" type="email" value={form.email ?? ''} onChange={set('email')} missing={missing.has('email')} inputMode="email" />
        <Field label="Phone" name="phone" type="tel" value={form.phone ?? ''} onChange={set('phone')} missing={missing.has('phone')} inputMode="tel" />
      </Section>

      <Section title="What they are asking for">
        <Field label="Number of trucks" name="trucksCount" value={form.trucksCount ?? ''} onChange={set('trucksCount')} missing={missing.has('trucksCount')} inputMode="numeric" />
        <Field
          label="Fuel cards requested"
          name="fuelCardsRequested"
          value={form.fuelCardsRequested ?? ''}
          onChange={set('fuelCardsRequested')}
          missing={missing.has('fuelCardsRequested')}
          inputMode="numeric"
          hint={
            Number(form.fuelCardsRequested) > 20
              ? 'Over 20 cards — this routes to WEX underwriting rather than Octane.'
              : undefined
          }
        />
        <Field label="Requested credit limit" name="requestedLimit" value={form.requestedLimit ?? ''} onChange={set('requestedLimit')} missing={missing.has('requestedLimit')} inputMode="decimal" />
      </Section>

      <Section
        title="Banking"
        hint={`Either the last ${REQUIRED_STATEMENTS} bank statements or a Plaid connection.`}
      >
        <SelectField
          label="How is banking supplied?"
          name="bankingSource"
          value={form.bankingSource ?? 'statements'}
          onChange={set('bankingSource')}
          options={[
            { value: 'statements', label: `Upload ${REQUIRED_STATEMENTS} bank statements` },
            { value: 'plaid', label: 'Plaid bank connection' },
          ]}
        />
        {(form.bankingSource ?? 'statements') === 'statements' ? (
          <div style={s('grid-column:1/-1;display:grid;gap:8px')}>
            {STATEMENT_LABELS.map((label, i) => {
              const held = statementSlots[i] ?? null;
              const scope = `slot:${label}`;
              return (
                <DocSlot
                  key={label}
                  label={label}
                  doc={held}
                  locked={locked || (anyPending && pending !== scope)}
                  missing={missing.has('bankStatements')}
                  uploading={pending === scope}
                  removing={held ? pending === `doc:${held.id}` : false}
                  error={error?.scope === scope ? error.message : null}
                  onPick={(file) => void uploadSlotDoc(file, 'bank_statement', label)}
                  onOpen={held ? () => void openStored(held.id, held.fileName) : null}
                  onRemove={held ? () => void removeDocument(held.id, `doc:${held.id}`) : null}
                />
              );
            })}
          </div>
        ) : null}
      </Section>

      <DocumentsSection
        detail={detail}
        docType={docType}
        onDocType={setDocType}
        locked={locked || (anyPending && pending !== 'upload')}
        uploading={pending === 'upload'}
        removingId={pending?.startsWith('doc:') ? pending.slice('doc:'.length) : null}
        error={
          error && (error.scope === 'upload' || error.scope === 'open' || error.scope.startsWith('doc:'))
            ? error.message
            : null
        }
        onUpload={(files) => void upload(files)}
        onDelete={(documentId) => void removeDocument(documentId, `doc:${documentId}`)}
        onOpen={(documentId, fileName) => void openStored(documentId, fileName)}
      />

      {/* The catch-all. Anything with a region of its own has already reported there — this is for a
          failed save, submit or applicant-type change, which have no other home. */}
      {error && !error.scope.startsWith('slot:') && !error.scope.startsWith('doc:') && error.scope !== 'upload' && error.scope !== 'open' ? (
        <ErrorNote message={error.message} />
      ) : null}

      {!locked ? (
        <div style={s('display:flex;flex-wrap:wrap;gap:12px;align-items:center')}>
          {/* EACH button reports only its own request. `disabled` is shared — two writes to one case
              would race — but `Saving…` belongs to Save alone. */}
          <button
            type="button"
            onClick={() => void save()}
            disabled={anyPending}
            aria-busy={pending === 'save' || undefined}
            style={s(pending === 'save' ? BTN_PRIMARY_BUSY : anyPending ? BTN_DISABLED : BTN_PRIMARY)}
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
            disabled={anyPending || !complete || submitted}
            aria-busy={pending === 'submit' || undefined}
            title={complete ? undefined : 'Fill everything listed above first.'}
            style={s(
              pending === 'submit'
                ? BTN_PRIMARY_BUSY
                : anyPending || !complete || submitted
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
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={s(
        'display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:var(--radius-md);background:var(--intent-danger-bg,rgba(248,113,113,.1));border:1px solid var(--intent-danger-bd,rgba(248,113,113,.32))',
      )}
    >
      <Icon name="warn" size={17} color="var(--danger)" strokeWidth={2.2} />
      <span style={s('font-size:13px;color:var(--text);line-height:1.5')}>{message}</span>
    </div>
  );
}

function PrincipalsSection({
  detail,
  missing,
  locked,
  adding,
  busy,
  error,
  value,
  onValue,
  onAdd,
  onRemove,
}: {
  detail: ApplicationDetail | null;
  missing: boolean;
  locked: boolean;
  /** THIS section's add, so Add says "Adding…" and nothing else on the form does. */
  adding: boolean;
  /** Something else on the form is writing — disable, but do not claim to be working. */
  busy: boolean;
  error: string | null;
  value: string;
  onValue: (v: string) => void;
  onAdd: () => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}) {
  const principals = detail?.principals ?? [];
  return (
    <Section title="Owners / principals" hint="At least one is required for a company applicant.">
      <div style={s('grid-column:1/-1;display:grid;gap:10px')}>
        {principals.length === 0 ? (
          <p
            style={s(
              `margin:0;font-size:13px;color:${missing ? 'var(--danger)' : 'var(--muted)'}`,
            )}
          >
            {missing ? 'At least one owner or principal is needed.' : 'None added yet.'}
          </p>
        ) : (
          <ul style={s('margin:0;padding:0;list-style:none;display:grid;gap:8px')}>
            {principals.map((p) => (
              <li
                key={p.id}
                style={s(
                  'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
                )}
              >
                <span style={s('font-size:14px;font-weight:600;color:var(--text)')}>{p.fullName}</span>
                {!locked ? (
                  <button
                    type="button"
                    onClick={() => void onRemove(p.id)}
                    disabled={busy}
                    className="ss-slot-act"
                    data-tone="danger"
                    aria-label={`Remove ${p.fullName}`}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!locked ? (
          <div style={s('display:flex;gap:10px;flex-wrap:wrap')}>
            <input
              aria-label="Owner or principal full name"
              placeholder="Full name"
              value={value}
              onChange={(e) => onValue(e.currentTarget.value)}
              style={s(
                'flex:1 1 220px;height:44px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px',
              )}
            />
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={value.trim().length === 0 || busy}
              aria-busy={adding || undefined}
              style={s(
                adding
                  ? BTN_PRIMARY_BUSY
                  : value.trim().length === 0 || busy
                    ? BTN_DISABLED
                    : BTN_PRIMARY,
              )}
            >
              {adding ? (
                <>
                  <Icon name="spinner" size={15} className="ss-spin" />
                  Adding…
                </>
              ) : (
                'Add'
              )}
            </button>
          </div>
        ) : null}
        {error ? (
          <span
            role="alert"
            style={s('display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--danger)')}
          >
            <Icon name="warn" size={13} strokeWidth={2.3} />
            {error}
          </span>
        ) : null}
      </div>
    </Section>
  );
}
