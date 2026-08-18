/**
 * The case aside: what to check, what is attached, and what has happened.
 *
 * THE CHECKLIST IS DERIVED, NOT STORED. There is no per-item column — the design binds each box to
 * the phase's own status and gives it a no-op handler, and that is the honest reading: a tick here
 * means "this phase was signed off", not "someone ticked this line". So the boxes are `readOnly`
 * and announce themselves that way rather than offering an affordance that saves nothing.
 *
 * THE PHASE LOG IS COMPOSED. `verification_case_events.notes` is nullable — it only carries an
 * operator's free text — so the sentence is built from the always-present `eventType` plus the
 * phase and status it moved between. An event with no note still reads as a sentence.
 */
import { useState } from 'react';
import { Button, Checkbox, EmptyState, Icon, Select } from '@/ds';
import {
  openDocument,
  type VerificationDeskDetail,
  type VerificationDocType,
  type VerificationRailPhase,
} from '@/api/verificationFlow';
import { DOC_ACCEPT, DOC_ACCEPT_HINT } from '../../_shared/verificationDocUpload';
import { PHASE_SHORT, STATUS_LABEL } from './applicantsModel';
import { identityChecklistLines } from './caseIdentity';
import { SCREENING_CHECKLIST } from './caseScreening';
import { authorityChecklistLines } from './caseAuthority';
import { creditBankingChecklistLines } from './caseCreditBanking';
import { deskReviewOrder, routingChecklistLines } from './caseRouting';

/** The SOP's per-phase checks. Judgement calls the desk makes against the file, in its own words. */
const CHECKLISTS: Record<string, readonly string[]> = {
  p1_intake: [
    'Application complete for the applicant type',
    'Fuel cards requested vs Octane / WEX route',
    'Documents attached or Plaid connected',
  ],
  p8_highway: [
    'Safety score and alerts',
    'Fleet / truck count vs cards requested',
    'Logbook connection and connected trucks',
    'Insurance status and compliance',
    'MC/DOT operating history and authority age',
    'Reported activity consistent with Highway data',
  ],
};

const DOC_TYPES: ReadonlyArray<{ value: VerificationDocType; label: string }> = [
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'ssn_card', label: 'SSN card' },
  { value: 'lease_agreement', label: 'Lease agreement' },
  { value: 'corporate_guarantee', label: 'Corporate guarantee' },
  { value: 'insurance', label: 'Insurance certificate' },
  { value: 'authority', label: 'Operating authority' },
  { value: 'other', label: 'Something else' },
];

const DOC_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((d) => [d.value, d.label]),
);

/** The same list the request picker offers — one vocabulary for asking and for attaching. */
const DOC_TYPE_OPTIONS = DOC_TYPES.map((d) => ({ value: d.value, label: d.label }));

