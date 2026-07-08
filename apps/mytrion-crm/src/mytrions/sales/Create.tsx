import { useState } from 'react';
import { AlertTriangle, Info, Siren, Ticket, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CreateTab } from './data';
import { useToast } from './Toast';

const TABS: { id: CreateTab; label: string; sub: string; icon: typeof Ticket }[] = [
  { id: 'ticket', label: 'Support Ticket', sub: 'General customer service request', icon: Ticket },
  { id: 'escalation', label: 'Escalation', sub: 'Urgent, on-call billing lead', icon: Siren },
  { id: 'lead', label: 'Create Lead', sub: 'New prospect from carrier search', icon: UserPlus },
];

const HINT_COPY: Record<CreateTab, string> = {
  ticket: 'Support tickets route to the general CS queue and are triaged within one business day.',
  escalation: 'Escalations page the on-call billing lead directly. Use only when a customer is blocked.',
  lead: 'New leads are added to the CRM pipeline and routed to the next available sales rep.',
};

const fieldClass = 'w-full rounded-xs border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/12';

export function Create() {
  const [tab, setTab] = useState<CreateTab>('ticket');
  const { push } = useToast();

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Create</h2>
        <p className="text-sm text-muted-foreground">Support tickets, escalations, and new leads — all in one place.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-3 rounded-xs border p-4 text-left transition-colors ${
                active ? 'border-primary bg-primary/8' : 'bg-card hover:bg-muted/40'
              }`}
            >
              <span className={`flex size-9 flex-none items-center justify-center rounded-xs ${active ? 'bg-primary text-primary-foreground' : 'bg-primary/12 text-primary'}`}>
                <t.icon className="size-4.5" />
              </span>
              <div>
                <div className="font-semibold">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.sub}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2.5 rounded-xs border border-primary/24 bg-primary/8 px-3.5 py-3 text-xs text-foreground">
        <Info className="mt-0.5 size-4 flex-none text-primary" />
        <span>{HINT_COPY[tab]}</span>
      </div>

      {tab === 'ticket' ? <TicketForm onSubmit={() => push('success', 'Support ticket created successfully.')} /> : null}
      {tab === 'escalation' ? <EscalationForm onSubmit={() => push('warning', 'Escalation request created successfully.')} /> : null}
      {tab === 'lead' ? <LeadForm onSubmit={() => push('success', 'Lead created successfully.')} /> : null}
    </div>
  );
}

function TicketForm({ onSubmit }: { onSubmit: () => void }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-xs border bg-card p-5">
      <Field label="Deal">
        <input readOnly value="Great Way Logistics Inc #98765" className={fieldClass} />
      </Field>
      <Field label="Subject">
        <input readOnly value="Card decline on fuel purchase — need EFS review" className={fieldClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Type">
          <input readOnly value="Card Issue" className={fieldClass} />
        </Field>
        <Field label="Priority">
          <input readOnly value="Medium" className={fieldClass} />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          readOnly
          rows={4}
          value="Driver reports card ••••4821 declined at pump this morning despite an available balance. Requesting an EFS-side review before escalating to fraud."
          className={fieldClass}
        />
      </Field>
      <Button onClick={onSubmit} className="self-start">
        Create Ticket
      </Button>
    </div>
  );
}

function EscalationForm({ onSubmit }: { onSubmit: () => void }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-xs border bg-card p-5">
      <Field label="Carrier">
        <input readOnly value="Sunrise Freight LLC #88431" className={fieldClass} />
      </Field>
      <Field label="Why is this urgent?">
        <textarea
          readOnly
          rows={4}
          value="Carrier's entire fleet is unable to fuel — all cards are showing a hold. Balance is current and drivers are stranded at multiple locations."
          className={fieldClass}
        />
      </Field>
      <div className="flex items-start gap-2.5 rounded-xs border border-warn/30 bg-warn/10 px-3.5 py-3 text-xs text-warn">
        <AlertTriangle className="mt-0.5 size-4 flex-none" />
        <span>Escalations page the on-call billing lead directly. Use only when a customer is blocked.</span>
      </div>
      <Button variant="destructive" onClick={onSubmit} className="self-start bg-warn/15 text-warn hover:bg-warn/25">
        Escalate Now
      </Button>
    </div>
  );
}

function LeadForm({ onSubmit }: { onSubmit: () => void }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-xs border bg-card p-5">
      <Field label="Company name *">
        <input readOnly value="Iron Range Transport" className={fieldClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="DOT">
          <input readOnly value="2284119" className={fieldClass} />
        </Field>
        <Field label="Phone">
          <input readOnly value="(218) 555-0142" className={fieldClass} />
        </Field>
      </div>
      <Field label="Power units">
        <input readOnly value="14" className={fieldClass} />
      </Field>
      <Button onClick={onSubmit} className="self-start">
        Create Lead
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
