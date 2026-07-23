/**
 * Create-tab ticket wizard (Department → Deal → Details). POSTs a Desk support ticket via
 * createDeskTicket with an optional attachment. Escalate / Lead live in createTicketOtherForms.
 */
import { useState } from 'react';
import { s } from './dc';
import { Icon, type IconName } from './icons';
import { ICO } from './salesData';
import { useSales } from './ctx';
import { useSessionUser } from './sessionUser';
import { useLoad, loadClientCards, type ClientCardVM } from './live';
import { loadDeals, type DealVM } from './dataCenterLive';
import { AUTO_LIST, type Automation } from './autoLive';
import { createDeskTicket, type CreateTicketInput } from '@/api/desk';
import { invalidateDcCache } from './dcCache';
import { invalidateDeduped } from './fetchDedupe';
import {
  AttachZone,
  BackBtn,
  BTN_DISABLED,
  BTN_PRIMARY,
  BTN_PRIMARY_BUSY,
  DROP_PANEL,
  FIELD,
  LABEL,
  SELECT_BTN,
} from './createTicketShared';

export { EscalationForm, CreateLeadForm } from './createTicketOtherForms';

type DeptSlug = 'cs' | 'billing' | 'verification' | 'maintenance';

interface DeptDef {
  id: DeptSlug;
  name: string;
  desc: string;
  color: string;
  icon: IconName;
}

const DEPTS: DeptDef[] = [
  { id: 'cs', name: 'Customer Service', desc: 'Cards, activations, limits, money codes', color: 'var(--accent)', icon: 'cs' },
  { id: 'billing', name: 'Billing & Accounting', desc: 'Invoices, payments, billing forms', color: 'var(--violet)', icon: 'billing' },
  { id: 'verification', name: 'Verification', desc: 'Plaid links, limit & billing review', color: 'var(--ok)', icon: 'verification' },
  { id: 'maintenance', name: 'Maintenance', desc: 'Tire, oil, mechanical, roadside', color: 'var(--orange)', icon: 'maintenance' },
];
const DEPT_MAP: Record<DeptSlug, DeptDef> = Object.fromEntries(DEPTS.map((d) => [d.id, d])) as Record<DeptSlug, DeptDef>;

const CR_TYPES: Record<DeptSlug, string[]> = {
  cs: ['C-1 | Card Activation', 'C-2 | Application Update', 'C-3 | Card Deactivation', 'C-4 | Increase limits', 'C-5 | Decrease limits', 'C-6 | Card Replacement', 'C-7 | Account Reactivation', 'C-8 | Balance', 'C-10 | Fraud Hold / Release', 'C-11 | Mobile app log-in', 'C-12 | EFS log-in', 'C-14 | Close the account on WEX', 'C-15 | Transaction reports', 'C-16 | Override the card', 'C-17 | Money Code', 'C-18 | Checking payments', 'C-19 | Wex task response', 'C-20 | Invoice sending', 'C-22 | Tracking number request', 'C-24 | Card last used check', 'C-26 | Unit#/DrID change', 'C-27 | Boca Sent', 'C-28 | Account Status Check', 'C-30 | Other requests'],
  billing: ['Q-1 | Invoice Request', 'Q-2 | Payment Verification', 'Q-3 | Payment Date Change / Deferral', 'Q-4 | Activate Account Without Payment', 'Q-5 | Change Payment Information', 'Q-6 | Client Communication (Fees & Invoices)', 'Q-7 | Invoice Check / Debt Amount', 'Q-8 | Prepaid Balance Check', 'Q-9 | Billing Form Verification', 'Q-10 | Referrals'],
  verification: ['V-1 | Plaid link request', 'V-2 | Plaid check for LOC review', 'V-3 | Extra card request', 'V-4 | Weekly limit review', 'V-5 | Card limit review', 'V-6 | Plaid check for billing cycle', 'V-7 | Verification process update', 'V-9 | Billing Convert', 'V-10 | Plaid Link Send', 'V-11 | Plaid Check'],
  maintenance: ['M-1 | Tire change', 'M-2 | Oil change', 'M-3 | Road Side assistance', 'M-4 | Mechanical', 'M-5 | Truck Wash'],
};

/**
 * Ticket type → Mytrion automation lookup. Returns the matching active automation for a
 * ticket-type code (e.g. "C-7"), or null when the type isn't automatable.
 */
