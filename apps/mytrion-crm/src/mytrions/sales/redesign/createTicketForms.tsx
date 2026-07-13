/**
 * Create-tab forms — the 3-step "Create a Ticket" wizard (Department → Deal → Details) and the
 * "Escalate Request" form, ported from the updated reference (SalesMytrion222). Both file real
 * work: the wizard POSTs a Desk support ticket (createDeskTicket), the escalation form POSTs an
 * escalation request (createEscalation) — each with an optional drag/drop attachment (≤20MB).
 */
import { useState } from 'react';
import { s } from './dc';
import { useSales } from './ctx';
import { useLoad, loadClientCards, type ClientCardVM } from './live';
import { loadDeals, type DealVM } from './dataCenterLive';
import { createDeskTicket, createEscalation, type CreateTicketInput } from '@/api/desk';

type DeptSlug = 'cs' | 'billing' | 'verification' | 'maintenance';

interface DeptDef {
  id: DeptSlug;
  name: string;
  desc: string;
  color: string;
  icon: string[];
}

const DEPTS: DeptDef[] = [
  { id: 'cs', name: 'Customer Service', desc: 'Cards, activations, limits, money codes', color: 'var(--accent)', icon: ['M4 14v-2a8 8 0 0 1 16 0v2', 'M4 14h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M20 14h-2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1z', 'M20 17v1a3 3 0 0 1-3 3h-3'] },
  { id: 'billing', name: 'Billing & Accounting', desc: 'Invoices, payments, billing forms', color: 'var(--violet)', icon: ['M6 3h12a1 1 0 0 1 1 1v17l-2.5-1.7L14 21l-2-1.7L10 21l-2.5-1.7L5 21V4a1 1 0 0 1 1-1z', 'M9 8h6', 'M9 12h6', 'M9 16h4'] },
  { id: 'verification', name: 'Verification', desc: 'Plaid links, limit & billing review', color: 'var(--ok)', icon: ['M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z', 'M9 12l2 2 4-4'] },
  { id: 'maintenance', name: 'Maintenance', desc: 'Tire, oil, mechanical, roadside', color: 'var(--orange)', icon: ['M14.6 6.3a1 1 0 0 0 0 1.4l1.7 1.7a1 1 0 0 0 1.4 0l3.3-3.3a6 6 0 0 1-7.9 7.9l-6.3 6.3a2.1 2.1 0 0 1-3-3l6.3-6.3a6 6 0 0 1 7.9-7.9z'] },
];
const DEPT_MAP: Record<DeptSlug, DeptDef> = Object.fromEntries(DEPTS.map((d) => [d.id, d])) as Record<DeptSlug, DeptDef>;

const CR_TYPES: Record<DeptSlug, string[]> = {
  cs: ['C-1 | Card Activation', 'C-2 | Application Update', 'C-3 | Card Deactivation', 'C-4 | Increase limits', 'C-5 | Decrease limits', 'C-6 | Card Replacement', 'C-7 | Account Reactivation', 'C-8 | Balance', 'C-10 | Fraud Hold / Release', 'C-11 | Mobile app log-in', 'C-12 | EFS log-in', 'C-14 | Close the account on WEX', 'C-15 | Transaction reports', 'C-16 | Override the card', 'C-17 | Money Code', 'C-18 | Checking payments', 'C-19 | Wex task response', 'C-20 | Invoice sending', 'C-22 | Tracking number request', 'C-24 | Card last used check', 'C-26 | Unit#/DrID change', 'C-27 | Boca Sent', 'C-28 | Account Status Check', 'C-30 | Other requests'],
  billing: ['Q-1 | Invoice Request', 'Q-2 | Payment Verification', 'Q-3 | Payment Date Change / Deferral', 'Q-4 | Activate Account Without Payment', 'Q-5 | Change Payment Information', 'Q-6 | Client Communication (Fees & Invoices)', 'Q-7 | Invoice Check / Debt Amount', 'Q-8 | Prepaid Balance Check', 'Q-9 | Billing Form Verification', 'Q-10 | Referrals'],
  verification: ['V-1 | Plaid link request', 'V-2 | Plaid check for LOC review', 'V-3 | Extra card request', 'V-4 | Weekly limit review', 'V-5 | Card limit review', 'V-6 | Plaid check for billing cycle', 'V-7 | Verification process update', 'V-9 | Billing Convert', 'V-10 | Plaid Link Send', 'V-11 | Plaid Check'],
  maintenance: ['M-1 | Tire change', 'M-2 | Oil change', 'M-3 | Road Side assistance', 'M-4 | Mechanical', 'M-5 | Truck Wash'],
};

