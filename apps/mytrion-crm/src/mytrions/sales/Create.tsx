import { useState } from 'react';
import { AlertTriangle, ExternalLink, Info, Loader2, Siren, Ticket, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CreateTab } from './data';
import { createEscalation, createLead, ESCALATION_REASONS, leadUrl, type LeadOutcome } from './live';
import { useToast } from './Toast';

const TABS: { id: CreateTab; label: string; sub: string; icon: typeof Ticket }[] = [
  { id: 'lead', label: 'Create Lead', sub: 'New prospect for the CRM pipeline', icon: UserPlus },
  { id: 'escalation', label: 'Escalation', sub: 'Route a blocker to the escalation desk', icon: Siren },
  { id: 'ticket', label: 'Support Ticket', sub: 'General customer service request', icon: Ticket },
];

const HINT_COPY: Record<CreateTab, string> = {
  ticket: 'Support tickets need the Zoho Desk hand-off (contact match + Desk ticket) — coming in the next pass.',
  escalation: 'Escalations create an Escalation Request in CRM and page the escalation desk. Use when a customer is blocked.',
  lead: 'New leads are added to the CRM pipeline under your name (or the agent you are acting as).',
};

const fieldClass =
  'w-full rounded-md border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/12';

export function Create() {
  const [tab, setTab] = useState<CreateTab>('lead');

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-heading text-2xl font-bold">Create</h2>
        <p className="text-sm text-muted-foreground">Leads, escalations, and support tickets — all in one place.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                active ? 'border-primary bg-primary/8' : 'bg-card hover:bg-muted/40'
              }`}
            >
              <span className={`flex size-9 flex-none items-center justify-center rounded-md ${active ? 'bg-primary text-primary-foreground' : 'bg-primary/12 text-primary'}`}>
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

      <div className="flex items-start gap-2.5 rounded-md border border-primary/24 bg-primary/8 px-3.5 py-3 text-xs text-foreground">
        <Info className="mt-0.5 size-4 flex-none text-primary" />
        <span>{HINT_COPY[tab]}</span>
      </div>

      {tab === 'lead' ? <LeadForm /> : null}
      {tab === 'escalation' ? <EscalationForm /> : null}
      {tab === 'ticket' ? <TicketPlaceholder /> : null}
    </div>
  );
}

/** Widget lead form: salutation, first/last, company*, phone* (exactly 10 digits). */
function LeadForm() {
  const { push } = useToast();
  const [salutation, setSalutation] = useState('Mr.');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LeadOutcome | null>(null);

  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const valid = lastName.trim().length > 0 && companyName.trim().length > 0 && digits.length === 10;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await createLead({
        salutation,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        phone: digits,
      });
      setOutcome(res);
      if (res.status === 'created') push('success', 'Lead created successfully.');
      else if (res.status === 'duplicate') push('info', 'A lead with this info already exists.');
      else push('error', res.message);
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Lead creation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <div className="grid grid-cols-[0.5fr_1fr_1fr] gap-4">
        <Field label="Salutation">
          <select value={salutation} onChange={(e) => setSalutation(e.target.value)} className={fieldClass}>
            <option>Mr.</option>
            <option>Ms.</option>
          </select>
        </Field>
        <Field label="First name">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Last name *">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
        </Field>
      </div>
      <Field label="Company name *">
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={fieldClass} />
      </Field>
      <Field label={`Phone * (${digits.length}/10 digits)`}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(218) 555-0142" className={fieldClass} />
      </Field>
      {outcome && outcome.status !== 'failed' && outcome.leadId ? (
        <a
          href={leadUrl(outcome.leadId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <ExternalLink className="size-3.5" />
          {outcome.status === 'created' ? 'Go to Lead' : 'Open existing Lead'}
        </a>
      ) : null}
      <Button onClick={() => void submit()} disabled={!valid || busy} className="self-start">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        Create Lead
      </Button>
    </div>
  );
}

/** Widget escalation form: reason (fixed list), subject*, description* → createescalationticket. */
function EscalationForm() {
  const { push } = useToast();
  const [reason, setReason] = useState<string>(ESCALATION_REASONS[0]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const valid = subject.trim().length > 0 && description.trim().length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await createEscalation({ reason, subject: subject.trim(), description: description.trim() });
      setCreatedId(res.ticketId);
      push('success', `Escalation created (ticket ${res.ticketId}).`);
      setSubject('');
      setDescription('');
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Escalation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <Field label="Reason *">
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass}>
          {ESCALATION_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </Field>
      <Field label="Subject *">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClass} />
      </Field>
      <Field label="Description *">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={fieldClass} />
      </Field>
      <div className="flex items-start gap-2.5 rounded-md border border-warn/30 bg-warn/10 px-3.5 py-3 text-xs text-warn">
        <AlertTriangle className="mt-0.5 size-4 flex-none" />
        <span>Escalations page the escalation desk directly. Use only when a customer is blocked.</span>
      </div>
      {createdId ? <div className="text-sm text-good">Escalation ticket {createdId} created.</div> : null}
      <Button onClick={() => void submit()} disabled={!valid || busy} className="self-start bg-warn/15 text-warn hover:bg-warn/25">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        Escalate Now
      </Button>
    </div>
  );
}

/** Desk-first ticket flow (contact search → Desk ticket → CRM mirror) — next pass. */
function TicketPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
      Support tickets require the Zoho Desk hand-off (contact match, Desk ticket, CRM mirror + attachments).
      That flow lands in the next pass — use Escalation for anything urgent.
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
