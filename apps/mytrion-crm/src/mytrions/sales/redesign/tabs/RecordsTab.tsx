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
 *   - Money Codes → local Ops DB money_code_requests (own draws + void; codes never shown)
 */
import { useMemo, useState } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge, type BadgeVM } from '../salesData';
import {
  tierBucketOf,
  resolveTierForRow,
  trackCaption,
  tierBucketIcon,
  tierBucketLabel,
  tierBucketColor,
  tierBucketTextColor,
  type TierResult,
  type TierBucket,
} from '../../../_shared/loyalty';
import { loadRecords, numFmt } from '../live';
import {
  loadLeads,
  loadDeals,
  loadRejections,
  LEAD_STATUS_ORDER,
  DEAL_STAGE_ORDER,
  type RejectionVM,
} from '../dataCenterLive';
import { useCachedLoad, formatCachedAt, type CachedLoad } from '../dcCache';
import { compareClients } from '../clientSort';
import { getImpersonation } from '@/api/impersonation';
import { useSales } from '../ctx';
import { LeadsView, DealsView, RejectionsView } from '../dataCenterViews';
import { DcCardGridSkeleton, DcKanbanSkeleton, DcListSkeleton } from '../DataCenterSkeletons';
import { MoneyCodesView } from '../dataCenterMoneyCodes';
import { RejectionDetailModal } from '../RejectionDetailModal';

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
        style={s("height:44px;padding:0 34px 0 34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;box-shadow:var(--shadow-sm);-webkit-appearance:none;-moz-appearance:none;appearance:none;max-width:220px;font-family:inherit")}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      <span style={s('position:absolute;right:13px;pointer-events:none;color:var(--muted);font-size:11px')}>▾</span>
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
  // Leads + Deals parked as "Coming soon". Drop `disabled` to re-enable — LeadsView / DealsView and
  // loadLeads() / loadDeals() stay wired, and the COQL loads are `enabled`-gated on dcSub so nothing
  // fetches while parked.
  { id: 'leads', label: 'Leads', icon: 'leads', disabled: true },
  { id: 'deals', label: 'Deals', icon: 'deals', disabled: true },
  // Awaiting a redesign — the current view isn't usable. Drop `disabled` to re-enable; the
  // RejectionsView component + loadRejections() stay wired for when the redesign ships.
  { id: 'rejections', label: 'Rejection Reports', icon: 'rejections' },
  { id: 'money', label: 'Money Codes', icon: 'moneyCodes' },
];

const SEARCH_PLACEHOLDER: Record<DcSub, string> = {
  clients: 'Search clients by name, carrier ID or contact…',
  leads: 'Search leads by name, company, source, email or phone…',
  deals: 'Search deals by company or deal name…',
  rejections: 'Search rejections by company, app ID or reason…',
  money: 'Search by company or carrier ID…',
};

const VIEW_BTNS: { v: PipeView; label: string; icon: IconName }[] = [
  { v: 'kanban', label: 'Board', icon: 'board' },
  { v: 'list', label: 'List', icon: 'list' },
];

/**
 * Account-status filter for the Clients view. Loyalty tiers used to be mixed into this same dropdown,
 * which meant the only way to see "my Gold clients" was to hunt through a list labelled
 * "All statuses" — and picking a tier silently dropped the Debtor/Active filter. Tiers now have their
 * own always-visible control on the distribution bar, and the two compose (Debtor + Gold).
 */
const CLIENT_STATUS_OPTIONS: { v: string; label: string }[] = [
  { v: 'all', label: 'All statuses' },
  { v: 'debtor', label: 'Debtor' },
  { v: 'active', label: 'Active' },
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
  owed: number;
  tier: TierResult;
  onClick: () => void;
}

/** Display order for the bar + filter. Mirrors the sort: best tier first, "no cards" last. */
const TIER_ORDER: TierBucket[] = ['gold', 'silver', 'bronze', 'building', 'idle'];

