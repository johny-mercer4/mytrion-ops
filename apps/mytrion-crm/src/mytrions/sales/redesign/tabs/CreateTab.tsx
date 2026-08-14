/**
 * Sales Mytrion redesign — Create tab. Four modes: the 3-step "Create a Ticket" wizard, the
 * "Escalate Request" form, the "Create Lead" form, and the credit "Application" intake — all wired
 * to live writes. The heavy lifting lives in ../createTicketForms and ../applicationIntake; this
 * file is just the mode switch + layout.
 */
import { useState } from 'react';
import { ICO, NAV_DESC } from '../salesData';
import { SalesPage, SalesPageHead, SalesSubTabs, type SalesSubTab } from '../SalesPage';
import { TicketWizard, EscalationForm, CreateLeadForm } from '../createTicketForms';
import { ApplicationIntake } from '../applicationIntake';
import { useSales } from '../ctx';

type Mode = 'ticket' | 'escalation' | 'lead' | 'application';

const TABS: ReadonlyArray<SalesSubTab<Mode>> = [
  { id: 'ticket', label: 'Create Ticket', icon: ICO.doc },
  { id: 'escalation', label: 'Escalate Request', icon: ICO.warn },
  { id: 'lead', label: 'Create Lead', icon: ICO.lead },
  { id: 'application', label: 'Application', icon: 'verification' },
];

const MODE_DESC: Record<Mode, string> = {
  ticket: 'Raise a ticket for Customer Service, Billing or Verification. Attachments optional.',
  escalation: 'Escalate an existing problem to the department that owns it.',
  lead: 'Add a new lead straight into Zoho CRM under your name.',
  application:
    'Start a credit application. Verification cannot begin until every detail and document is in.',
};

export function CreateTab() {
  const [mode, setMode] = useState<Mode>('ticket');
  // A newly created draft is held here so the agent keeps editing the SAME application instead of
  // creating a second one on the next save.
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const { pushToast } = useSales();

  return (
    <SalesPage width="narrow">
      <SalesPageHead description={`${NAV_DESC.create} ${MODE_DESC[mode]}`} />
      <SalesSubTabs items={TABS} value={mode} onChange={setMode} label="What to create" />
      {mode === 'ticket' ? (
        <TicketWizard />
      ) : mode === 'escalation' ? (
        <EscalationForm />
      ) : mode === 'lead' ? (
        <CreateLeadForm />
      ) : (
        <ApplicationIntake
          {...(draftId === undefined ? {} : { applicationId: draftId })}
          onCreated={setDraftId}
          onSubmitted={() => {
            setDraftId(undefined);
            pushToast('Sent to Verification', 'Track it on the Verification tab.');
          }}
        />
      )}
    </SalesPage>
  );
}
