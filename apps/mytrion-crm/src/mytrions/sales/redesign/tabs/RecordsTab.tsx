/**
 * Sales Mytrion redesign — Data Center ("records") tab. Ported from the reference prototype's
 * isRecords slice: five sub-tabs (Clients / Leads / Deals / Rejection Reports / Money Codes) with a
 * per-tab search and a board/list toggle for the pipeline tabs.
 *
 * Live data:
 *   - Clients     → loadRecords()   (ONE DWH roster query: dim_company + mart_transaction_line_items + cmp_invoice)
 *   - Leads       → loadLeads()      (Zoho CRM COQL, Owner-scoped)
 *   - Deals       → loadDeals()      (Zoho CRM COQL, Owner-scoped)
 *   - Rejections  → loadRejections() (Zoho CRM COQL — lost/declined Deals, Owner-scoped)
 *   - Money Codes → no CRM/COQL source (issued via EFS; not a Zoho module) → styled empty state
 */
import { useMemo, useState } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge, type BadgeVM } from '../salesData';
import {
  resolveTier,
  tierColor,
  tierTextColor,
  tierLabel,
  type TierResult,
  type TierLevel,
} from '../loyalty';
import { loadRecords, numFmt } from '../live';
import { loadLeads, loadDeals, loadRejections, LEAD_STATUS_ORDER, DEAL_STAGE_ORDER } from '../dataCenterLive';
import { useCachedLoad, formatCachedAt, type CachedLoad } from '../dcCache';
import { getImpersonation } from '@/api/impersonation';
import { useSales } from '../ctx';
import { LeadsView, DealsView, RejectionsView } from '../dataCenterViews';

/** Tier level from this-CALENDAR-month gallons (the program basis), falling back to this-cycle
 *  gallons when the client has no current-month pumps yet — so a mid-month/empty month never
 *  collapses an otherwise-active client to "Building". Active-card count still sets the track. */
function tierGallons(c: { gallonsThisMonth: number; cycleGallons: number }): number {
  return c.gallonsThisMonth > 0 ? c.gallonsThisMonth : c.cycleGallons;
}

/** A styled native dropdown (accessible) for the Leads/Deals filters. */
function DcSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
  label: string;
}) {
  return (
    <div style={s('position:relative;display:inline-flex;align-items:center')}>
      <Icon name="filter" size={14} style={s('position:absolute;left:12px;pointer-events:none;color:var(--muted)')} />
      <select
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label={label}
        style={s("height:44px;padding:0 34px 0 34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;font-weight:600;cursor:pointer;box-shadow:var(--shadow-sm);-webkit-appearance:none;-moz-appearance:none;appearance:none;max-width:220px;font-family:inherit")}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      <span style={s('position:absolute;right:13px;pointer-events:none;color:var(--muted);font-size:10px')}>▾</span>
    </div>
  );
}

type DcSub = 'clients' | 'leads' | 'deals' | 'rejections' | 'money';
type RecStatus = 'active' | 'attention' | 'debtor';
type PipeView = 'kanban' | 'list';

interface DcTabDef {
  id: DcSub;
  label: string;
  icon: IconName;
  /** Rendered disabled with a "Coming soon" tag; not navigable (mirrors NAV's comingSoon). */
  disabled?: boolean;
}

const DC_TABS: DcTabDef[] = [
  { id: 'clients', label: 'Clients', icon: 'clients' },
  { id: 'leads', label: 'Leads', icon: 'leads' },
  { id: 'deals', label: 'Deals', icon: 'deals' },
  // Awaiting a redesign — the current view isn't usable. Drop `disabled` to re-enable; the
  // RejectionsView component + loadRejections() stay wired for when the redesign ships.
  { id: 'rejections', label: 'Rejection Reports', icon: 'rejections', disabled: true },
  { id: 'money', label: 'Money Codes', icon: 'moneyCodes' },
];

const SEARCH_PLACEHOLDER: Record<DcSub, string> = {
  clients: 'Search clients by name, carrier ID or contact…',
  leads: 'Search leads by name, company, source, email or phone…',
  deals: 'Search deals by company or deal name…',
  rejections: 'Search rejections by company, app ID or reason…',
  money: 'Search money codes by code or carrier…',
};