/**
 * Loyalty-tier distribution AND the tier filter, in one control.
 *
 * The counts were already here and already sat directly above the grid, so making each legend entry
 * a toggle is the whole filter — no extra chrome, and the number you click is the number of cards you
 * get. Clicking the active bucket clears it. Counts always describe the agent's FULL book, never the
 * filtered slice, so the denominator doesn't move under you as you filter.
 */
function TierDistribution({
  counts,
  total,
  active,
  onPick,
}: {
  counts: Record<TierBucket, number>;
  total: number;
  active: TierBucket | null;
  onPick: (b: TierBucket | null) => void;
}) {
  return (
    // .dc-lty carries the --lty-* palette these chips read (see dc-clients.css).
    <div className="dc-lty" style={s('margin-bottom:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);padding:14px 16px;box-shadow:var(--shadow-sm)')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:12px')}>
        <span style={s('font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>Loyalty distribution</span>
        <span style={s('display:flex;align-items:center;gap:10px')}>
          {active && (
            <button
              type="button"
              onClick={() => onPick(null)}
              style={s('display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:99px;border:1px solid var(--border);background:var(--alt);color:var(--muted);font-size:11px;font-weight:700;cursor:pointer')}
            >
              <Icon name="close" size={11} />Clear filter
            </button>
          )}
          <span style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{total} client{total === 1 ? '' : 's'}</span>
        </span>
      </div>
      <div style={s('display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--raised)')}>
        {TIER_ORDER.map((b) => {
          const pct = total > 0 ? (counts[b] / total) * 100 : 0;
          if (pct <= 0) return null;
          // Dim the other segments while a bucket is selected, so the bar reflects the filter.
          return (
            <div
              key={b}
              style={s(`width:${pct}%;background:${tierBucketColor(b)};opacity:${!active || active === b ? 1 : 0.28};transition:opacity .16s`)}
            />
          );
        })}
      </div>
      <div style={s('display:flex;gap:8px;margin-top:11px;flex-wrap:wrap')}>
        {TIER_ORDER.map((b) => {
          const on = active === b;
          const empty = counts[b] === 0;
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              // An empty bucket is left clickable-looking but inert — filtering to zero results is
              // never what the agent wanted, and disabling it explains itself.
              disabled={empty}
              onClick={() => onPick(on ? null : b)}
              title={empty ? `No ${tierBucketLabel(b)} clients` : `Show only ${tierBucketLabel(b)}`}
              style={s(`display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:99px;cursor:${empty ? 'default' : 'pointer'};font-family:inherit;transition:background .16s,border-color .16s;border:1px solid ${on ? tierBucketColor(b) : 'var(--border)'};background:${on ? `color-mix(in srgb,${tierBucketColor(b)} 18%,transparent)` : 'var(--alt)'};opacity:${empty ? 0.45 : 1}`)}
            >
              <Icon name={tierBucketIcon(b)} size={13} color={tierBucketColor(b)} />
              <span style={s(`font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${tierBucketTextColor(b)}`)}>{counts[b]}</span>
              <span style={s(`font-size:12px;color:${on ? 'var(--text)' : 'var(--muted)'}`)}>{tierBucketLabel(b)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Skeleton / spinner (loading) / red line (error) / muted line (empty) in the ss-* look. */
function Gate({
  loading,
  error,
  empty,
  emptyMsg,
  children,
  skeleton,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  if (loading) {
    if (skeleton) return <>{skeleton}</>;
    return (
      <div style={s('display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:60px 20px')}>
        <span style={s('width:34px;height:34px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:ss-spin .8s linear infinite')} />
        <span style={s('font-size:14px;color:var(--muted)')}>Loading…</span>
      </div>
    );
  }
  if (error) return <div style={s('padding:44px 20px;text-align:center;color:var(--danger);font-size:14px')}>{error}</div>;
  if (empty) return <div style={s('padding:44px 20px;text-align:center;color:var(--muted);font-size:14px')}>{emptyMsg}</div>;
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
  const [leadMetaOnly, setLeadMetaOnly] = useState(false);
  const [dealStageFilter, setDealStageFilter] = useState('all');
  const [clientStatusFilter, setClientStatusFilter] = useState('all');
  const [clientTierFilter, setClientTierFilter] = useState<TierBucket | null>(null);
  const [openRejection, setOpenRejection] = useState<RejectionVM | null>(null);

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
    // Account status and loyalty tier are INDEPENDENT filters that compose (e.g. Debtor + Gold);
    // they used to share one dropdown, where choosing a tier silently discarded the status.
    .filter((c) => {
      if (clientStatusFilter === 'all') return true;
      if (clientStatusFilter === 'debtor') return c.status === 'debtor';
      return c.status === 'active';
    })
    .filter((c) => !clientTierFilter || tierBucketOf(resolveTierForRow(c)) === clientTierFilter)
    .map((c) => {
      const [lbl, col] = REC_STATUS[c.status];
      const tier = resolveTierForRow(c);
      return {
        id: c.id,
        name: c.name,
        carrier: c.carrier,
        initials: c.name.split(' ').map((w) => w.charAt(0)).slice(0, 2).join(''),
        avStyle: `width:40px;height:40px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`,
        statusBadge: badge(lbl, col),
        active: c.active,
        cards: c.cards,
        gallons: c.gallons,
        gallonsMonth: numFmt(c.gallonsThisMonth),
        owed: c.computedDebt,
        tier,
        onClick: () => openClient({
          id: c.id, name: c.name, carrier: c.carrier, contact: c.contact, phone: c.phone,
          cards: c.cards, active: c.active, trucks: c.trucks, gallons: c.gallons, cycleGallons: c.cycleGallons,
          status: c.status, mc: c.mc, dot: c.dot, owed: c.computedDebt,
          gallonsThisMonth: c.gallonsThisMonth, activeCardsThisMonth: c.activeCardsThisMonth,
          transactionsThisMonth: c.transactionsThisMonth, gallonsPrevMonth: c.gallonsPrevMonth,
          activeCardsPrevMonth: c.activeCardsPrevMonth,
        }),
      };
    })
    // Debtors first, then Gold → Silver → Bronze → Building → No cards (see clientSort.ts).
    .sort(compareClients);

  // Loyalty-tier distribution across the agent's whole book (not search-filtered).
  const tierCounts: Record<TierBucket, number> = { gold: 0, silver: 0, bronze: 0, building: 0, idle: 0 };
  for (const c of recsLoad.data ?? []) tierCounts[tierBucketOf(resolveTierForRow(c))] += 1;
  const clientTotal = (recsLoad.data ?? []).length;

  return (
    <div className="ss-fu">
      <div style={s('margin-bottom:14px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase')}>Data Center</div>
        <div style={s('font-size:14px;color:var(--muted);margin-top:2px')}>Everything about your pipeline — clients, leads, deals, rejections &amp; money codes.</div>
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
              style={s(`display:flex;align-items:center;gap:8px;padding:9px 15px;border-radius:var(--radius-md);border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:14px;font-weight:700;cursor:${soon ? 'default' : 'pointer'};opacity:${soon ? '.5' : '1'};white-space:nowrap;transition:all .14s`)}
            >
              <Icon name={t.icon} size={16} style={{ flexShrink: 0 }} />
              {t.label}
              {soon && (
                <span style={s('font-size:11px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)')}>SOON</span>
              )}
            </button>
          );
        })}
      </div>

      {/* toolbar: search + filters + view toggle + refresh */}
      <div style={s('display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;align-items:center')}>
        <div style={s('position:relative;flex:1;min-width:240px')}>
          <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
          <input value={search[dcSub]} onChange={(e) => setSearchVal(e.currentTarget.value)} placeholder={SEARCH_PLACEHOLDER[dcSub]} className="ss-in" style={s('width:100%;height:44px;padding:0 16px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;box-shadow:var(--shadow-sm)')} />
        </div>
        {dcSub === 'clients' && (
          <DcSelect
            label="Filter clients by account status"
            value={clientStatusFilter}
            onChange={setClientStatusFilter}
            options={CLIENT_STATUS_OPTIONS}
          />
        )}
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
            {/* Focused quick-filter: Meta (utm_source) leads — high-priority. */}
            <button
              type="button"
              onClick={() => setLeadMetaOnly((v) => !v)}
              aria-pressed={leadMetaOnly}
              title="Show only Meta (utm_source) leads"
              style={s(`display:inline-flex;align-items:center;gap:7px;height:44px;padding:0 16px;border-radius:var(--radius-md);border:1px solid ${leadMetaOnly ? 'var(--accent)' : 'var(--border)'};background:${leadMetaOnly ? 'rgba(var(--accent-rgb),.12)' : 'var(--surface)'};color:${leadMetaOnly ? 'var(--accent)' : 'var(--muted)'};font-size:14px;font-weight:700;cursor:pointer;box-shadow:var(--shadow-sm);white-space:nowrap;transition:all .14s`)}
            >
              <span style={s('width:7px;height:7px;border-radius:50%;background:var(--accent);flex-shrink:0')} />
              Meta
            </button>
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
                <button key={b.v} onClick={() => setView(b.v)} style={s(`display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:var(--radius-md);border:none;background:${on ? 'rgba(var(--accent-rgb),.14)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer;transition:all .14s`)}>
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
            style={s(`height:44px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:13px;font-weight:700;cursor:${activeLoad.revalidating ? 'default' : 'pointer'};display:flex;align-items:center;gap:8px;box-shadow:var(--shadow-sm);opacity:${activeLoad.revalidating ? '.7' : '1'}`)}
          >
            <span style={s(`display:inline-flex${activeLoad.revalidating ? ';animation:ss-spin .8s linear infinite' : ''}`)}>
              <Icon name="refresh" size={15} />
            </span>
            Refresh
          </button>
        )}
      </div>
      {activeLoad?.cachedAt && (
        <div style={s('margin-bottom:16px;font-size:12px;color:var(--faint)')}>
          {activeLoad.revalidating ? 'Refreshing…' : `Updated ${formatCachedAt(activeLoad.cachedAt)}`}
        </div>
      )}
      {!activeLoad?.cachedAt && <div style={s('margin-bottom:16px')} />}

      {/* content */}
      {dcSub === 'clients' && (
        <>
          {clientTotal > 0 && (
            <TierDistribution counts={tierCounts} total={clientTotal} active={clientTierFilter} onPick={setClientTierFilter} />
          )}
          <Gate loading={recsLoad.loading} error={recsLoad.data ? null : recsLoad.error} empty={clients.length === 0} emptyMsg={q ? 'No clients match your search.' : 'No clients in this book yet.'} skeleton={<DcCardGridSkeleton label="clients" />}>
          {/* .dc-lty scopes the tier palette; each card carries its bucket class so the shell (edge,
              wash, rail, glow) reads as the tier while the figures below keep their own semantics. */}
          <div className="dc-lty" style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
            {clients.map((c) => (
              <div key={c.id} onClick={c.onClick} className={`dc-lty-c is-${tierBucketOf(c.tier)}`}>
                <div style={s('display:flex;align-items:center;gap:12px')}>
                  <div style={s(c.avStyle)}>{c.initials}</div>
                  <div style={s('min-width:0;flex:1')}>
                    <div style={s('font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
                    <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{c.carrier}</div>
                  </div>
                </div>
                <div style={s('margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:8px')}>
                  <span style={s(c.statusBadge.style)}>{c.statusBadge.text}</span>
                  {(() => {
                    // One badge per bucket, each with its own silhouette — a star on all four made
                    // Gold/Silver/Bronze read as the same badge in different tints.
                    const bk = tierBucketOf(c.tier);
                    // Tiers are relative to FLEET SIZE, so a grid legitimately shows a 1-card client
                    // at Gold next to a 12-card client at Silver. Spell out the track + the bar they
                    // were measured against, otherwise the board reads as broken.
                    const th = c.tier.thresholds;
                    const tip = th
                      ? `${trackCaption(c.tier)} — ${tierBucketLabel(bk)}. ` +
                        `Bronze ${numFmt(th.bronze)} / Silver ${numFmt(th.silver)} / Gold ${numFmt(th.gold)} gal this month; ` +
                        `this client: ${numFmt(Math.round(c.tier.gallons))} gal` +
                        (c.tier.nextLevel ? ` (${numFmt(Math.round(c.tier.gallonsToNext))} to ${c.tier.nextLevel})` : '')
                      : 'No active cards this month — not in the program.';
                    return (
                      <span title={tip} style={s(badge(tierBucketLabel(bk), tierBucketColor(bk)).style + `;color:${tierBucketTextColor(bk)};display:inline-flex;align-items:center;gap:5px;flex-shrink:0;cursor:help`)}>
                        <Icon name={tierBucketIcon(bk)} size={12} />{tierBucketLabel(bk)}{c.tier.grace ? ' •' : ''}
                      </span>
                    );
                  })()}
                </div>
                <div style={s('display:flex;gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border2)')}>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600")}>{c.active}<span style={s('color:var(--muted);font-size:13px')}>/{c.cards}</span></div>
                    <div style={s('font-size:12px;color:var(--muted)')}>Active cards</div>
                  </div>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;color:var(--text)")}>{c.gallons}</div>
                    <div style={s('font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px')}><span style={s('display:inline-block;width:6px;height:6px;border-radius:2px;background:var(--violet)')} />Gallons · Cycle</div>
                  </div>
                  <div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;color:var(--text)")}>{c.gallonsMonth}</div>
                    <div style={s('font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px')}><span style={s('display:inline-block;width:6px;height:6px;border-radius:2px;background:var(--accent)')} />Gallons · Month</div>
                  </div>
                  {c.owed >= 1 && (
                    <div>
                      <div style={s("font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;color:var(--danger)")}>{`$${Math.round(c.owed).toLocaleString('en-US')}`}</div>
                      <div style={s('font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px')}><span style={s('display:inline-block;width:6px;height:6px;border-radius:2px;background:var(--danger)')} />Owed</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          </Gate>
        </>
      )}

      {dcSub === 'leads' && (
        <Gate
          loading={leadsLoad.loading && !leadsLoad.data}
          error={leadsLoad.data ? null : leadsLoad.error}
          empty={(leadsLoad.data?.length ?? 0) === 0}
          emptyMsg="No leads yet."
          skeleton={
            leadView === 'kanban' ? (
              <DcKanbanSkeleton label="leads" />
            ) : (
              <DcListSkeleton label="leads" cols={5} />
            )
          }
        >
          <LeadsView leads={leadsLoad.data ?? []} search={search.leads} view={leadView} statusFilter={leadStatusFilter} sourceFilter={leadSourceFilter} metaOnly={leadMetaOnly} />
        </Gate>
      )}

      {dcSub === 'deals' && (
        <Gate
          loading={dealsLoad.loading && !dealsLoad.data}
          error={dealsLoad.data ? null : dealsLoad.error}
          empty={(dealsLoad.data?.length ?? 0) === 0}
          emptyMsg="No deals yet."
          skeleton={
            dealView === 'kanban' ? (
              <DcKanbanSkeleton label="deals" />
            ) : (
              <DcListSkeleton label="deals" cols={5} />
            )
          }
        >
          <DealsView deals={dealsLoad.data ?? []} search={search.deals} view={dealView} stageFilter={dealStageFilter} />
        </Gate>
      )}

      {dcSub === 'rejections' && (
        <Gate
          loading={rejLoad.loading}
          error={rejLoad.data ? null : rejLoad.error}
          empty={(rejLoad.data?.length ?? 0) === 0}
          emptyMsg="No card declines recorded for your clients yet."
          skeleton={<DcListSkeleton label="rejection reports" cols={5} />}
        >
          <RejectionsView rejections={rejLoad.data ?? []} search={search.rejections} onOpen={setOpenRejection} />
        </Gate>
      )}

      {dcSub === 'money' && <MoneyCodesView search={search.money} />}

      {openRejection && (
        <RejectionDetailModal row={openRejection} onClose={() => setOpenRejection(null)} />
      )}
    </div>
  );
}
