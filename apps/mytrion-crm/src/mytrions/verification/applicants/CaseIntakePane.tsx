/**
 * Phase 1 on the Verification desk — every intake column Sales can fill, plus principals.
 *
 * Files stay on the aside Attach control (any type, including "Something else"). This pane is the
 * typed application: the eleven fields that used to live here left owner-operator identity,
 * addresses, banking source and type as counts the reviewer could not correct, so Pass stayed
 * locked on a hidden required field.
 */
import { useEffect, useState } from 'react';
import { Button, Input, Select } from '@/ds';
import type { VerificationApplicantType, VerificationDeskDetail } from '@/api/verificationFlow';
import { APPLICANT_LABEL, routeLabel, routeOf } from './applicantsModel';

type FieldKind = 'text' | 'numeric' | 'type' | 'banking' | 'plaid';

interface IntakeField {
  k: string;
  label: string;
  kind: FieldKind;
}

/**
 * Every column, GROUPED — and the group names are Sales' own ("Applicant", "Business", "Contact",
 * "What they are asking for", "Banking"), so an agent and a reviewer talking about the same case are
 * looking at the same map.
 *
 * They were one flat grid of nineteen fields, which for the desk's override surface is a wall: the
 * reviewer scanning for the EIN had to read labels, and there was no signal that "Licence state" and
 * "Business address" belong to two different applicant flows.
 *
 * ALL of them stay on screen whichever flow the case is on. This is the desk's correction surface —
 * an owner-operator case whose type was set wrong at ingest needs `companyName` reachable to fix it,
 * and hiding half the columns is what would make "full control" untrue. `appliesTo` only marks which
 * flow a group BELONGS to, so the pane can say so.
 */
