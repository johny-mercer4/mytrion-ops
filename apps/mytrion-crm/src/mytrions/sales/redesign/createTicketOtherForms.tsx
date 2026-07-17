/**
 * Escalate Request + Create Lead forms (Create tab siblings of the ticket wizard).
 */
import { useState } from 'react';
import { s } from './dc';
import { useSales } from './ctx';
import { createEscalation } from '@/api/desk';
import { callTouchpoint } from '@/api/touchpoints';
import { resolveCreateLeadOutcome } from './createLeadOutcome';
import { leadShortId, zohoLeadUrl } from './crmUrls';
import {
  AttachZone,
  BTN_DISABLED,
  BTN_PRIMARY,
  BTN_PRIMARY_BUSY,
  DROP_PANEL,
  FIELD,
  LABEL,
  SELECT_BTN,
} from './createTicketShared';

const ESCALATION_REASONS = [
  'Problem with the client', 'Question', 'Personal Request', 'CITI Fuel Duplicate', 'CRM Question',
  'Lead Transfer', 'Deal Transfer', 'Mobile App Issue', 'RingCentral Number Issue', 'Additional Discounts', 'Other',
];
const SALUTATIONS = ['Mr', 'Ms'];

export function EscalationForm() {
  const { pushToast, openTicket } = useSales();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [att, setAtt] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = !!(subject.trim() && body.trim() && reason) && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const hadFile = !!att;
      const res = await createEscalation({ subject: subject.trim(), description: body.trim(), reason }, att);
      setSubject(''); setBody(''); setReason(''); setAtt(null);
      pushToast(
        'Escalation created',
        hadFile
          ? res.attached
            ? 'Routed to the escalation team — file attached.'
            : 'Routed to the escalation team — the file couldn’t be attached.'
          : 'Routed to the escalation team — opening it now.',
      );
      if (res.ticketId) openTicket(res.ticketId);
    } catch (e) {
      pushToast('Couldn’t create escalation', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={s('margin-bottom:20px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Escalate a Request</div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:3px')}>File an escalation for a request that needs a manager or another team to step in.</div>
      </div>
      <div style={s('padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:17px')}>
        <div><div style={s(LABEL)}>Subject <span style={s('color:var(--accent)')}>*</span></div><input value={subject} onChange={(e) => setSubject(e.currentTarget.value)} placeholder="Brief summary of the escalation" className="ss-in" style={s(FIELD)} /></div>
        <div><div style={s(LABEL)}>Description <span style={s('color:var(--accent)')}>*</span></div><textarea value={body} onChange={(e) => setBody(e.currentTarget.value)} placeholder="Enter escalation details — what's blocked, what you've tried, and what you need." className="ss-in" style={s('width:100%;min-height:120px;padding:11px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;resize:vertical;line-height:1.5')} /></div>
        <div><div style={s(LABEL)}>Escalation Reason <span style={s('color:var(--accent)')}>*</span></div>
          <div style={s('position:relative')}>
            <button
              type="button"
              onClick={() => setReasonOpen((o) => !o)}
              style={s(`${SELECT_BTN};color:${reason ? 'var(--text)' : 'var(--muted)'};font-weight:${reason ? '600' : '400'}`)}
            >
              <span style={s('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{reason || 'Select a reason'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--muted)' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {reasonOpen && (
              <>
                <div onClick={() => setReasonOpen(false)} style={s('position:fixed;inset:0;z-index:8')} />
                <div className="ss-scroll" role="listbox" style={s(DROP_PANEL)}>
                  {ESCALATION_REASONS.map((r) => {
                    const on = reason === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => { setReason(r); setReasonOpen(false); }}
                        className={`ss-menu-i${on ? ' is-on' : ''}`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <div><div style={s(LABEL)}>Attachment <span style={s('font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0')}>· max 20MB</span></div><AttachZone id="esc-att" file={att} onFile={setAtt} /></div>
        <div style={s('display:flex;justify-content:flex-end;padding-top:2px')}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit && !submitting}
            className={canSubmit || submitting ? 'ss-btn-p' : undefined}
            style={s(submitting ? BTN_PRIMARY_BUSY : canSubmit ? BTN_PRIMARY : BTN_DISABLED)}
          >
            {submitting ? (<><span style={s('width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />Creating…</>) : 'Create Escalation Ticket'}
          </button>
        </div>
      </div>
    </>
  );
}

export function CreateLeadForm() {
  const { pushToast } = useSales();
  const [salutation, setSalutation] = useState('Mr');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    duplicate: boolean;
    leadId: string;
    company: string;
  } | null>(null);
  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const canSubmit = !!(lastName.trim() && company.trim() && digits.length === 10) && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await callTouchpoint('leads.create', {
        createPayload: {
          salutation,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          companyName: company.trim(),
          phone: digits,
        },
      });
      const outcome = resolveCreateLeadOutcome(res);
      if (!outcome.ok) throw new Error(outcome.message);
      const name = company.trim();
      setSalutation('Mr'); setFirstName(''); setLastName(''); setCompany(''); setPhone('');
      setResult({ duplicate: outcome.duplicate, leadId: outcome.leadId, company: name });
      pushToast(
        outcome.duplicate ? 'Lead already exists' : 'Lead created',
        outcome.duplicate
          ? `${name} is already in the CRM — open it below.`
          : `${name} was added to your leads.`,
      );
    } catch (e) {
      pushToast('Couldn’t create lead', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={s('margin-bottom:20px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Create a Lead</div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:3px')}>Add a new lead to your pipeline. Last name, company, and a 10-digit phone are required.</div>
      </div>
      {result && (
        <div
          style={s(
            `margin-bottom:16px;padding:16px 18px;border-radius:var(--radius-md);border:1px solid ${
              result.duplicate
                ? 'color-mix(in srgb,var(--orange) 40%,var(--border))'
                : 'color-mix(in srgb,var(--ok) 40%,var(--border))'
            };background:${
              result.duplicate
                ? 'color-mix(in srgb,var(--orange) 10%,var(--surface))'
                : 'color-mix(in srgb,var(--ok) 10%,var(--surface))'
            };display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap`,
          )}
        >
          <div>
            <div style={s(`font-weight:700;font-size:13.5px;color:${result.duplicate ? 'var(--orange)' : 'var(--ok)'}`)}>
              {result.duplicate ? 'Lead already exists' : 'Lead created'}
            </div>
            <div style={s('font-size:12.5px;color:var(--muted);margin-top:3px')}>
              {result.duplicate
                ? `${result.company} is already in Zoho CRM.`
                : `${result.company} was added to your leads.`}
            </div>
          </div>
          <div style={s('display:flex;align-items:center;gap:8px')}>
            {result.leadId ? (
              <a
                href={zohoLeadUrl(result.leadId)}
                target="_blank"
                rel="noopener noreferrer"
                className="ss-btn-p"
                style={s(
                  `height:34px;padding:0 16px;border-radius:var(--radius-md);border:none;display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:12.5px;text-decoration:none;color:#fff;background:${
                    result.duplicate
                      ? 'linear-gradient(120deg,var(--orange),#d97706)'
                      : 'linear-gradient(120deg,var(--accent),var(--accent-2))'
                  }`,
                )}
              >
                {result.duplicate ? 'Open Existing Lead ↗' : `Go to Lead #${leadShortId(result.leadId)} ↗`}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setResult(null)}
              style={s(
                'height:34px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:transparent;color:var(--muted);font-weight:700;font-size:12px;cursor:pointer',
              )}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div style={s('padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:17px')}>
        <div style={s('display:grid;grid-template-columns:110px 1fr 1fr;gap:12px')}>
          <div>
            <div style={s(LABEL)}>Title</div>
            <select value={salutation} onChange={(e) => setSalutation(e.currentTarget.value)} className="ss-in" style={s(`${FIELD};cursor:pointer`)}>
              {SALUTATIONS.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
            </select>
          </div>
          <div><div style={s(LABEL)}>First Name</div><input value={firstName} onChange={(e) => setFirstName(e.currentTarget.value)} placeholder="First name" className="ss-in" style={s(FIELD)} /></div>
          <div><div style={s(LABEL)}>Last Name <span style={s('color:var(--accent)')}>*</span></div><input value={lastName} onChange={(e) => setLastName(e.currentTarget.value)} placeholder="Last name" className="ss-in" style={s(FIELD)} /></div>
        </div>
        <div><div style={s(LABEL)}>Company Name <span style={s('color:var(--accent)')}>*</span></div><input value={company} onChange={(e) => setCompany(e.currentTarget.value)} placeholder="The company they own or work for" className="ss-in" style={s(FIELD)} /></div>
        <div>
          <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:8px')}>
            <div style={s(`${LABEL};margin-bottom:0`)}>Phone <span style={s('color:var(--accent)')}>*</span></div>
            <span style={s(`font-size:10.5px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${digits.length === 10 ? 'var(--ok)' : 'var(--faint)'}`)}>{digits.length}/10 digits</span>
          </div>
          <input value={phone} onChange={(e) => setPhone(e.currentTarget.value)} inputMode="numeric" placeholder="10-digit phone — no dashes, brackets, or spaces" className="ss-in" style={s(FIELD)} />
        </div>
        <div style={s('display:flex;justify-content:flex-end;padding-top:2px')}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit && !submitting}
            className={canSubmit || submitting ? 'ss-btn-p' : undefined}
            style={s(submitting ? BTN_PRIMARY_BUSY : canSubmit ? BTN_PRIMARY : BTN_DISABLED)}
          >
            {submitting ? (<><span style={s('width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />Creating…</>) : 'Create Lead'}
          </button>
        </div>
      </div>
    </>
  );
}