function getAutomatedTicketBlock(ticketTypeLabel: string): Automation | null {
  const code = (ticketTypeLabel || '').split('|')[0]?.trim() ?? '';
  if (!code) return null;
  return AUTO_LIST.find((b) => b.soon !== true && b.codes.includes(code)) ?? null;
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
  /** The matched automation when the picked ticket type is self-serviceable (opens the prompt). */
  autoPrompt: Automation | null;
}

const CR0: CrState = {
  step: 1, dept: '', dealQ: '', dealId: '', carrierId: '', app: '', company: '', dealName: '',
  contact: '', account: '', email: '', phone: '', ticketType: '', typeOpen: false,
  cardQ: '', card: '', cardOpen: false, subject: '', body: '', submitting: false, autoPrompt: null,
};

/** Pretty-print a 10-digit US phone; otherwise return the raw value. */
function displayPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

/**
 * ID chip for a deal row — Zoho `Carrier_ID` when present, else `Application_ID` (pre-conversion
 * deals often have an app id before a carrier exists). Never show a bare "—" that reads as a minus.
 */
function dealIdChip(d: DealVM): { text: string; tone: 'carrier' | 'app' | 'none' } {
  const carrier = d.carrierId.trim();
  if (carrier) return { text: `CR-${carrier}`, tone: 'carrier' };
  const app = d.app.trim();
  if (app && app !== '—') return { text: `App ${app}`, tone: 'app' };
  return { text: 'No ID', tone: 'none' };
}

