/**
 * Sales Mytrion redesign — Data Center ("records") tab. Ported from the reference prototype's
 * isRecords slice: five sub-tabs (Clients / Leads / Deals / Rejection Reports / Money Codes) with a
 * per-tab search and a board/list toggle for the pipeline tabs.
 *
 * Live data:
 *   - Clients     → loadRecords()   (servercrm clients.by_agent → RECORDS; the DWH is the only
 *                                     source with balance / cards / gallons, so it stays here)
 *   - Leads       → loadLeads()      (Zoho CRM COQL, Owner-scoped)
 *   - Deals       → loadDeals()      (Zoho CRM COQL, Owner-scoped)
 *   - Rejections  → loadRejections() (Zoho CRM COQL — lost/declined Deals, Owner-scoped)
 *   - Money Codes → no CRM/COQL source (issued via EFS; not a Zoho module) → styled empty state
 */
import { useState } from 'react';
import { s, Svg } from '../dc';
import { badge, type BadgeVM } from '../salesData';
import { useLoad, loadRecords } from '../live';
import { loadLeads, loadDeals, loadRejections } from '../dataCenterLive';
import { useSales } from '../ctx';
import { LeadsView, DealsView, RejectionsView } from '../dataCenterViews';

type DcSub = 'clients' | 'leads' | 'deals' | 'rejections' | 'money';
type RecStatus = 'active' | 'attention' | 'debtor';
type PipeView = 'kanban' | 'list';

interface DcTabDef {
  id: DcSub;
  label: string;
  icon: string;
  /** Rendered disabled with a "Coming soon" tag; not navigable (mirrors NAV's comingSoon). */
  disabled?: boolean;
}

