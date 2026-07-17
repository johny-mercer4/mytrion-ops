/**
 * Sales Mytrion redesign — Create tab. Three modes (matching the legacy widget's tabs): the 3-step
 * "Create a Ticket" wizard, the "Escalate Request" form, and the "Create Lead" form — all wired to
 * live Desk/CRM writes (the first two with optional attachments). The heavy lifting lives in
 * ../createTicketForms; this file is just the mode switch + layout.
 */
import { useState } from 'react';
import { s } from '../dc';
import { TicketWizard, EscalationForm, CreateLeadForm } from '../createTicketForms';

type Mode = 'ticket' | 'escalation' | 'lead';

const TABS: { id: Mode; label: string; icon: string }[] = [
  { id: 'ticket', label: 'Create Ticket', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { id: 'escalation', label: 'Escalate Request', icon: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' },
  { id: 'lead', label: 'Create Lead', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
];

export function CreateTab() {
  const [mode, setMode] = useState<Mode>('ticket');
  return (
    <div className="ss-fu" style={s('max-width:640px;margin:0 auto;padding-bottom:24px')}>
      <div style={s('display:flex;gap:6px;margin-bottom:22px;padding:4px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);width:fit-content;max-width:100%')}>
        {TABS.map((t) => {
          const on = mode === t.id;
          return (
            <button key={t.id} onClick={() => setMode(t.id)} style={s(`display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius-md);border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .14s`)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d={t.icon} /></svg>
              {t.label}
            </button>
          );
        })}
      </div>
      {mode === 'ticket' ? <TicketWizard /> : mode === 'escalation' ? <EscalationForm /> : <CreateLeadForm />}
    </div>
  );
}