export function TicketWizard() {
  const { pushToast, openTicket, openAutomation } = useSales();
  const { name: submitterName } = useSessionUser();
  const [cr, setCr] = useState<CrState>(CR0);
  const [att, setAtt] = useState<File | null>(null);
  const patch = (p: Partial<CrState>): void => setCr((c) => ({ ...c, ...p }));

  // Selecting a ticket type: if the type is already covered by an available automation, steer the
  // agent to the instant action (self-service) instead of letting them file a ticket for it.
  const pickType = (t: string): void => {
    const block = getAutomatedTicketBlock(t);
    // Automatable → clear any prior type and open the prompt (reference onTicketTypeChange wipes it).
    if (block) { patch({ ticketType: '', typeOpen: false, autoPrompt: block }); return; }
    patch({ ticketType: t, typeOpen: false });
  };

  // Load deals when the agent reaches step 2 so the skeleton is visible (not finished on step 1).
  const needDeals = cr.step >= 2;
  const dealsLoad = useLoad(
    () => (needDeals ? loadDeals() : Promise.resolve<DealVM[]>([])),
    [needDeals],
  );
  const cardsLoad = useLoad(
    () => (cr.dealId && cr.carrierId ? loadClientCards(cr.carrierId) : Promise.resolve<ClientCardVM[]>([])),
    [cr.dealId, cr.carrierId],
  );

  const subhead = cr.step === 1 ? 'Choose the team that should handle this request.' : cr.step === 2 ? 'Pick the deal this ticket relates to.' : 'Add the details, then create the ticket.';

  const pickDept = (id: DeptSlug): void => patch({ dept: id, ticketType: cr.dept === id ? cr.ticketType : '', step: 2 });
  const pickDeal = (d: DealVM): void =>
    patch({
      dealId: d.id,
      carrierId: d.carrierId.trim(),
      app: d.app.trim() && d.app !== '—' ? d.app.trim() : '',
      company: d.company,
      dealName: d.name,
      contact: d.contact === '—' ? '' : d.contact,
      account: d.company,
      email: d.email,
      phone: d.phone === '—' ? '' : d.phone,
      card: '',
      cardQ: '',
      cardOpen: false,
      step: 3,
    });
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
        submitterName,
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
      invalidateDcCache('sales:tickets');
      invalidateDeduped('desk:tickets:');
      if (res.ticketId) openTicket(res.ticketId); // jump to Tickets and open the new ticket
    } catch (e) {
      pushToast('Couldn’t create ticket', e instanceof Error ? e.message : 'Please try again.');
      patch({ submitting: false });
    }
  };

  const dept = cr.dept ? DEPT_MAP[cr.dept] : null;
  const dq = cr.dealQ.toLowerCase().trim();
  const allDeals = dealsLoad.data ?? [];
  // Default view = the 5 most recent deals by application date (newest first). Searching widens to
  // the full owner-scoped set (name / company / Carrier_ID / Application_ID / phone).
  const deals = dq
    ? allDeals.filter((d) =>
        `${d.name} ${d.company} ${d.carrierId} ${d.carrier} ${d.app} ${d.phone}`
          .toLowerCase()
          .includes(dq),
      )
    : [...allDeals].sort((a, b) => b.appTs - a.appTs).slice(0, 5);
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
        <div style={s('font-size:13px;color:var(--muted);margin-top:3px')}>{subhead}</div>
      </div>

      {/* stepper */}
      <div style={s('display:flex;align-items:center;gap:10px;margin-bottom:26px')}>
        {([[1, 'Department'], [2, 'Deal'], [3, 'Details']] as const).map(([n, label], i) => (
          <div key={n} style={s('display:flex;align-items:center;gap:10px;flex:1')}>
            <div onClick={() => cr.step > n && patch({ step: n as CrState['step'], typeOpen: false, cardOpen: false })} style={s(`display:flex;align-items:center;gap:9px;cursor:${cr.step > n ? 'pointer' : 'default'}`)}>
              <div style={s(circle(n))}>{cr.step > n ? <Icon name="check" size={15} strokeWidth={3} /> : n}</div>
              <span style={s(stepLabel(n))}>{label}</span>
            </div>
            {i < 2 && <div style={s(`flex:1;height:2px;border-radius:var(--radius-md);min-width:14px;background:${cr.step > n ? 'var(--accent)' : 'var(--border)'};transition:background .25s`)} />}
          </div>
        ))}
      </div>

      {/* STEP 1 — department */}
      {cr.step === 1 && (
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
          {DEPTS.map((d) => {
            const on = cr.dept === d.id;
            return (
              <button key={d.id} onClick={() => pickDept(d.id)} style={s(`display:flex;align-items:center;gap:14px;padding:15px 16px;border-radius:var(--radius-md);border:1.5px solid ${on ? d.color : 'var(--border)'};background:${on ? `color-mix(in srgb, ${d.color} 9%, var(--surface))` : 'var(--surface)'};box-shadow:var(--shadow-sm);cursor:pointer;width:100%;text-align:left;transition:border-color .16s`)}>
                <div style={s(`width:46px;height:46px;flex-shrink:0;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${d.color} 15%, transparent);color:${d.color}`)}>
                  <Icon name={d.icon} size={22} strokeWidth={1.9} />
                </div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-weight:700;font-size:13.5px;color:var(--text)')}>{d.name}</div>
                  <div style={s('font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35')}>{d.desc}</div>
                </div>
                <div style={s(`width:24px;height:24px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${d.color};color:#fff;opacity:${on ? '1' : '0'};transition:opacity .16s`)}><Icon name="check" size={14} strokeWidth={3.2} /></div>
              </button>
            );
          })}
        </div>
      )}

      {/* STEP 2 — deal */}
      {cr.step === 2 && (
        <div>
          <div style={s('position:relative;margin-bottom:16px')}>
            <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
            <input
              value={cr.dealQ}
              onChange={(e) => patch({ dealQ: e.currentTarget.value })}
              placeholder="Search by name, company, carrier ID, application ID, or phone…"
              disabled={dealsLoad.loading}
              className="ss-in"
              style={s('width:100%;height:46px;padding:0 16px 0 42px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')}
            />
          </div>
          {!dq && !dealsLoad.loading && !dealsLoad.error && deals.length > 0 && (
            <div style={s('font-size:12px;color:var(--muted);margin:-6px 2px 12px')}>
              {allDeals.length > deals.length
                ? `Showing your ${deals.length} most recent deals by application date — search to find any other.`
                : `Showing all your ${deals.length} ${deals.length === 1 ? 'deal' : 'deals'} by application date.`}
            </div>
          )}
          {dealsLoad.loading ? (
            <div role="status" aria-busy="true" aria-label="Loading deals" style={s('display:flex;flex-direction:column;gap:10px')}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={s('display:flex;align-items:center;gap:13px;padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
                  <div className="ss-skel" style={s('width:40px;height:40px;border-radius:var(--radius-md);flex:none')} />
                  <div style={s('flex:1;min-width:0')}>
                    <div className="ss-skel" style={s('width:42%;height:13px;border-radius:4px')} />
                    <div className="ss-skel" style={s('width:58%;height:11px;border-radius:4px;margin-top:8px')} />
                  </div>
                  <div style={s('display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none')}>
                    <div className="ss-skel" style={s('width:72px;height:18px;border-radius:6px')} />
                    <div className="ss-skel" style={s('width:96px;height:14px;border-radius:4px')} />
                  </div>
                </div>
              ))}
            </div>
          ) : dealsLoad.error ? (
            <div style={s('text-align:center;padding:36px 20px')}>
              <div style={s('color:var(--danger);font-size:13px;font-weight:600')}>{dealsLoad.error}</div>
              <button
                type="button"
                onClick={() => dealsLoad.reload()}
                className="ss-ico-btn"
                style={s('margin-top:14px;height:36px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;font-weight:700;cursor:pointer')}
              >
                Retry
              </button>
            </div>
          ) : deals.length === 0 ? (
            <div style={s('text-align:center;padding:36px 20px;color:var(--muted);font-size:13px')}>
              {dq ? `No deals match “${cr.dealQ.trim()}”.` : 'No deals found for your account.'}
            </div>
          ) : (
            <div className="ss-scroll" style={s('display:flex;flex-direction:column;gap:9px;max-height:420px;overflow-y:auto;padding-right:2px')}>
              {deals.map((d) => {
                const sel = cr.dealId === d.id;
                const initials = (d.company || d.name || '?')
                  .split(/\s+/)
                  .map((w) => w[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '?';
                const chip = dealIdChip(d);
                const chipCss =
                  chip.tone === 'carrier'
                    ? "font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--accent);background:rgba(var(--accent-rgb),.12);padding:3px 8px;border-radius:var(--radius-md);border:1px solid rgba(var(--accent-rgb),.28)"
                    : chip.tone === 'app'
                      ? "font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--violet);background:color-mix(in srgb,var(--violet) 14%,transparent);padding:3px 8px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--violet) 30%,transparent)"
                      : "font-size:11px;font-weight:600;color:var(--muted);background:var(--alt);padding:3px 8px;border-radius:var(--radius-md);border:1px solid var(--border)";
                const hasPhone = Boolean(d.phone && d.phone !== '—');
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => pickDeal(d)}
                    className="ss-card-h"
                    style={s(`display:flex;align-items:center;gap:13px;padding:13px 14px;border-radius:var(--radius-md);border:1px solid ${sel ? 'var(--accent)' : 'var(--border)'};background:${sel ? 'rgba(var(--accent-rgb),.08)' : 'var(--surface)'};cursor:pointer;width:100%`)}
                  >
                    <div style={s('width:40px;height:40px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0')}>
                      {initials}
                    </div>
                    <div style={s('flex:1;min-width:0;text-align:left')}>
                      <div style={s('font-weight:700;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                        {d.company || d.name}
                      </div>
                      <div style={s('font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px')}>
                        {d.name !== d.company ? d.name : d.stage}
                      </div>
                    </div>
                    <div style={s('display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex-shrink:0')}>
                      <span style={s(chipCss)}>{chip.text}</span>
                      {hasPhone ? (
                        <span style={s("display:inline-flex;align-items:center;gap:5px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.02em;color:var(--text);background:var(--alt);padding:3px 8px;border-radius:var(--radius-md);border:1px solid var(--border)")}>
                          <Icon name="calls" size={12} strokeWidth={2.2} />
                          {displayPhone(d.phone)}
                        </span>
                      ) : (
                        <span style={s('font-size:11px;font-weight:600;color:var(--faint)')}>No phone</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div style={s('margin-top:18px')}>
            <button type="button" onClick={back} className="ss-ico-btn" style={s('height:40px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:13px;font-weight:700')}>
              <Icon name="chevronLeft" size={15} strokeWidth={2.2} />
              Back
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — details */}
      {cr.step === 3 && dept && (
        <div>
          <div style={s('display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:13px 15px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);margin-bottom:16px')}>
            <div style={s('display:flex;align-items:center;gap:8px;min-width:0;flex:1;flex-wrap:wrap')}>
              <span style={s(`display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:${dept.color};background:color-mix(in srgb, ${dept.color} 14%, transparent);padding:4px 10px;border-radius:var(--radius-md);white-space:nowrap;flex-shrink:0`)}>{dept.name}</span>
              <span style={s('color:var(--faint)')}>·</span>
              <div style={s('font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0')}>{cr.company}</div>
              {cr.carrierId ? (
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--accent);background:rgba(var(--accent-rgb),.12);padding:3px 8px;border-radius:var(--radius-md)")}>CR-{cr.carrierId}</span>
              ) : cr.app ? (
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--violet);background:color-mix(in srgb,var(--violet) 14%,transparent);padding:3px 8px;border-radius:var(--radius-md)")}>App {cr.app}</span>
              ) : null}
              {cr.phone ? (
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:var(--text);background:var(--alt);padding:3px 8px;border-radius:var(--radius-md);border:1px solid var(--border)")}>{displayPhone(cr.phone)}</span>
              ) : null}
            </div>
            <div style={s('display:flex;gap:7px;flex-shrink:0')}><button onClick={() => patch({ step: 1 })} className="ss-ico-btn" style={s('height:30px;padding:0 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11px;font-weight:700;cursor:pointer')}>Dept</button><button onClick={() => patch({ step: 2 })} className="ss-ico-btn" style={s('height:30px;padding:0 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11px;font-weight:700;cursor:pointer')}>Deal</button></div>
          </div>
          <div style={s('padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:17px')}>
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:14px')}>
              <div><div style={s(LABEL)}>Contact Name</div><input value={cr.contact} onChange={(e) => patch({ contact: e.currentTarget.value })} placeholder="Contact name" className="ss-in" style={s(FIELD)} /></div>
              <div><div style={s(LABEL)}>Account Name</div><input value={cr.account} onChange={(e) => patch({ account: e.currentTarget.value })} placeholder="Account name" className="ss-in" style={s(FIELD)} /></div>
              <div><div style={s(LABEL)}>Email</div><input value={cr.email} onChange={(e) => patch({ email: e.currentTarget.value })} placeholder="name@company.com" className="ss-in" style={s(FIELD)} /></div>
              <div><div style={s(LABEL)}>Phone</div><input value={cr.phone} onChange={(e) => patch({ phone: e.currentTarget.value })} placeholder="10-digit phone" className="ss-in" style={s(FIELD)} /></div>
            </div>
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:14px')}>
              <div><div style={s(LABEL)}>Ticket Type <span style={s('color:var(--accent)')}>*</span></div>
                <div style={s('position:relative')}>
                  <button
                    type="button"
                    onClick={() => patch({ typeOpen: !cr.typeOpen, cardOpen: false })}
                    style={s(`${SELECT_BTN};color:${cr.ticketType ? 'var(--text)' : 'var(--muted)'};font-weight:${cr.ticketType ? '600' : '400'}`)}
                  >
                    <span style={s('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{cr.ticketType || 'Select a ticket type'}</span>
                    <Icon name="chevronDown" size={16} color="var(--muted)" style={{ flexShrink: 0 }} />
                  </button>
                  {cr.typeOpen && (
                    <>
                      <div onClick={() => patch({ typeOpen: false })} style={s('position:fixed;inset:0;z-index:8')} />
                      <div className="ss-scroll" role="listbox" style={s(DROP_PANEL)}>
                        {types.map((t) => {
                          const on = cr.ticketType === t;
                          const automatable = getAutomatedTicketBlock(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              role="option"
                              aria-selected={on}
                              onClick={() => pickType(t)}
                              className={`ss-menu-i${on ? ' is-on' : ''}${automatable ? ' is-auto' : ''}`}
                            >
                              <span>{t}</span>
                              {automatable ? <span className="ss-auto-tag">Instant</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div><div style={s(LABEL)}>Card</div>
                <div style={s('position:relative')}>
                  <input value={cr.cardQ} onChange={(e) => patch({ cardQ: e.currentTarget.value, cardOpen: true })} onFocus={() => patch({ cardOpen: true, typeOpen: false })} placeholder="Search or select a card…" className="ss-in" style={s('width:100%;height:44px;padding:0 40px 0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px')} />
                  <button type="button" onClick={() => patch({ cardOpen: !cr.cardOpen })} style={s('position:absolute;right:5px;top:6px;height:32px;width:32px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;cursor:pointer;color:var(--muted)')}><Icon name="chevronDown" size={16} /></button>
                  {cr.cardOpen && (
                    <>
                      <div onClick={() => patch({ cardOpen: false })} style={s('position:fixed;inset:0;z-index:8')} />
                      <div className="ss-scroll" role="listbox" style={s(`${DROP_PANEL};max-height:240px`)}>
                        {cardsLoad.loading && (
                          <div role="status" style={s('display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;color:var(--muted);font-size:12px;font-weight:600')}>
                            <span style={s('width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,var(--border));border-top-color:var(--accent);animation:ss-spin .75s linear infinite;flex:none')} aria-hidden="true" />
                            Loading cards…
                          </div>
                        )}
                        {!cardsLoad.loading && !cr.carrierId && (
                          <div style={s('padding:14px;text-align:center;color:var(--muted);font-size:12px')}>
                            No carrier ID on this deal — cards load after conversion (App {cr.app || '—'}).
                          </div>
                        )}
                        {!cardsLoad.loading && cr.carrierId && cards.length === 0 && (
                          <div style={s('padding:14px;text-align:center;color:var(--muted);font-size:12px')}>No cards found</div>
                        )}
                        {cards.map((c, i) => {
                          const on = cr.card === c.num;
                          return (
                            <button
                              key={`${c.num}-${i}`}
                              type="button"
                              role="option"
                              aria-selected={on}
                              onClick={() => patch({ card: c.num, cardQ: c.num, cardOpen: false })}
                              className={`ss-menu-i${on ? ' is-on' : ''}`}
                              style={s('display:flex;flex-direction:column;align-items:flex-start;gap:2px')}
                            >
                              <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600")}>{c.num}</span>
                              <span style={s('font-size:11px;color:var(--muted);font-weight:500')}>{c.status}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div><div style={s(LABEL)}>Subject <span style={s('color:var(--accent)')}>*</span></div><input value={cr.subject} onChange={(e) => patch({ subject: e.currentTarget.value })} placeholder="Brief summary of the request" className="ss-in" style={s(FIELD)} /></div>
            <div><div style={s(LABEL)}>Description <span style={s('color:var(--accent)')}>*</span></div><textarea value={cr.body} onChange={(e) => patch({ body: e.currentTarget.value })} placeholder="What's needed, which card / driver, and any context…" className="ss-in" style={s('width:100%;min-height:104px;padding:11px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;resize:vertical;line-height:1.5')} /></div>
            <div><div style={s(LABEL)}>Attachment <span style={s('font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0')}>· max 20MB</span></div><AttachZone id="cr-att" file={att} onFile={setAtt} /></div>
            <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:2px')}>
              <BackBtn onClick={back} />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit && !cr.submitting}
                className={canSubmit || cr.submitting ? 'ss-btn-p' : undefined}
                style={s(cr.submitting ? BTN_PRIMARY_BUSY : canSubmit ? BTN_PRIMARY : BTN_DISABLED)}
              >
                {cr.submitting ? (<><span style={s('width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />Creating…</>) : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "You can do this yourself" — the picked ticket type is already an instant automation */}
      {cr.autoPrompt && (
        <div className="ss-scrim" onClick={() => patch({ autoPrompt: null })}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={s('width:100%;max-width:440px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--orange);box-shadow:var(--shadow);padding:26px;text-align:center;animation:ss-pop .22s cubic-bezier(.2,0,0,1) both')}
          >
            <div style={s('width:52px;height:52px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--orange) 16%,var(--surface));color:var(--orange);border:1px solid color-mix(in srgb,var(--orange) 28%,transparent)')}>
              <Icon name={ICO.bolt} size={24} />
            </div>
            <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;letter-spacing:.02em;color:var(--text);margin-bottom:8px')}>You can do this yourself</div>
            <div style={s('font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:6px')}><strong style={s('color:var(--text);font-weight:700')}>{cr.autoPrompt.title}</strong> is available as an instant action in the Automations tab — no need to file a ticket for it.</div>
            {cr.autoPrompt.desc && <div style={s('font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:20px')}>{cr.autoPrompt.desc}</div>}
            <div style={s('display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px')}>
              <button type="button" onClick={() => patch({ autoPrompt: null })} className="ss-ico-btn" style={s('height:42px;padding:0 20px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:13px;cursor:pointer')}>Stay Here</button>
              <button
                type="button"
                onClick={() => {
                  const id = cr.autoPrompt?.id;
                  patch({ autoPrompt: null });
                  if (id) openAutomation(id);
                }}
                className="ss-btn-p"
                style={s('height:42px;padding:0 20px;border-radius:var(--radius-md);border:none;background:var(--accent);color:#fff;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(var(--accent-rgb),.28)')}
              >
                Open {cr.autoPrompt.title.length > 28 ? 'action' : cr.autoPrompt.title} ↗
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