const DC_TABS: DcTabDef[] = [
  { id: 'clients', label: 'Clients', icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4 0M17 8a3 3 0 11-2 0' },
  { id: 'leads', label: 'Leads', icon: 'M16 21v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M12.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0M19 8v6M22 11h-6' },
  { id: 'deals', label: 'Deals', icon: 'M3 12h18M20 7H4a1 1 0 00-1 1v9a2 2 0 002 2h14a2 2 0 002-2V8a1 1 0 00-1-1zM15 7V5a2 2 0 00-2-2h-2a2 2 0 00-2 2v2' },
  // Awaiting a redesign — the current view isn't usable. Drop `disabled` to re-enable; the
  // RejectionsView component + loadRejections() stay wired for when the redesign ships.
  { id: 'rejections', label: 'Rejection Reports', icon: 'M4.93 4.93l14.14 14.14M12 21a9 9 0 100-18 9 9 0 000 18z', disabled: true },
  { id: 'money', label: 'Money Codes', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

const SEARCH_PLACEHOLDER: Record<DcSub, string> = {
  clients: 'Search clients by name, carrier ID or contact…',
  leads: 'Search leads by company, contact or source…',
  deals: 'Search deals by company or deal name…',
  rejections: 'Search rejections by company, app ID or reason…',
  money: 'Search money codes by code or carrier…',
};

const VIEW_BTNS: { v: PipeView; label: string; icon: string }[] = [
  { v: 'kanban', label: 'Board', icon: 'M4 5h5v14H4zM10 5h4v9h-4zM15 5h5v6h-5z' },
  { v: 'list', label: 'List', icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
];

const REC_STATUS: Record<RecStatus, readonly [string, string]> = {
  active: ['Active', 'var(--ok)'],
  attention: ['Needs attention', 'var(--orange)'],
  debtor: ['Debtor', 'var(--danger)'],
};

interface RecordVM {
  id: string;
  name: string;
  carrier: string;
  initials: string;
  avStyle: string;
  statusBadge: BadgeVM;
  balColor: string;
  balance: string;
  active: number;
  cards: number;
  gallons: string;
  onClick: () => void;
}

/** Centered spinner (loading) / red line (error) / muted line (empty) in the ss-* look. */
function Gate({ loading, error, empty, emptyMsg, children }: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div style={s('display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:60px 20px')}>
        <span style={s('width:34px;height:34px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:ss-spin .8s linear infinite')} />
        <span style={s('font-size:12.5px;color:var(--muted)')}>Loading…</span>
      </div>
    );
  }
  if (error) return <div style={s('padding:44px 20px;text-align:center;color:var(--danger);font-size:13px')}>{error}</div>;
  if (empty) return <div style={s('padding:44px 20px;text-align:center;color:var(--muted);font-size:13px')}>{emptyMsg}</div>;
  return <>{children}</>;
}

export function RecordsTab() {
  const { openClient } = useSales();
  const [dcSub, setDcSub] = useState<DcSub>('clients');
  const [search, setSearch] = useState<Record<DcSub, string>>({ clients: '', leads: '', deals: '', rejections: '', money: '' });
  const [leadView, setLeadView] = useState<PipeView>('kanban');
  const [dealView, setDealView] = useState<PipeView>('kanban');

  // Clients load eagerly (default tab); the CRM tabs load lazily when first opened.
  const recsLoad = useLoad(loadRecords, []);
  const leadsLoad = useLoad(() => (dcSub === 'leads' ? loadLeads() : Promise.resolve(null)), [dcSub === 'leads']);
  const dealsLoad = useLoad(() => (dcSub === 'deals' ? loadDeals() : Promise.resolve(null)), [dcSub === 'deals']);
  const rejLoad = useLoad(() => (dcSub === 'rejections' ? loadRejections() : Promise.resolve(null)), [dcSub === 'rejections']);

  const q = search[dcSub].toLowerCase();
  const showView = dcSub === 'leads' || dcSub === 'deals';
  const view = dcSub === 'deals' ? dealView : leadView;
  const setView = (v: PipeView): void => (dcSub === 'deals' ? setDealView(v) : setLeadView(v));
  const setSearchVal = (v: string): void => setSearch((prev) => ({ ...prev, [dcSub]: v }));

  // Clients → RecordVM
  const clients: RecordVM[] = (recsLoad.data ?? [])
    .filter((c) => !q || `${c.name} ${c.carrier} ${c.contact}`.toLowerCase().includes(q))
    .map((c) => {
      const [lbl, col] = REC_STATUS[c.status];
      const debt = c.balance.startsWith('-');
      return {
        id: c.id,
        name: c.name,
        carrier: c.carrier,
        initials: c.name.split(' ').map((w) => w.charAt(0)).slice(0, 2).join(''),
        avStyle: `width:40px;height:40px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`,
        statusBadge: badge(lbl, col),
        balColor: debt ? 'var(--danger)' : 'var(--muted)',
        balance: c.balance,
        active: c.active,
        cards: c.cards,
        gallons: c.gallons,
        onClick: () => openClient({ id: c.id, name: c.name, carrier: c.carrier, contact: c.contact, phone: c.phone, cards: c.cards, active: c.active, gallons: c.gallons, balance: c.balance, status: c.status, mc: c.mc, dot: c.dot }),
      };
    });

  return (
    <div className="ss-fu">
      <div style={s('margin-bottom:14px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Data Center</div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>Everything about your pipeline — clients, leads, deals, rejections &amp; money codes.</div>
      </div>

      {/* sub-tabs */}
      <div style={s('display:flex;gap:6px;margin-bottom:16px;padding:4px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);width:fit-content;max-width:100%;overflow-x:auto')}>
        {DC_TABS.map((t) => {
          const on = dcSub === t.id;
          const soon = t.disabled === true;
          return (
            <button
              key={t.id}
              onClick={soon ? undefined : () => setDcSub(t.id)}
              disabled={soon}
              title={soon ? `${t.label} — coming soon` : undefined}
              style={s(`display:flex;align-items:center;gap:8px;padding:9px 15px;border-radius:var(--radius-md);border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:${soon ? 'default' : 'pointer'};opacity:${soon ? '.5' : '1'};white-space:nowrap;transition:all .14s`)}
            >
              <Svg d={t.icon} size={16} style={{ flexShrink: 0 }} />
              {t.label}
              {soon && (
                <span style={s('font-size:8.5px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)')}>SOON</span>
              )}
            </button>
          );
        })}
      </div>

      {/* toolbar: search + view toggle */}
      <div style={s('display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;align-items:center')}>
        <div style={s('position:relative;flex:1;min-width:240px')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input value={search[dcSub]} onChange={(e) => setSearchVal(e.currentTarget.value)} placeholder={SEARCH_PLACEHOLDER[dcSub]} className="ss-in" style={s('width:100%;height:44px;padding:0 16px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')} />
        </div>
        {showView && (
          <div style={s('display:flex;gap:4px;padding:4px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
            {VIEW_BTNS.map((b) => {
              const on = view === b.v;
              return (
                <button key={b.v} onClick={() => setView(b.v)} style={s(`display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:var(--radius-md);border:none;background:${on ? 'rgba(var(--accent-rgb),.14)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12px;font-weight:700;cursor:pointer;transition:all .14s`)}>
                  <Svg d={b.icon} size={15} />
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* content */}
      {dcSub === 'clients' && (
        <Gate loading={recsLoad.loading} error={recsLoad.error} empty={clients.length === 0} emptyMsg="No clients match your search.">
          <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
            {clients.map((c) => (
              <div key={c.id} onClick={c.onClick} className="ss-card-h" style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
                <div style={s('display:flex;align-items:center;gap:12px')}>
                  <div style={s(c.avStyle)}>{c.initials}</div>
                  <div style={s('min-width:0;flex:1')}>
                    <div style={s('font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
                    <div style={s("font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{c.carrier}</div>
                  </div>
                </div>
                <div style={s('margin-top:14px;display:flex;align-items:center;justify-content:space-between')}>
                  <span style={s(c.statusBadge.style)}>{c.statusBadge.text}</span>
                  <span style={s(`font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:${c.balColor}`)}>{c.balance}</span>
                </div>
                <div style={s('display:flex;gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border2)')}>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600")}>{c.active}<span style={s('color:var(--muted);font-size:12px')}>/{c.cards}</span></div>
                    <div style={s('font-size:10.5px;color:var(--muted)')}>Active cards</div>
                  </div>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:var(--violet)")}>{c.gallons}</div>
                    <div style={s('font-size:10.5px;color:var(--muted)')}>Gallons (cycle)</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Gate>
      )}

      {dcSub === 'leads' && (
        <Gate loading={leadsLoad.loading} error={leadsLoad.error} empty={(leadsLoad.data?.length ?? 0) === 0} emptyMsg="No leads yet.">
          <LeadsView leads={leadsLoad.data ?? []} search={search.leads} view={leadView} />
        </Gate>
      )}

      {dcSub === 'deals' && (
        <Gate loading={dealsLoad.loading} error={dealsLoad.error} empty={(dealsLoad.data?.length ?? 0) === 0} emptyMsg="No deals yet.">
          <DealsView deals={dealsLoad.data ?? []} search={search.deals} view={dealView} />
        </Gate>
      )}

      {dcSub === 'rejections' && (
        <Gate loading={rejLoad.loading} error={rejLoad.error} empty={(rejLoad.data?.length ?? 0) === 0} emptyMsg="No rejected applications — nice work.">
          <RejectionsView rejections={rejLoad.data ?? []} search={search.rejections} />
        </Gate>
      )}

      {dcSub === 'money' && (
        <div style={s('padding:20px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:13px;font-weight:700;margin-bottom:14px')}>Money Codes Issued</div>
          <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden')}>
            <div style={s("display:grid;grid-template-columns:1.3fr 1.4fr 0.8fr 1fr auto;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)")}>
              <span>Code</span><span>Carrier</span><span style={s('text-align:right')}>Amount</span><span>Issued</span><span>Status</span>
            </div>
            <div style={s('padding:36px 20px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.6')}>
              Money codes are issued through EFS, not Zoho CRM — there's nothing to show here yet.<br />
              Issue one from a client's <strong style={s('color:var(--text2)')}>Automations</strong>, and it'll appear on the account.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