const ESCALATION_REASONS = ['Problem with the client', 'Question', 'Personal Request', 'CITI Fuel Duplicate', 'CRM Question', 'Lead Transfer', 'Deal Transfer', 'Mobile App Issue', 'RingCentral Number Issue', 'Additional Discounts', 'Other'];

const MAX_BYTES = 20 * 1024 * 1024;
const LABEL = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em';
const FIELD = 'width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13.5px';

// ---------- shared attachment drop-zone ----------

function AttachZone({ id, file, onFile }: { id: string; file: File | null; onFile: (f: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  const { pushToast } = useSales();
  const take = (f: File | undefined): void => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      pushToast('File too large', 'Attachments must be 20MB or smaller.');
      return;
    }
    onFile(f);
  };
  if (file) {
    return (
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:12px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3)')}>
        <div style={s('display:flex;align-items:center;gap:9px;min-width:0')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
          <span style={s('font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{file.name}</span>
        </div>
        <button onClick={() => onFile(null)} style={s('flex-shrink:0;border:none;background:transparent;color:var(--danger);font-size:11.5px;font-weight:700;cursor:pointer')}>Remove</button>
      </div>
    );
  }
  return (
    <>
      <label
        htmlFor={id}
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
        style={s(`display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;width:100%;padding:22px;border:1.5px dashed ${dragging ? 'var(--accent)' : 'var(--border)'};border-radius:14px;background:${dragging ? 'rgba(var(--accent-rgb),.08)' : 'var(--alt)'};cursor:pointer;transition:border-color .15s,background .15s;text-align:center`)}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M7 16a4 4 0 0 1-.88-7.9A5 5 0 0 1 16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
        <div style={s('font-size:12.5px;color:var(--text2)')}><span style={s('color:var(--accent);font-weight:700')}>Click to upload</span> or drag &amp; drop</div>
        <div style={s('font-size:10.5px;color:var(--faint)')}>PNG, JPG, PDF, DOC, XLS, CSV · max 20MB</div>
      </label>
      <input id={id} type="file" onChange={(e) => take(e.currentTarget.files?.[0])} style={{ display: 'none' }} />
    </>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="ss-ico-btn" style={s('height:46px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:12.5px;font-weight:700')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Back
    </button>
  );
}

// ---------- ticket wizard ----------

interface CrState {
  step: 1 | 2 | 3;
  dept: '' | DeptSlug;
  dealQ: string;
  dealId: string;
  carrierId: string;
  app: string;
  company: string;
  dealName: string;
  contact: string;
  account: string;
  email: string;
  phone: string;
  ticketType: string;
  typeOpen: boolean;
  cardQ: string;
  card: string;
  cardOpen: boolean;
  subject: string;
  body: string;
  submitting: boolean;
}

const CR0: CrState = {
  step: 1, dept: '', dealQ: '', dealId: '', carrierId: '', app: '', company: '', dealName: '',
  contact: '', account: '', email: '', phone: '', ticketType: '', typeOpen: false,
  cardQ: '', card: '', cardOpen: false, subject: '', body: '', submitting: false,
};

export function TicketWizard() {
  const { pushToast, openTicket } = useSales();
  const [cr, setCr] = useState<CrState>(CR0);
  const [att, setAtt] = useState<File | null>(null);
  const patch = (p: Partial<CrState>): void => setCr((c) => ({ ...c, ...p }));

  const dealsLoad = useLoad(loadDeals, []);
  const cardsLoad = useLoad(
    () => (cr.dealId && cr.carrierId ? loadClientCards(cr.carrierId) : Promise.resolve<ClientCardVM[]>([])),
    [cr.dealId, cr.carrierId],
  );

  const subhead = cr.step === 1 ? 'Choose the team that should handle this request.' : cr.step === 2 ? 'Pick the deal this ticket relates to.' : 'Add the details, then create the ticket.';

  const pickDept = (id: DeptSlug): void => patch({ dept: id, ticketType: cr.dept === id ? cr.ticketType : '', step: 2 });
  const pickDeal = (d: DealVM): void =>
    patch({ dealId: d.id, carrierId: d.carrierId, app: d.app, company: d.company, dealName: d.name, contact: d.contact === '—' ? '' : d.contact, account: d.company, email: d.email, phone: d.phone === '—' ? '' : d.phone, card: '', cardQ: '', cardOpen: false, step: 3 });
  const back = (): void => patch({ step: (cr.step > 1 ? cr.step - 1 : 1) as CrState['step'], typeOpen: false, cardOpen: false });

  const canSubmit = !!(cr.dept && cr.dealId && cr.ticketType && cr.subject.trim() && cr.body.trim()) && !cr.submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit || cr.dept === '') return;
    patch({ submitting: true });
    try {
      const input: CreateTicketInput = {
        department: cr.dept,
        ticketType: cr.ticketType,
        dealId: cr.dealId,
        subject: cr.subject.trim(),
        description: cr.body.trim(),
        carrierId: cr.carrierId,
        applicationId: cr.app && cr.app !== '—' ? cr.app : undefined,
        cardNumber: cr.card || undefined,
        contactName: cr.contact || undefined,
        accountName: cr.account || undefined,
        email: cr.email || undefined,
        phone: cr.phone || undefined,
      };
      const res = await createDeskTicket(input, att);
      const hadFile = !!att;
      setCr(CR0);
      setAtt(null);
      pushToast(
        'Ticket created',
        hadFile
          ? res.attached
            ? 'Routed to the right team — file attached.'
            : 'Routed to the right team — the file couldn’t be attached.'
          : 'Routed to the right team — opening it now.',
      );
      if (res.ticketId) openTicket(res.ticketId); // jump to Tickets and open the new ticket
    } catch (e) {
      pushToast('Couldn’t create ticket', e instanceof Error ? e.message : 'Please try again.');
      patch({ submitting: false });
    }
  };

  const dept = cr.dept ? DEPT_MAP[cr.dept] : null;
  const dq = cr.dealQ.toLowerCase().trim();
  const deals = (dealsLoad.data ?? []).filter((d) => !dq || `${d.name} ${d.company} ${d.carrier} ${d.phone}`.toLowerCase().includes(dq));
  const types = cr.dept ? CR_TYPES[cr.dept] : [];
  const cq = cr.cardQ.toLowerCase().trim();
  const cards = (cardsLoad.data ?? []).filter((c) => !cq || c.num.toLowerCase().includes(cq));

  const circle = (n: number): string => {
    const done = cr.step > n;
    const curr = cr.step === n;
    return `width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13.5px;flex-shrink:0;${done ? 'background:var(--accent);color:#fff;border:1.5px solid var(--accent)' : curr ? 'background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);border:1.5px solid var(--accent)' : 'background:var(--surface);color:var(--muted);border:1.5px solid var(--border)'}`;
  };
  const stepLabel = (n: number): string => `font-size:12px;font-weight:${cr.step === n || cr.step > n ? '700' : '600'};color:${cr.step === n ? 'var(--text)' : cr.step > n ? 'var(--text2)' : 'var(--muted)'};white-space:nowrap`;

  return (
    <>
      <div style={s('margin-bottom:20px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Create a Ticket</div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:3px')}>{subhead}</div>
      </div>

      {/* stepper */}
      <div style={s('display:flex;align-items:center;gap:10px;margin-bottom:26px')}>
        {([[1, 'Department'], [2, 'Deal'], [3, 'Details']] as const).map(([n, label], i) => (
          <div key={n} style={s('display:flex;align-items:center;gap:10px;flex:1')}>
            <div onClick={() => cr.step > n && patch({ step: n as CrState['step'], typeOpen: false, cardOpen: false })} style={s(`display:flex;align-items:center;gap:9px;cursor:${cr.step > n ? 'pointer' : 'default'}`)}>
              <div style={s(circle(n))}>{cr.step > n ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg> : n}</div>
              <span style={s(stepLabel(n))}>{label}</span>
            </div>
            {i < 2 && <div style={s(`flex:1;height:2px;border-radius:2px;min-width:14px;background:${cr.step > n ? 'var(--accent)' : 'var(--border)'};transition:background .25s`)} />}
          </div>
        ))}
      </div>

      {/* STEP 1 — department */}
      {cr.step === 1 && (
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
          {DEPTS.map((d) => {
            const on = cr.dept === d.id;
            return (
              <button key={d.id} onClick={() => pickDept(d.id)} style={s(`display:flex;align-items:center;gap:14px;padding:15px 16px;border-radius:15px;border:1.5px solid ${on ? d.color : 'var(--border)'};background:${on ? `color-mix(in srgb, ${d.color} 9%, var(--surface))` : 'var(--surface)'};box-shadow:var(--shadow-sm);cursor:pointer;width:100%;text-align:left;transition:border-color .16s`)}>
                <div style={s(`width:46px;height:46px;flex-shrink:0;border-radius:13px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${d.color} 15%, transparent);color:${d.color}`)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">{d.icon.map((p) => <path key={p} d={p} />)}</svg>
                </div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-weight:700;font-size:13.5px;color:var(--text)')}>{d.name}</div>
                  <div style={s('font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35')}>{d.desc}</div>
                </div>
                <div style={s(`width:24px;height:24px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${d.color};color:#fff;opacity:${on ? '1' : '0'};transition:opacity .16s`)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg></div>
              </button>
            );
          })}
        </div>
      )}

      {/* STEP 2 — deal */}
      {cr.step === 2 && (
        <div>
          <div style={s('position:relative;margin-bottom:16px')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={cr.dealQ} onChange={(e) => patch({ dealQ: e.currentTarget.value })} placeholder="Search deals by name, company, carrier or phone…" className="ss-in" style={s('width:100%;height:46px;padding:0 16px 0 42px;border-radius:13px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')} />
          </div>
          {dealsLoad.loading ? (
            <div style={s('display:flex;flex-direction:column;gap:9px')}>{[0, 1, 2].map((i) => <div key={i} className="ss-skel" style={s('height:66px;border-radius:14px')} />)}</div>
          ) : dealsLoad.error ? (
            <div style={s('text-align:center;padding:36px 20px;color:var(--danger);font-size:13px')}>{dealsLoad.error}</div>
          ) : deals.length === 0 ? (
            <div style={s('text-align:center;padding:36px 20px;color:var(--muted);font-size:13px')}>{cr.dealQ ? `No deals match “${cr.dealQ}”.` : 'No deals found.'}</div>
          ) : (
            <div className="ss-scroll" style={s('display:flex;flex-direction:column;gap:9px;max-height:372px;overflow-y:auto;padding-right:2px')}>
              {deals.map((d) => {
                const sel = cr.dealId === d.id;
                const initials = (d.company || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <button key={d.id} onClick={() => pickDeal(d)} className="ss-card-h" style={s(`display:flex;align-items:center;gap:13px;padding:12px 14px;border-radius:14px;border:1px solid ${sel ? 'var(--accent)' : 'var(--border)'};background:${sel ? 'rgba(var(--accent-rgb),.08)' : 'var(--surface)'};cursor:pointer;width:100%`)}>
                    <div style={s('width:40px;height:40px;border-radius:11px;background:rgba(var(--accent-rgb),.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0')}>{initials}</div>
                    <div style={s('flex:1;min-width:0;text-align:left')}><div style={s('font-weight:700;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{d.company}</div><div style={s('font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px')}>{d.name}</div></div>
                    <div style={s('display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0')}><span style={s("font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;color:var(--accent);background:rgba(var(--accent-rgb),.1);padding:2px 7px;border-radius:6px")}>{d.carrier}</span><span style={s('font-size:10.5px;color:var(--faint)')}>{d.phone}</span></div>
                  </button>
                );
              })}
            </div>
          )}
          <div style={s('margin-top:18px')}><button onClick={back} className="ss-ico-btn" style={s('height:40px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:12.5px;font-weight:700')}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Back</button></div>
        </div>
      )}

      {/* STEP 3 — details */}
      {cr.step === 3 && dept && (
        <div>
          <div style={s('display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:13px 15px;border-radius:14px;background:var(--surface);border:1px solid var(--border);margin-bottom:16px')}>
            <div style={s('display:flex;align-items:center;gap:8px;min-width:0;flex:1')}><span style={s(`display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:${dept.color};background:color-mix(in srgb, ${dept.color} 14%, transparent);padding:4px 10px;border-radius:8px;white-space:nowrap;flex-shrink:0`)}>{dept.name}</span><span style={s('color:var(--faint)')}>·</span><div style={s('font-size:12.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0')}>{cr.company}</div></div>
            <div style={s('display:flex;gap:7px;flex-shrink:0')}><button onClick={() => patch({ step: 1 })} className="ss-ico-btn" style={s('height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11px;font-weight:700;cursor:pointer')}>Dept</button><button onClick={() => patch({ step: 2 })} className="ss-ico-btn" style={s('height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11px;font-weight:700;cursor:pointer')}>Deal</button></div>
          </div>
          <div style={s('padding:22px;border-radius:18px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:17px')}>
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:14px')}>
              <div><div style={s(LABEL)}>Contact Name</div><input value={cr.contact} onChange={(e) => patch({ contact: e.currentTarget.value })} placeholder="Contact name" className="ss-in" style={s(FIELD)} /></div>
              <div><div style={s(LABEL)}>Account Name</div><input value={cr.account} onChange={(e) => patch({ account: e.currentTarget.value })} placeholder="Account name" className="ss-in" style={s(FIELD)} /></div>
              <div><div style={s(LABEL)}>Email</div><input value={cr.email} onChange={(e) => patch({ email: e.currentTarget.value })} placeholder="name@company.com" className="ss-in" style={s(FIELD)} /></div>
              <div><div style={s(LABEL)}>Phone</div><input value={cr.phone} onChange={(e) => patch({ phone: e.currentTarget.value })} placeholder="10-digit phone" className="ss-in" style={s(FIELD)} /></div>
            </div>
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:14px')}>
              <div><div style={s(LABEL)}>Ticket Type <span style={s('color:var(--accent)')}>*</span></div>
                <div style={s('position:relative')}>
                  <button onClick={() => patch({ typeOpen: !cr.typeOpen, cardOpen: false })} style={s(`display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:${cr.ticketType ? 'var(--text)' : 'var(--muted)'};font-size:13.5px;font-weight:${cr.ticketType ? '600' : '400'};cursor:pointer`)}><span style={s('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{cr.ticketType || 'Select a ticket type'}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--muted)' }}><path d="M6 9l6 6 6-6" /></svg></button>
                  {cr.typeOpen && (
                    <>
                      <div onClick={() => patch({ typeOpen: false })} style={s('position:fixed;inset:0;z-index:8')} />
                      <div className="ss-scroll" style={s('position:absolute;z-index:9;top:calc(100% + 6px);left:0;right:0;max-height:260px;overflow-y:auto;padding:6px;border-radius:12px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)')}>
                        {types.map((t) => {
                          const on = cr.ticketType === t;
                          return <button key={t} onClick={() => patch({ ticketType: t, typeOpen: false })} style={s(`display:block;width:100%;text-align:left;padding:9px 13px;border:none;background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--text2)'};font-size:12.5px;font-weight:${on ? '700' : '500'};cursor:pointer;border-radius:8px`)}>{t}</button>;
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div><div style={s(LABEL)}>Card</div>
                <div style={s('position:relative')}>
                  <input value={cr.cardQ} onChange={(e) => patch({ cardQ: e.currentTarget.value, cardOpen: true })} onFocus={() => patch({ cardOpen: true, typeOpen: false })} placeholder="Search or select a card…" className="ss-in" style={s('width:100%;height:44px;padding:0 40px 0 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13.5px')} />
                  <button onClick={() => patch({ cardOpen: !cr.cardOpen })} style={s('position:absolute;right:5px;top:6px;height:32px;width:32px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;cursor:pointer;color:var(--muted)')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg></button>
                  {cr.cardOpen && (
                    <>
                      <div onClick={() => patch({ cardOpen: false })} style={s('position:fixed;inset:0;z-index:8')} />
                      <div className="ss-scroll" style={s('position:absolute;z-index:9;top:calc(100% + 6px);left:0;right:0;max-height:240px;overflow-y:auto;padding:6px;border-radius:12px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)')}>
                        {cardsLoad.loading && <div style={s('padding:14px;text-align:center;color:var(--muted);font-size:12px')}>Loading cards…</div>}
                        {!cardsLoad.loading && cards.length === 0 && <div style={s('padding:14px;text-align:center;color:var(--muted);font-size:12px')}>No cards found</div>}
                        {cards.map((c, i) => (
                          <button key={`${c.num}-${i}`} onClick={() => patch({ card: c.num, cardQ: c.num, cardOpen: false })} className="ss-menu-i" style={s('display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:9px 13px;border:none;background:transparent;cursor:pointer;border-radius:8px')}><span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:var(--text)")}>{c.num}</span><span style={s('font-size:10.5px;color:var(--muted)')}>{c.status}</span></button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div><div style={s(LABEL)}>Subject <span style={s('color:var(--accent)')}>*</span></div><input value={cr.subject} onChange={(e) => patch({ subject: e.currentTarget.value })} placeholder="Brief summary of the request" className="ss-in" style={s(FIELD)} /></div>
            <div><div style={s(LABEL)}>Description <span style={s('color:var(--accent)')}>*</span></div><textarea value={cr.body} onChange={(e) => patch({ body: e.currentTarget.value })} placeholder="What's needed, which card / driver, and any context…" className="ss-in" style={s('width:100%;min-height:104px;padding:11px 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13.5px;resize:vertical;line-height:1.5')} /></div>
            <div><div style={s(LABEL)}>Attachment <span style={s('font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0')}>· max 20MB</span></div><AttachZone id="cr-att" file={att} onFile={setAtt} /></div>
            <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:2px')}>
              <BackBtn onClick={back} />
              <button onClick={() => void submit()} disabled={!canSubmit} className={canSubmit ? 'ss-btn-p' : undefined} style={s(canSubmit ? 'height:46px;padding:0 28px;border-radius:12px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;box-shadow:0 6px 18px rgba(var(--accent-rgb),.35)' : cr.submitting ? 'height:46px;padding:0 28px;border-radius:12px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:9px;opacity:.85' : 'height:46px;padding:0 28px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13.5px;cursor:not-allowed')}>
                {cr.submitting ? (<><span style={s('width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />Creating…</>) : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- escalation form ----------

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
      if (res.ticketId) openTicket(res.ticketId); // jump to Tickets and open the escalation ticket
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
      <div style={s('padding:22px;border-radius:18px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:17px')}>
        <div><div style={s(LABEL)}>Subject <span style={s('color:var(--accent)')}>*</span></div><input value={subject} onChange={(e) => setSubject(e.currentTarget.value)} placeholder="Brief summary of the escalation" className="ss-in" style={s(FIELD)} /></div>
        <div><div style={s(LABEL)}>Description <span style={s('color:var(--accent)')}>*</span></div><textarea value={body} onChange={(e) => setBody(e.currentTarget.value)} placeholder="Enter escalation details — what's blocked, what you've tried, and what you need." className="ss-in" style={s('width:100%;min-height:120px;padding:11px 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13.5px;resize:vertical;line-height:1.5')} /></div>
        <div><div style={s(LABEL)}>Escalation Reason <span style={s('color:var(--accent)')}>*</span></div>
          <div style={s('position:relative')}>
            <button onClick={() => setReasonOpen((o) => !o)} style={s(`display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:${reason ? 'var(--text)' : 'var(--muted)'};font-size:13.5px;font-weight:${reason ? '600' : '400'};cursor:pointer`)}><span style={s('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{reason || 'Select a reason'}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--muted)' }}><path d="M6 9l6 6 6-6" /></svg></button>
            {reasonOpen && (
              <>
                <div onClick={() => setReasonOpen(false)} style={s('position:fixed;inset:0;z-index:8')} />
                <div className="ss-scroll" style={s('position:absolute;z-index:9;top:calc(100% + 6px);left:0;right:0;max-height:260px;overflow-y:auto;padding:6px;border-radius:12px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)')}>
                  {ESCALATION_REASONS.map((r) => {
                    const on = reason === r;
                    return <button key={r} onClick={() => { setReason(r); setReasonOpen(false); }} style={s(`display:block;width:100%;text-align:left;padding:9px 13px;border:none;background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--text2)'};font-size:12.5px;font-weight:${on ? '700' : '500'};cursor:pointer;border-radius:8px`)}>{r}</button>;
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <div><div style={s(LABEL)}>Attachment <span style={s('font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0')}>· max 20MB</span></div><AttachZone id="esc-att" file={att} onFile={setAtt} /></div>
        <div style={s('display:flex;justify-content:flex-end;padding-top:2px')}>
          <button onClick={() => void submit()} disabled={!canSubmit} className={canSubmit ? 'ss-btn-p' : undefined} style={s(canSubmit ? 'height:46px;padding:0 28px;border-radius:12px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;box-shadow:0 6px 18px rgba(var(--accent-rgb),.35)' : submitting ? 'height:46px;padding:0 28px;border-radius:12px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:9px;opacity:.85' : 'height:46px;padding:0 28px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13.5px;cursor:not-allowed')}>
            {submitting ? (<><span style={s('width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />Creating…</>) : 'Create Escalation Ticket'}
          </button>
        </div>
      </div>
    </>
  );
}
