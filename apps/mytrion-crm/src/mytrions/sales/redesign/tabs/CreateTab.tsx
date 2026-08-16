/**
 * Sales Mytrion redesign — Create tab. Three modes: the 3-step "Create a Ticket" wizard, the
 * "Escalate Request" form, and the "Create Lead" form — all wired to live writes. The heavy
 * lifting lives in ../createTicketForms; this file is just the mode switch + layout.
 */
import { useState } from 'react';
import { ICO, NAV_DESC } from '../salesData';
import { SalesPage, SalesPageHead, SalesSubTabs, type SalesSubTab } from '../SalesPage';
import { TicketWizard, EscalationForm, CreateLeadForm } from '../createTicketForms';

type Mode = 'ticket' | 'escalation' | 'lead';

const TABS: ReadonlyArray<SalesSubTab<Mode>> = [
  { id: 'ticket', label: 'Create Ticket', icon: ICO.doc },
  { id: 'escalation', label: 'Escalate Request', icon: ICO.warn },
  { id: 'lead', label: 'Create Lead', icon: ICO.lead },
];

const MODE_DESC: Record<Mode, string> = {
  ticket: 'Raise a ticket for Customer Service, Billing or Verification. Attachments optional.',
  escalation: 'Escalate an existing problem to the department that owns it.',
  lead: 'Add a new lead straight into Zoho CRM under your name.',
};

export function CreateTab() {
  const [mode, setMode] = useState<Mode>('ticket');

  return (
    <SalesPage width="narrow">
      <SalesPageHead description={`${NAV_DESC.create} ${MODE_DESC[mode]}`} />
      <SalesSubTabs items={TABS} value={mode} onChange={setMode} label="What to create" />
      {mode === 'ticket' ? (
        <TicketWizard />
      ) : mode === 'escalation' ? (
        <EscalationForm />
      ) : (
        <CreateLeadForm />
      )}
    </SalesPage>
  );
}