function sizeOf(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** An event's sentence, from the structured columns that are always present. */
function eventText(event: VerificationDeskDetail['events'][number]): string {
  if (event.notes && event.notes.trim() !== '') return event.notes.trim();
  const to = event.toPhase ? (PHASE_SHORT[event.toPhase] ?? event.toPhase) : null;
  const status = event.toStatus ? (STATUS_LABEL[event.toStatus] ?? event.toStatus) : null;
  switch (event.eventType) {
    case 'created':
      return 'Application created';
    case 'intake_saved':
      return 'Application details saved';
    case 'submitted':
      return 'Intake completed — application submitted to the desk';
    case 'intake_reopened':
      return 'Intake reopened — the application is incomplete again';
    case 'phase_decision':
      return to ? `Moved to ${to}${status ? ` — ${status}` : ''}` : 'Phase decision recorded';
    case 'docs_requested':
      return 'Documents requested from Sales';
    case 'docs_received':
      return to ? `Documents received — resumed at ${to}` : 'Documents received';
    case 'decision':
      return status ? `Final decision — ${status}` : 'Final decision recorded';
    case 'blacklisted':
      return 'Applicant added to the blacklist';
    default:
      return status ? `Status changed to ${status}` : 'Case updated';
  }
}

export function CaseAside({
  detail,
  caseId,
  phase,
  canAct,
  requesting,
  uploading,
  error,
  onRequestDocs,
  onUpload,
  canAttach,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  phase: VerificationRailPhase;
  canAct: boolean;
  /**
   * TWO flags, not one `busy`.
   *
   * They are two different controls a foot apart, and one shared boolean made attaching a file spin
   * the request button as well — plus the three decision buttons below, which is the triple-loader
   * this pair exists to end. Each control reports only its own request.
   */
  requesting: boolean;
  uploading: boolean;
  /** A refused attach or request, rendered HERE rather than in a banner above the phase spine. */
  error: string | null;
  onRequestDocs: (items: Array<{ docType: VerificationDocType }>, note?: string) => void;
  /** The desk attaching a file itself — see the Attach control below. */
  onUpload: (file: File, docType: VerificationDocType) => void;
  /**
   * Attaching is NOT `canAct`.
   *
   * `canAct` is false while the case is locked — which is exactly when the desk most needs to file
   * something, because a locked case is one waiting on documents. Correcting intake is already
   * allowed while locked for the same reason ("you can still correct the application below"), and
   * attaching is the same kind of act. Only a DECIDED case refuses.
   */
  canAttach: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [attachType, setAttachType] = useState<VerificationDocType>('other');
  const [docType, setDocType] = useState<VerificationDocType>('bank_statement');

  const checklist = !phase.applies
    ? []
    : phase.code === 'p2_identity'
      ? identityChecklistLines(detail.case.applicantType)
      : phase.code === 'p3_screening'
        ? SCREENING_CHECKLIST
        : phase.code === 'p4_authority'
          ? authorityChecklistLines()
          : phase.code === 'p5_routing'
            ? routingChecklistLines(deskReviewOrder(detail).order)
            : phase.code === 'p6_credit_banking'
              ? creditBankingChecklistLines()
              : (CHECKLISTS[phase.code] ?? []);
  const documents = detail.documents;
  const received = documents.filter((d) => d.status === 'received').length;

  return (
    <aside className="va-aside">
      {checklist.length > 0 ? (
        <section className="va-aside-block">
          <h3 className="t-eyebrow va-aside-title">What to check</h3>
          <div className="va-checks">
            {checklist.map((item) => (
              <Checkbox
                key={item}
                className="va-check"
                label={item}
                checked={phase.status === 'passed'}
                readOnly
                // A tick here reports the phase's own state; nothing persists per line, so the
                // control must not pretend to be settable (CONVENTIONS §5).
                aria-disabled="true"
                aria-describedby="va-check-note"
              />
            ))}
          </div>
          <p className="va-aside-note" id="va-check-note">
            Ticks follow the phase — not a saved list.
          </p>
        </section>
      ) : null}

      <section className="va-aside-block">
        <div className="va-aside-head">
          <h3 className="t-eyebrow va-aside-title">Documents</h3>
          <span className="va-aside-count num">
            {documents.length === 0 ? '0 of 0' : `${received} of ${documents.length} received`}
          </span>
        </div>

        {documents.length === 0 ? (
          <EmptyState
            size="panel"
            icon="draft"
            title="Nothing attached"
            description="Nothing from Sales, and no Plaid connection."
          />
        ) : (
          <div className="va-docs">
            {documents.map((doc) => {
              const pending = doc.status !== 'received';
              const name = doc.fileName ?? doc.label ?? DOC_LABEL[doc.docType] ?? 'Document';
              const meta = pending
                ? `Requested${shortDate(doc.requestedAt) ? ` ${shortDate(doc.requestedAt)}` : ''} · not received`
                : [
                    DOC_LABEL[doc.docType] ?? doc.docType,
                    sizeOf(doc.sizeBytes),
                    shortDate(doc.createdAt) ? `received ${shortDate(doc.createdAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
              return (
                <button
                  key={doc.id}
                  type="button"
                  className="va-doc"
                  data-pending={pending}
                  // A `requested` row carries no bytes — the download route 409s on it, so the
                  // affordance is withheld rather than offered and then refused.
                  aria-disabled={pending ? 'true' : undefined}
                  aria-label={pending ? `${name} — requested, not yet received` : `Preview ${name}`}
                  onClick={() => {
                    if (!pending) void openDocument('verification', caseId, doc.id, name);
                  }}
                >
                  <span className="va-doc-glyph" aria-hidden="true">
                    <Icon name={pending ? 'schedule' : 'description'} size="sm" />
                  </span>
                  <span className="va-doc-text">
                    <span className="va-doc-name">{name}</span>
                    <span className="va-doc-meta">{meta}</span>
                  </span>
                  {/* `visibility`, not `download`: the route now serves these bytes inline, so the
                      click opens a viewer. The old glyph promised a file on disk. */}
                  {pending ? null : (
                    <span className="va-doc-open" aria-hidden="true">
                      <Icon name="visibility" size="sm" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {asking ? (
          <div className="va-ask">
            <Select
              label="Document"
              size="sm"
              value={docType}
              onChange={(v) => setDocType((v ?? 'bank_statement') as VerificationDocType)}
              options={DOC_TYPES.map((d) => ({ value: d.value, label: d.label }))}
            />
            <div className="va-ask-actions">
              <Button
                variant="primary"
                size="sm"
                icon="send"
                loading={requesting}
                disabled={!canAct}
                onClick={() => {
                  onRequestDocs([{ docType }]);
                  setAsking(false);
                }}
              >
                Send request
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
            <p className="va-aside-note">Parks the case until they land.</p>
          </div>
        ) : (
          <div className="va-doc-actions">
            {/* ATTACH sits beside REQUEST because the desk does both. A reviewer often already has
                the file — Sales emailed the licence scan, or the carrier sent it to the desk — and
                until this existed the only way to file it was to ask Sales to upload what the
                reviewer was looking at. The same service, gate re-evaluation and audit trail as the
                Sales upload; only the door differs. */}
            {/* The control reports its OWN upload. `aria-busy` rather than a second spinner: the
                label is the affordance and the region already has one loading signal. */}
            <label
              className="va-doc-attach"
              data-disabled={!canAttach || uploading}
              data-busy={uploading || undefined}
              aria-busy={uploading || undefined}
            >
              <Icon name={uploading ? 'cloud_upload' : 'attach_file'} size="sm" />
              {uploading ? 'Uploading…' : 'Attach a file'}
              <input
                type="file"
                accept={DOC_ACCEPT}
                disabled={!canAttach || uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file, attachType);
                  e.target.value = '';
                }}
              />
            </label>
            <Select
              label="Type"
              size="sm"
              value={attachType}
              onChange={(v) => setAttachType((v ?? 'other') as VerificationDocType)}
              disabled={!canAttach}
              options={DOC_TYPE_OPTIONS}
            />
            <Button
              variant="secondary"
              size="sm"
              icon="cloud_upload"
              fullWidth
              disabled={!canAct}
              onClick={() => setAsking(true)}
            >
              Request a document
            </Button>
            <p className="va-aside-note">{DOC_ACCEPT_HINT}</p>
          </div>
        )}

        {/* The refusal, where the click was. An unsupported file type comes back as a 415 naming the
            file and what is accepted; it used to reach a banner above the phase spine, which on a
            tall case is off screen from the control that caused it. */}
        {error ? (
          <p className="va-aside-error" role="alert">
            <Icon name="error" size="sm" />
            <span>{error}</span>
          </p>
        ) : null}
      </section>

      <section className="va-aside-block" data-divided="true">
        <h3 className="t-eyebrow va-aside-title">Phase log</h3>
        {detail.events.length === 0 ? (
          <p className="va-aside-note">Nothing has happened on this case yet.</p>
        ) : (
          <ol className="va-log">
            {detail.events.slice(0, 8).map((event, i) => (
              <li className="va-log-row" key={event.id}>
                <span className="va-log-mark" aria-hidden="true">
                  <span className="va-log-dot" data-first={i === 0} />
                  <span className="va-log-rail" data-last={i === Math.min(7, detail.events.length - 1)} />
                </span>
                <span className="va-log-text">
                  <span className="va-log-what">{eventText(event)}</span>
                  <span className="va-log-when num">
                    {new Date(event.occurredAt).toLocaleString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {event.actorName ? ` · ${event.actorName}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
