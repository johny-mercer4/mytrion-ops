/**
 * Case-data fields for Sales intake. Kept off applicationIntake so file writes and form
 * writes stay in different modules — the same split the state stores use.
 */
import { s } from './dc';
import { Field, Section, SelectField } from './applicationFields';
import { DocSlot } from './applicationDocs';
import { PrincipalsSection } from './applicationIntakePanels';
import type {
  ApplicationDetail,
  VerificationApplicantType,
  VerificationDocType,
} from '@/api/verificationFlow';

export const REQUIRED_STATEMENTS = 3;
export const STATEMENT_LABELS: readonly string[] = ['Statement 1', 'Statement 2', 'Statement 3'];
export const IDENTITY_SLOTS: ReadonlyArray<{
  docType: VerificationDocType;
  label: string;
  missingKey: string;
}> = [
  { docType: 'drivers_license', label: "Driver's licence", missingKey: 'driversLicenseDoc' },
  { docType: 'ssn_card', label: 'SSN card', missingKey: 'ssnCardDoc' },
];

export function ApplicationIntakeFields({
  form,
  set,
  flagged,
  serverMissing,
  applicantType,
  locked,
  exclusiveBusy,
  pendingPrincipal,
  principalError,
  principalName,
  onPrincipalName,
  onAddPrincipal,
  onRemovePrincipal,
  detail,
  identityDocs,
  statementSlots,
  fileOps,
  errorScope,
  errorMessage,
  onPickSlot,
  onOpenDoc,
  onRemoveDoc,
}: {
  form: Record<string, string>;
  set: (k: string) => (v: string) => void;
  flagged: (field: string) => boolean;
  serverMissing: ReadonlySet<string>;
  applicantType: VerificationApplicantType;
  locked: boolean;
  exclusiveBusy: boolean;
  pendingPrincipal: boolean;
  principalError: string | null;
  principalName: string;
  onPrincipalName: (v: string) => void;
  onAddPrincipal: () => void | Promise<void>;
  onRemovePrincipal: (id: string) => void | Promise<void>;
  detail: ApplicationDetail | null;
  identityDocs: Partial<Record<string, { id: string; fileName: string | null }>>;
  statementSlots: Array<{ id: string; fileName: string | null } | null>;
  fileOps: ReadonlySet<string>;
  errorScope: string | null;
  errorMessage: string | null;
  onPickSlot: (file: File, docType: VerificationDocType, label: string) => void;
  onOpenDoc: (id: string, fileName: string | null) => void;
  onRemoveDoc: (id: string, scope: string) => void;
}) {
  const isOwnerOperator = applicantType === 'owner_operator';
  const needsAuthority = applicantType === 'carrier';
  const slotError = (scope: string) => (errorScope === scope ? errorMessage : null);

  return (
    <>
      {isOwnerOperator ? (
        <Section title="Applicant">
          <Field label="First name" name="firstName" value={form.firstName ?? ''} onChange={set('firstName')} missing={flagged('firstName')} />
          <Field label="Last name" name="lastName" value={form.lastName ?? ''} onChange={set('lastName')} missing={flagged('lastName')} />
          <Field label="Date of birth" name="dateOfBirth" type="date" value={form.dateOfBirth ?? ''} onChange={set('dateOfBirth')} missing={flagged('dateOfBirth')} />
          <Field label="Residential address" name="residentialAddress" value={form.residentialAddress ?? ''} onChange={set('residentialAddress')} missing={flagged('residentialAddress')} />
          <Field
            label="SSN (last 4)"
            name="ssnLast4"
            value={form.ssnLast4 ?? ''}
            onChange={set('ssnLast4')}
            missing={flagged('ssnLast4')}
            inputMode="numeric"
            maxLength={4}
            hint="Last 4 only. The full number is never stored here."
          />
          <Field label="Licence (last 4)" name="dlLast4" value={form.dlLast4 ?? ''} onChange={set('dlLast4')} missing={flagged('dlLast4')} maxLength={8} />
          <Field label="Licence state" name="dlState" value={form.dlState ?? ''} onChange={set('dlState')} maxLength={4} />
          <div style={s('grid-column:1/-1;display:grid;gap:8px')}>
            {IDENTITY_SLOTS.map((slot) => {
              const held = identityDocs[slot.docType] ?? null;
              const scope = `slot:${slot.label}`;
              return (
                <DocSlot
                  key={slot.docType}
                  label={slot.label}
                  doc={held}
                  locked={locked}
                  missing={serverMissing.has(slot.missingKey) && !held}
                  uploading={fileOps.has(scope)}
                  removing={held ? fileOps.has(`doc:${held.id}`) : false}
                  error={slotError(scope)}
                  onPick={(file) => onPickSlot(file, slot.docType, slot.label)}
                  onOpen={held ? () => onOpenDoc(held.id, held.fileName) : null}
                  onRemove={held ? () => onRemoveDoc(held.id, `doc:${held.id}`) : null}
                />
              );
            })}
          </div>
        </Section>
      ) : (
        <Section
          title="Business"
          hint={
            needsAuthority
              ? 'MC and USDOT if the company holds authority. Without either, submit goes to Manager Review.'
              : 'No MC/DOT for this type — submit goes to Manager Review.'
          }
        >
          <Field label="Full legal company name" name="companyName" value={form.companyName ?? ''} onChange={set('companyName')} missing={flagged('companyName')} />
          <Field label="EIN" name="ein" value={form.ein ?? ''} onChange={set('ein')} missing={flagged('ein')} />
          {needsAuthority ? (
            <>
              <Field label="MC number" name="mc" value={form.mc ?? ''} onChange={set('mc')} missing={flagged('mc')} />
              <Field label="USDOT number" name="dot" value={form.dot ?? ''} onChange={set('dot')} missing={flagged('dot')} inputMode="numeric" />
            </>
          ) : null}
          <Field label="Business address" name="businessAddress" value={form.businessAddress ?? ''} onChange={set('businessAddress')} missing={flagged('businessAddress')} />
        </Section>
      )}

      {!isOwnerOperator ? (
        <PrincipalsSection
          detail={detail}
          missing={serverMissing.has('principals')}
          locked={locked}
          adding={pendingPrincipal}
          busy={exclusiveBusy}
          error={principalError}
          value={principalName}
          onValue={onPrincipalName}
          onAdd={onAddPrincipal}
          onRemove={onRemovePrincipal}
        />
      ) : null}

      <Section title="Contact">
        <Field label="Email" name="email" type="email" value={form.email ?? ''} onChange={set('email')} missing={flagged('email')} inputMode="email" />
        <Field label="Phone" name="phone" type="tel" value={form.phone ?? ''} onChange={set('phone')} missing={flagged('phone')} inputMode="tel" />
      </Section>

      <Section title="What they are asking for">
        <Field label="Number of trucks" name="trucksCount" value={form.trucksCount ?? ''} onChange={set('trucksCount')} missing={flagged('trucksCount')} inputMode="numeric" />
        <Field
          label="Fuel cards requested"
          name="fuelCardsRequested"
          value={form.fuelCardsRequested ?? ''}
          onChange={set('fuelCardsRequested')}
          missing={flagged('fuelCardsRequested')}
          inputMode="numeric"
          hint={
            Number(form.fuelCardsRequested) > 20
              ? 'Over 20 cards routes to WEX underwriting.'
              : undefined
          }
        />
        <Field label="Requested credit limit" name="requestedLimit" value={form.requestedLimit ?? ''} onChange={set('requestedLimit')} missing={flagged('requestedLimit')} inputMode="decimal" />
      </Section>

      <Section title="Banking" hint={`Last ${REQUIRED_STATEMENTS} statements, or Plaid.`}>
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
                  locked={locked}
                  missing={serverMissing.has('bankStatements') && !held}
                  uploading={fileOps.has(scope)}
                  removing={held ? fileOps.has(`doc:${held.id}`) : false}
                  error={slotError(scope)}
                  onPick={(file) => onPickSlot(file, 'bank_statement', label)}
                  onOpen={held ? () => onOpenDoc(held.id, held.fileName) : null}
                  onRemove={held ? () => onRemoveDoc(held.id, `doc:${held.id}`) : null}
                />
              );
            })}
          </div>
        ) : null}
      </Section>
    </>
  );
}