const FIELD_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  /** The flow this group is required for. `both` is asked of every applicant. */
  appliesTo: 'owner_operator' | 'carrier' | 'both';
  fields: readonly IntakeField[];
}> = [
  {
    id: 'type',
    title: 'Applicant type',
    appliesTo: 'both',
    fields: [{ k: 'applicantType', label: 'Applicant type', kind: 'type' }],
  },
  {
    id: 'person',
    title: 'Applicant',
    appliesTo: 'owner_operator',
    fields: [
      { k: 'firstName', label: 'First name', kind: 'text' },
      { k: 'lastName', label: 'Last name', kind: 'text' },
      { k: 'dateOfBirth', label: 'Date of birth', kind: 'text' },
      { k: 'residentialAddress', label: 'Residential address', kind: 'text' },
      { k: 'ssnLast4', label: 'SSN (last 4)', kind: 'text' },
      { k: 'dlLast4', label: 'Licence (last 4)', kind: 'text' },
      { k: 'dlState', label: 'Licence state', kind: 'text' },
    ],
  },
  {
    id: 'business',
    title: 'Business',
    appliesTo: 'carrier',
    fields: [
      { k: 'companyName', label: 'Company', kind: 'text' },
      { k: 'ein', label: 'EIN', kind: 'text' },
      { k: 'mc', label: 'MC number', kind: 'text' },
      { k: 'dot', label: 'USDOT', kind: 'text' },
      { k: 'businessAddress', label: 'Business address', kind: 'text' },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    appliesTo: 'both',
    fields: [
      { k: 'email', label: 'Email', kind: 'text' },
      { k: 'phone', label: 'Phone', kind: 'text' },
    ],
  },
  {
    id: 'request',
    title: 'What they are asking for',
    appliesTo: 'both',
    fields: [
      { k: 'trucksCount', label: 'Trucks', kind: 'numeric' },
      { k: 'fuelCardsRequested', label: 'Cards requested', kind: 'numeric' },
      { k: 'requestedLimit', label: 'Requested limit', kind: 'numeric' },
    ],
  },
  {
    id: 'banking',
    title: 'Banking',
    appliesTo: 'both',
    fields: [
      { k: 'bankingSource', label: 'How is banking supplied?', kind: 'banking' },
      /**
       * The desk's own field, and the only place in the app that can set it.
       *
       * Sales picks Plaid and submits — the connection is the APPLICANT's to make and this desk's to
       * confirm, so intake is not blocked on it (see `intake.ts`). Without a control here the column
       * was writable by nothing, which is what made "Plaid bank connection" a dead end.
       */
      { k: 'plaidConnected', label: 'Plaid connected', kind: 'plaid' },
    ],
  },
];

const INTAKE_FIELDS: readonly IntakeField[] = FIELD_GROUPS.flatMap((g) => g.fields);

const TYPE_OPTIONS = [
  { value: 'owner_operator', label: 'Owner-operator' },
  { value: 'carrier', label: 'Carrier' },
];

const BANKING_OPTIONS = [
  { value: 'statements', label: 'Bank statements' },
  { value: 'plaid', label: 'Plaid bank connection' },
];

const PLAID_OPTIONS = [
  { value: 'false', label: 'Not connected' },
  { value: 'true', label: 'Connected' },
];

const DOC_MISSING: Record<string, string> = {
  driversLicenseDoc: "Driver's licence (upload)",
  ssnCardDoc: 'SSN card (upload)',
  bankStatements: 'Bank statements (upload)',
  plaidConnected: 'Plaid bank connection',
};

function typeValue(raw: string): VerificationApplicantType {
  return raw === 'owner_operator' ? 'owner_operator' : 'carrier';
}

export function IntakePane({
  detail,
  closed,
  busy,
  principalBusy,
  wexCardCutoff,
  onSave,
  onAddPrincipal,
  onRemovePrincipal,
  idPrefix = 'va-intake',
  formId,
  hideSave = false,
  hideCounts = false,
  hideHead = false,
  fileHint,
  onDirtyChange,
}: {
  detail: VerificationDeskDetail;
  closed: boolean;
  busy: boolean;
  principalBusy: boolean;
  wexCardCutoff: number | null;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onAddPrincipal: (fullName: string) => Promise<void>;
  onRemovePrincipal: (principalId: string) => Promise<void>;
  /** Default `va-intake`. The Full Details modal passes a different prefix so ids do not clash. */
  idPrefix?: string;
  /** When set, the fields wrap in a `<form>` so a dialog footer can submit them. */
  formId?: string;
  hideSave?: boolean;
  hideCounts?: boolean;
  hideHead?: boolean;
  fileHint?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [principalName, setPrincipalName] = useState('');
  const locked = !c.verificationProcess;
  const disabled = closed || busy || principalBusy;

  const valueOf = (key: string): string => {
    if (draft[key] !== undefined) return draft[key]!;
    const raw = c[key];
    return raw == null ? '' : String(raw);
  };

  const setField = (k: string, next: string): void => {
    setDraft((d) => ({ ...d, [k]: next }));
    setSaved(false);
  };

  const dirty = Object.keys(draft).length > 0;
  const missing = new Set(c.intakeMissing ?? []);
  const fileGaps = [...missing].filter((k) => DOC_MISSING[k]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const submit = async (): Promise<void> => {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      const meta = INTAKE_FIELDS.find((f) => f.k === k);
      const trimmed = v.trim();
      if (trimmed === '') {
        // `plaid` is a boolean: empty means Not connected, not "unset the column".
        body[k] = meta?.kind === 'plaid' ? false : null;
        continue;
      }
      if (meta?.kind === 'numeric') body[k] = Number(trimmed);
      else if (meta?.kind === 'type') body[k] = typeValue(trimmed);
      // A boolean column, and `patchBody` types it as one — sending the string would 400.
      else if (meta?.kind === 'plaid') body[k] = trimmed === 'true';
      else body[k] = trimmed;
    }
    await onSave(body);
    setDraft({});
    setSaved(true);
  };

  const addOwner = async (): Promise<void> => {
    const name = principalName.trim();
    if (!name) return;
    await onAddPrincipal(name);
    setPrincipalName('');
  };

  const received = detail.documents.filter((d) => d.status === 'received').length;
  /** Which of the SOP's two flows this case is on — the one fact the groups below key off. */
  const ownerOperatorFlow: 'owner_operator' | 'carrier' =
    c.applicantType === 'owner_operator' ? 'owner_operator' : 'carrier';

  const body = (
    <>
      {hideHead ? null : (
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Application</h3>
        <span className="va-pane-note">
          {closed ? 'Read-only — this case is decided' : 'Editable — Sales-owned, correctable here'}
        </span>
      </div>
      )}

      {FIELD_GROUPS.map((group) => (
        <div className="va-field-group" key={group.id}>
          <div className="va-pane-head">
            <h4 className="t-eyebrow va-pane-kicker">{group.title}</h4>
            {/* Which flow the group belongs to, said once per group instead of leaving the reviewer to
                infer it from the labels. Every group stays editable — this is the correction surface,
                and a case whose type was set wrong at ingest needs the other flow's columns reachable. */}
            {group.appliesTo !== 'both' && group.appliesTo !== ownerOperatorFlow ? (
              <span className="va-pane-note">
                Not required for {ownerOperatorFlow === 'owner_operator' ? 'an owner-operator' : 'a carrier'}
              </span>
            ) : null}
          </div>
          <div className="va-fields">
        {group.fields.map((f) => {
          const value = valueOf(f.k);
          const id = `${idPrefix}-${f.k}`;
          const invalid = missing.has(f.k);
          if (f.kind === 'type') {
            return (
              <div className="va-field" key={f.k}>
                <Select
                  label={f.label}
                  value={typeValue(value)}
                  searchable={false}
                  disabled={disabled}
                  invalid={invalid}
                  {...(invalid ? { message: 'Missing' } : {})}
                  options={TYPE_OPTIONS}
                  onChange={(v) => setField(f.k, v ?? 'carrier')}
                />
              </div>
            );
          }
          if (f.kind === 'plaid') {
            // Only shown on the Plaid path: a "Plaid connected" field on a statements case is a
            // control for a question nobody asked.
            if ((valueOf('bankingSource') || 'statements') !== 'plaid') return null;
            return (
              <div className="va-field" key={f.k}>
                <Select
                  label={f.label}
                  value={value === 'true' ? 'true' : 'false'}
                  searchable={false}
                  disabled={disabled}
                  options={PLAID_OPTIONS}
                  onChange={(v) => setField(f.k, v ?? 'false')}
                />
              </div>
            );
          }
          if (f.kind === 'banking') {
            return (
              <div className="va-field" key={f.k}>
                <Select
                  label={f.label}
                  value={value || 'statements'}
                  searchable={false}
                  disabled={disabled}
                  invalid={invalid}
                  {...(invalid ? { message: 'Missing' } : {})}
                  options={BANKING_OPTIONS}
                  onChange={(v) => setField(f.k, v ?? 'statements')}
                />
              </div>
            );
          }
          return (
            <div className="va-field" key={f.k}>
              <label className="va-field-label" htmlFor={id}>
                {f.label}
              </label>
              <Input
                id={id}
                value={value}
                placeholder={f.k === 'dateOfBirth' ? 'YYYY-MM-DD' : 'Not recorded'}
                disabled={disabled}
                inputMode={f.kind === 'numeric' || f.k === 'ssnLast4' ? 'decimal' : 'text'}
                maxLength={f.k === 'ssnLast4' ? 4 : f.k === 'dlState' ? 4 : undefined}
                fullWidth
                invalid={invalid}
                {...(invalid ? { message: 'Missing' } : {})}
                onChange={(e) => setField(f.k, e.currentTarget.value)}
              />
            </div>
          );
        })}
          </div>
        </div>
      ))}

      {/*
        THE COMPANY'S OWNERS — and only where the server asks for them.
        `evaluateIntakeCompleteness` requires at least one principal on the CARRIER flow only: an
        owner-operator IS the person, so there is nobody else to name. This pane showed the section on
        every case, which on an owner-operator was a control for a requirement that does not exist —
        Sales' own form has always hidden it there. A carrier keeps it whatever the reviewer has
        recorded, because that is the requirement they may still have to satisfy.
      */}
      {ownerOperatorFlow === 'carrier' ? (
      <div className="va-principals">
        <h3 className="t-eyebrow va-pane-kicker">Owners / principals</h3>
        {detail.principals.length === 0 ? (
          <p className="va-pane-body" data-needed={missing.has('principals') || undefined}>
            {missing.has('principals')
              ? 'At least one owner or principal is needed.'
              : 'None added yet.'}
          </p>
        ) : (
          <ul className="va-principal-list">
            {detail.principals.map((p) => (
              <li key={p.id} className="va-principal-row">
                <span className="va-principal-name">{p.fullName}</span>
                {closed ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void onRemovePrincipal(p.id)}
                    aria-label={`Remove ${p.fullName}`}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {closed ? null : (
          <div className="va-principal-add">
            <Input
              id={`${idPrefix}-principal`}
              value={principalName}
              placeholder="Full name"
              disabled={disabled}
              fullWidth
              aria-label="Owner or principal full name"
              onChange={(e) => setPrincipalName(e.currentTarget.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || principalName.trim().length === 0}
              loading={principalBusy}
              onClick={() => void addOwner()}
            >
              Add
            </Button>
          </div>
        )}
      </div>
      ) : null}

      {/*
        ITS OWN BLOCK, with its own heading.
        This sentence is about DOCUMENTS, and it used to render bare, immediately under the Owners /
        principals list — so "Still needed as files: Bank statements" read as a requirement of the
        principals section it sat inside. It is a separate outstanding item and now says so.
      */}
      {fileGaps.length > 0 ? (
        <div className="va-recorded" data-stack="true" data-needed="true">
          <h4 className="t-eyebrow va-pane-kicker">Still needed as files</h4>
          <p className="va-pane-body">
            {fileGaps.map((k) => DOC_MISSING[k]).join(', ')}. {fileHint ??
              'Attach from Documents on the right — any type will do, including “Something else”.'}
          </p>
        </div>
      ) : null}

      {hideCounts ? null : (
      <div className="va-counts">
        <span className="va-count">
          <span className="t-eyebrow">Documents received</span>
          <span className="va-count-v num" data-empty={received === 0}>
            {received || 'None'}
          </span>
        </span>
        <span className="va-count">
          <span className="t-eyebrow">Applicant type</span>
          <span className="va-count-v" data-empty={c.applicantType == null}>
            {APPLICANT_LABEL[c.applicantType ?? ''] ?? 'Not set'}
          </span>
        </span>
        <span className="va-count">
          <span className="t-eyebrow">Underwriting route</span>
          <span className="va-count-v" data-empty={false}>
            {routeLabel(routeOf(c, wexCardCutoff))}
          </span>
        </span>
      </div>
      )}

      {closed || hideSave ? null : (
        <div className="va-save">
          <Button
            variant="primary"
            icon="save"
            loading={busy}
            disabled={!dirty || principalBusy}
            onClick={() => void submit()}
          >
            {saved && !dirty ? 'Saved' : 'Save corrections'}
          </Button>
          {dirty ? (
            <Button variant="ghost" disabled={disabled} onClick={() => setDraft({})}>
              Discard
            </Button>
          ) : null}
          {locked ? (
            <span className="va-save-hint">Saving re-checks completeness — this can unlock the case.</span>
          ) : null}
        </div>
      )}
    </>
  );

  if (formId) {
    return (
      <form
        id={formId}
        className="va-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty || disabled) return;
          void submit();
        }}
      >
        {body}
      </form>
    );
  }

  return <div className="va-stack">{body}</div>;
}