const VIEW_BTNS: { v: PipeView; label: string; icon: IconName }[] = [
  { v: 'kanban', label: 'Board', icon: 'board' },
  { v: 'list', label: 'List', icon: 'list' },
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
  active: number;
  cards: number;
  gallons: string;
  gallonsMonth: string;
  tier: TierResult;
  onClick: () => void;
}

const TIER_ORDER: { level: TierLevel; label: string }[] = [
  { level: 'gold', label: 'Gold' },
  { level: 'silver', label: 'Silver' },
  { level: 'bronze', label: 'Bronze' },
  { level: 'none', label: 'Building' },
];

/** Loyalty-tier distribution across the agent's whole client book (a stacked bar + counts). */
function TierDistribution({ counts, total }: { counts: Record<TierLevel, number>; total: number }) {
  return (
    <div style={s('margin-bottom:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);padding:14px 16px;box-shadow:var(--shadow-sm)')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px')}>
        <span style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>Loyalty distribution</span>
        <span style={s("font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{total} client{total === 1 ? '' : 's'}</span>
      </div>
      <div style={s('display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--raised)')}>
        {TIER_ORDER.map(({ level }) => {
          const pct = total > 0 ? (counts[level] / total) * 100 : 0;
          return pct > 0 ? <div key={level} style={s(`width:${pct}%;background:${tierColor(level)}`)} /> : null;
        })}
      </div>
      <div style={s('display:flex;gap:18px;margin-top:11px;flex-wrap:wrap')}>
        {TIER_ORDER.map(({ level, label }) => (
          <div key={level} style={s('display:flex;align-items:center;gap:6px')}>
            <span style={s(`width:8px;height:8px;border-radius:2px;flex-shrink:0;background:${tierColor(level)}`)} />
            <span style={s(`font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${tierTextColor(level)}`)}>{counts[level]}</span>
            <span style={s('font-size:11px;color:var(--muted)')}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
        <span style={s('font-size:13px;color:var(--muted)')}>Loading…</span>
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
  const [leadStatusFilter, setLeadStatusFilter] = useState('all');
  const [leadSourceFilter, setLeadSourceFilter] = useState('all');
  const [dealStageFilter, setDealStageFilter] = useState('all');

  // Cache keyed per acted-as agent so an admin's "view-as" switch doesn't cross-contaminate books.
  const actAs = getImpersonation()?.zohoUserId ?? 'self';
  // SWR-cached: Clients loads eagerly; CRM tabs load lazily on first open, then paint instantly from
  // cache on re-entry while revalidating in the background (no blank loader on tab switch / refresh).
  const recsLoad = useCachedLoad(`sales:clients:${actAs}`, loadRecords);
  const leadsLoad = useCachedLoad(`sales:leads:${actAs}`, loadLeads, { enabled: dcSub === 'leads' });
  const dealsLoad = useCachedLoad(`sales:deals:${actAs}`, loadDeals, { enabled: dcSub === 'deals' });
  const rejLoad = useCachedLoad(`sales:rejections:${actAs}`, loadRejections, { enabled: dcSub === 'rejections' });

  const q = search[dcSub].toLowerCase();
  const showView = dcSub === 'leads' || dcSub === 'deals';
  const view = dcSub === 'deals' ? dealView : leadView;
  const setView = (v: PipeView): void => (dcSub === 'deals' ? setDealView(v) : setLeadView(v));
  const setSearchVal = (v: string): void => setSearch((prev) => ({ ...prev, [dcSub]: v }));

  // The active sub-tab's loader (drives the shared Refresh button + "Updated…" caption).
  const activeLoad: CachedLoad<unknown> | null =
    dcSub === 'clients' ? recsLoad : dcSub === 'leads' ? leadsLoad : dcSub === 'deals' ? dealsLoad : dcSub === 'rejections' ? rejLoad : null;

  // Distinct lead sources present in the data → Source filter options.
  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leadsLoad.data ?? []) if (l.source) set.add(l.source);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [leadsLoad.data]);

  // Clients → RecordVM
  const clients: RecordVM[] = (recsLoad.data ?? [])
    .filter((c) => !q || `${c.name} ${c.carrier} ${c.contact}`.toLowerCase().includes(q))
    .map((c) => {
      const [lbl, col] = REC_STATUS[c.status];
      const tier = resolveTier(c.active, tierGallons(c));
      return {
        id: c.id,
        name: c.name,
        carrier: c.carrier,
        initials: c.name.split(' ').map((w) => w.charAt(0)).slice(0, 2).join(''),
        avStyle: `width:40px;height:40px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`,
        statusBadge: badge(lbl, col),
        active: c.active,
        cards: c.cards,
        gallons: c.gallons,
        gallonsMonth: numFmt(c.gallonsThisMonth),
        tier,
        onClick: () => openClient({
          id: c.id, name: c.name, carrier: c.carrier, contact: c.contact, phone: c.phone,
          cards: c.cards, active: c.active, gallons: c.gallons, cycleGallons: c.cycleGallons,
          status: c.status, mc: c.mc, dot: c.dot,
          gallonsThisMonth: c.gallonsThisMonth, activeCardsThisMonth: c.activeCardsThisMonth,
          transactionsThisMonth: c.transactionsThisMonth, gallonsPrevMonth: c.gallonsPrevMonth,
          activeCardsPrevMonth: c.activeCardsPrevMonth,
        }),
      };
    });

  // Loyalty-tier distribution across the agent's whole book (not search-filtered).
  const tierCounts: Record<TierLevel, number> = { none: 0, bronze: 0, silver: 0, gold: 0 };
  for (const c of recsLoad.data ?? []) tierCounts[resolveTier(c.active, tierGallons(c)).level] += 1;
  const clientTotal = (recsLoad.data ?? []).length;

  return (
    <div className="ss-fu">
      <div style={s('margin-bottom:14px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Data Center</div>
        <div style={s('font-size:13px;color:var(--muted);margin-top:2px')}>Everything about your pipeline — clients, leads, deals, rejections &amp; money codes.</div>
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
              style={s(`display:flex;align-items:center;gap:8px;padding:9px 15px;border-radius:var(--radius-md);border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:13px;font-weight:700;cursor:${soon ? 'default' : 'pointer'};opacity:${soon ? '.5' : '1'};white-space:nowrap;transition:all .14s`)}
            >
              <Icon name={t.icon} size={16} style={{ flexShrink: 0 }} />
              {t.label}
              {soon && (
                <span style={s('font-size:8.5px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)')}>SOON</span>
              )}
            </button>
          );
        })}
      </div>

      {/* toolbar: search + filters + view toggle + refresh */}
      <div style={s('display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;align-items:center')}>
        <div style={s('position:relative;flex:1;min-width:240px')}>
          <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
          <input value={search[dcSub]} onChange={(e) => setSearchVal(e.currentTarget.value)} placeholder={SEARCH_PLACEHOLDER[dcSub]} className="ss-in" style={s('width:100%;height:44px;padding:0 16px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')} />
        </div>
        {dcSub === 'leads' && (
          <>
            <DcSelect
              label="Filter leads by status"
              value={leadStatusFilter}
              onChange={setLeadStatusFilter}
              options={[{ v: 'all', label: 'All statuses' }, ...LEAD_STATUS_ORDER.map((st) => ({ v: st, label: st }))]}
            />
            <DcSelect
              label="Filter leads by source"
              value={leadSourceFilter}
              onChange={setLeadSourceFilter}
              options={[{ v: 'all', label: 'All sources' }, ...sourceOptions.map((sv) => ({ v: sv, label: sv }))]}
            />
          </>
        )}
        {dcSub === 'deals' && (
          <DcSelect
            label="Filter deals by stage"
            value={dealStageFilter}
            onChange={setDealStageFilter}
            options={[{ v: 'all', label: 'All stages' }, ...DEAL_STAGE_ORDER.map((st) => ({ v: st, label: st }))]}
          />
        )}
        {showView && (
          <div style={s('display:flex;gap:4px;padding:4px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
            {VIEW_BTNS.map((b) => {
              const on = view === b.v;
              return (
                <button key={b.v} onClick={() => setView(b.v)} style={s(`display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:var(--radius-md);border:none;background:${on ? 'rgba(var(--accent-rgb),.14)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12px;font-weight:700;cursor:pointer;transition:all .14s`)}>
                  <Icon name={b.icon} size={15} />
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
        {activeLoad && (
          <button
            type="button"
            onClick={() => activeLoad.reload()}
            disabled={activeLoad.revalidating}
            title="Refresh"
            className="ss-ico-btn"
            style={s(`height:44px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:12px;font-weight:700;cursor:${activeLoad.revalidating ? 'default' : 'pointer'};display:flex;align-items:center;gap:8px;box-shadow:var(--shadow-sm);opacity:${activeLoad.revalidating ? '.7' : '1'}`)}
          >
            <span style={s(`display:inline-flex${activeLoad.revalidating ? ';animation:ss-spin .8s linear infinite' : ''}`)}>
              <Icon name="refresh" size={15} />
            </span>
            Refresh
          </button>
        )}
      </div>
      {activeLoad?.cachedAt && (
        <div style={s('margin-bottom:16px;font-size:11px;color:var(--faint)')}>
          {activeLoad.revalidating ? 'Refreshing…' : `Updated ${formatCachedAt(activeLoad.cachedAt)}`}
        </div>
      )}
      {!activeLoad?.cachedAt && <div style={s('margin-bottom:16px')} />}

      {/* content */}
      {dcSub === 'clients' && (
        <>
          {clientTotal > 0 && <TierDistribution counts={tierCounts} total={clientTotal} />}
          <Gate loading={recsLoad.loading} error={recsLoad.data ? null : recsLoad.error} empty={clients.length === 0} emptyMsg="No clients match your search.">
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
                <div style={s('margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:8px')}>
                  <span style={s(c.statusBadge.style)}>{c.statusBadge.text}</span>
                  <span style={s(badge(tierLabel(c.tier.level), tierColor(c.tier.level)).style + `;color:${tierTextColor(c.tier.level)};display:inline-flex;align-items:center;gap:4px;flex-shrink:0`)}>
                    <Icon name="star" size={11} />{tierLabel(c.tier.level)}{c.tier.grace ? ' •' : ''}
                  </span>
                </div>
                <div style={s('display:flex;gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border2)')}>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600")}>{c.active}<span style={s('color:var(--muted);font-size:12px')}>/{c.cards}</span></div>
                    <div style={s('font-size:11px;color:var(--muted)')}>Active cards</div>
                  </div>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:var(--violet)")}>{c.gallons}</div>
                    <div style={s('font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px')}><span style={s('display:inline-block;width:6px;height:6px;border-radius:2px;background:var(--violet)')} />Gallons · Cycle</div>
                  </div>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:var(--accent)")}>{c.gallonsMonth}</div>
                    <div style={s('font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px')}><span style={s('display:inline-block;width:6px;height:6px;border-radius:2px;background:var(--accent)')} />Gallons · Month</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </Gate>
        </>
      )}

      {dcSub === 'leads' && (
        <Gate loading={leadsLoad.loading} error={leadsLoad.data ? null : leadsLoad.error} empty={(leadsLoad.data?.length ?? 0) === 0} emptyMsg="No leads yet.">
          <LeadsView leads={leadsLoad.data ?? []} search={search.leads} view={leadView} statusFilter={leadStatusFilter} sourceFilter={leadSourceFilter} />
        </Gate>
      )}

      {dcSub === 'deals' && (
        <Gate loading={dealsLoad.loading} error={dealsLoad.data ? null : dealsLoad.error} empty={(dealsLoad.data?.length ?? 0) === 0} emptyMsg="No deals yet.">
          <DealsView deals={dealsLoad.data ?? []} search={search.deals} view={dealView} stageFilter={dealStageFilter} />
        </Gate>
      )}

      {dcSub === 'rejections' && (
        <Gate loading={rejLoad.loading} error={rejLoad.data ? null : rejLoad.error} empty={(rejLoad.data?.length ?? 0) === 0} emptyMsg="No rejected applications — nice work.">
          <RejectionsView rejections={rejLoad.data ?? []} search={search.rejections} />
        </Gate>
      )}

      {dcSub === 'money' && (
        <div style={s('padding:20px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:13px;font-weight:700;margin-bottom:14px')}>Money Codes Issued</div>
          <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden')}>
            <div style={s("display:grid;grid-template-columns:1.3fr 1.4fr 0.8fr 1fr auto;gap:8px;padding:11px 15px;background:var(--alt);font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)")}>
              <span>Code</span><span>Carrier</span><span style={s('text-align:right')}>Amount</span><span>Issued</span><span>Status</span>
            </div>
            <div style={s('padding:36px 20px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6')}>
              Money codes are issued through EFS, not Zoho CRM — there's nothing to show here yet.<br />
              Issue one from a client's <strong style={s('color:var(--text2)')}>Automations</strong>, and it'll appear on the account.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
