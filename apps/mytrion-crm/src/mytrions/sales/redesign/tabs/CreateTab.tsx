/**
 * Sales Mytrion redesign — Create tab. Three modes (matching the legacy widget's tabs): the 3-step
 * "Create a Ticket" wizard, the "Escalate Request" form, and the "Create Lead" form — all wired to
 * live Desk/CRM writes (the first two with optional attachments). The heavy lifting lives in
 * ../createTicketForms; this file is just the mode switch + layout.
 */
import { useState } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { ICO } from '../salesData';
import { TicketWizard, EscalationForm, CreateLeadForm } from '../createTicketForms';

type Mode = 'ticket' | 'escalation' | 'lead';

const TABS: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'ticket', label: 'Create Ticket', icon: ICO.doc },
  { id: 'escalation', label: 'Escalate Request', icon: ICO.warn },
  { id: 'lead', label: 'Create Lead', icon: ICO.lead },
];

export function CreateTab() {
  const [mode, setMode] = useState<Mode>('ticket');
  return (
    <div className="ss-fu" style={s('max-width:1080px;width:100%;margin:0 auto;padding-bottom:24px')}>
      <div style={s('display:flex;gap:6px;margin-bottom:22px;padding:4px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);width:fit-content;max-width:100%')}>
        {TABS.map((t) => {
          const on = mode === t.id;
          return (
            <button key={t.id} onClick={() => setMode(t.id)} style={s(`display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius-md);border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .14s`)}>
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          );
        })}
      </div>
      {mode === 'ticket' ? <TicketWizard /> : mode === 'escalation' ? <EscalationForm /> : <CreateLeadForm />}
    </div>
  );
}
