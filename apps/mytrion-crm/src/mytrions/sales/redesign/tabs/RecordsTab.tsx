/**
 * Sales Mytrion redesign — Data Center ("records") tab. Ported from the reference prototype's
 * isRecords slice: five sub-tabs (Clients / Leads / Deals / Rejection Reports / Money Codes) with a
 * per-tab search and a board/list toggle for the pipeline tabs.
 *
 * Clients use the owner-scoped DWH roster; pipeline tabs use Zoho CRM; Money Codes use Ops DB.
 */
import { useMemo, useState } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge, NAV_DESC, type BadgeVM } from '../salesData';
import {
  SalesEmpty,
  SalesErrorNote,
  SalesPage,
  SalesPageHead,
  SalesSubTabs,
  Skel,
  type SalesSubTab,
} from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
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
import { ClientLoyaltyComparison } from '../ClientLoyaltyComparison';
import { MoneyCodesView } from '../dataCenterMoneyCodes';
import { RejectionDetailModal } from '../RejectionDetailModal';
import { ManagerLoyaltyBadge } from '../LoyaltyOverrideNotice';
import { createSalesAgentMiniAppInvitation } from '@/api/carrierUsers';

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
        style={s("height:42px;padding:0 34px 0 34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;box-shadow:var(--shadow-sm);-webkit-appearance:none;-moz-appearance:none;appearance:none;max-width:220px;font-family:inherit")}
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

const DC_TABS: ReadonlyArray<SalesSubTab<DcSub>> = [
  { id: 'clients', label: 'Clients', icon: 'clients' },
  { id: 'leads', label: 'Leads', icon: 'leads' },
  { id: 'deals', label: 'Deals', icon: 'deals' },
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

const VIEW_TABS: ReadonlyArray<SalesSubTab<PipeView>> = [
  { id: 'kanban', label: 'Board', icon: 'board' }, { id: 'list', label: 'List', icon: 'list' },
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
  previousInNetworkGallons: number;
  currentInNetworkGallons: number;
  previousTotalGallons: number;
  currentTotalGallons: number;
  previousCards: number;
  currentCards: number;
  owed: number;
  managerControlled: boolean;
  miniAppEligible: boolean;
  tier: TierResult;
  onClick: () => void;
}

/** Display order for the bar + filter. Mirrors the sort: best tier first, "no cards" last. */
const TIER_ORDER: TierBucket[] = ['enterprise', 'gold', 'silver', 'bronze', 'building', 'idle'];

/** Loyalty distribution and filter; counts always describe the agent's full book. */
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
    <div className="dc-lty" style={s('border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);padding:14px 16px;box-shadow:var(--shadow-sm)')}>
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
          <span style={s("font-size:12px;color:var(--muted);font-family:var(--font-mono)")}>{total} client{total === 1 ? '' : 's'}</span>
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
              <span style={s(`font-size:13px;font-weight:700;font-family:var(--font-mono);color:${tierBucketTextColor(b)}`)}>{counts[b]}</span>
              <span style={s(`font-size:12px;color:${on ? 'var(--text)' : 'var(--muted)'}`)}>{tierBucketLabel(b)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Same box as `TierDistribution`, so the roster grid doesn't jump when the real bar arrives. */
function TierDistributionSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={s('border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);padding:14px 16px;box-shadow:var(--shadow-sm)')}
    >
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:12px')}>
        <Skel w="140px" h="11px" />
        <Skel w="70px" h="11px" />
      </div>
      <Skel w="100%" h="8px" radius="99px" />
      <div style={s('display:flex;gap:8px;margin-top:11px;flex-wrap:wrap')}>
        {TIER_ORDER.map((b) => (
          <Skel key={b} w="104px" h="30px" radius="99px" />
        ))}
      </div>
    </div>
  );
}

/**
 * Loading / error / empty gate for one sub-tab's content slot.
 *
 * `skeleton` is required: the old signature made it optional and fell back to a centred spinner,
 * which is how Data Center ended up showing a spinner on one sub-tab and a shaped skeleton on the
 * next. There is one loading idiom in Sales now, and it is the skeleton.
 */
function Gate({
  loading,
  error,
  empty,
  emptyIcon,
  emptyTitle,
  emptyMsg,
  children,
  skeleton,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyIcon: IconName;
  emptyTitle: string;
  emptyMsg: string;
  children: React.ReactNode;
  skeleton: React.ReactNode;
}) {
  if (loading) return <>{skeleton}</>;
  if (error) return <SalesErrorNote>{error}</SalesErrorNote>;
  if (empty) return <SalesEmpty icon={emptyIcon} title={emptyTitle} body={emptyMsg} />;
  return <>{children}</>;
}

export function RecordsTab() {
  const { openClient, pushToast } = useSales();
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
  const [launchingCarrier, setLaunchingCarrier] = useState<string | null>(null);

  const openAgentMiniApp = async (carrierId: string): Promise<void> => {
    // Open synchronously so browser popup protection does not discard the Telegram window while
    // the authenticated invitation request is in flight.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setLaunchingCarrier(carrierId);
    try {
      const { inviteUrl } = await createSalesAgentMiniAppInvitation(carrierId);
      if (popup) popup.location.replace(inviteUrl);
      else window.open(inviteUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      popup?.close();
      pushToast(
        'Mini-app could not open',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setLaunchingCarrier((current) => (current === carrierId ? null : current));
    }
  };

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
        avStyle: `width:40px;height:40px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-weight:700;font-size:16px;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`,
        statusBadge: badge(lbl, col),
        active: c.active,
        cards: c.cards,
        gallons: c.gallons,
        gallonsMonth: numFmt(c.gallonsThisMonth),
        previousInNetworkGallons: c.inNetworkGallonsPrevMonth,
        currentInNetworkGallons: c.inNetworkGallonsThisMonth,
        previousTotalGallons: c.gallonsPrevMonth,
        currentTotalGallons: c.gallonsThisMonth,
        previousCards: c.activeCardsPrevMonth,
        currentCards: c.activeCardsThisMonth,
        owed: c.computedDebt,
        managerControlled: c.managerControlled === true,
        miniAppEligible: c.computedIsActive && c.status !== 'debtor',
        tier,
        onClick: () => openClient({
          id: c.id, name: c.name, carrier: c.carrier, contact: c.contact, phone: c.phone,
          cards: c.cards, active: c.active, trucks: c.trucks, gallons: c.gallons, cycleGallons: c.cycleGallons,
          status: c.status, mc: c.mc, dot: c.dot, owed: c.computedDebt,
          gallonsThisMonth: c.gallonsThisMonth, activeCardsThisMonth: c.activeCardsThisMonth,
          transactionsThisMonth: c.transactionsThisMonth, gallonsPrevMonth: c.gallonsPrevMonth,
          inNetworkGallonsThisMonth: c.inNetworkGallonsThisMonth,
          activeCardsPrevMonth: c.activeCardsPrevMonth,
          inNetworkGallonsPrevMonth: c.inNetworkGallonsPrevMonth,
          lastTierName: c.lastTierName,
          loyaltyOverride: c.loyaltyOverride ?? null,
        }),
      };
    })
    // Debtors first, then Gold → Silver → Bronze → Building → No cards (see clientSort.ts).
    .sort(compareClients);

  // Loyalty-tier distribution across the agent's whole book (not search-filtered).
  const tierCounts: Record<TierBucket, number> = {
    enterprise: 0,
    gold: 0,
    silver: 0,
    bronze: 0,
    building: 0,
    idle: 0,
  };
  for (const c of recsLoad.data ?? []) tierCounts[tierBucketOf(resolveTierForRow(c))] += 1;
  const clientTotal = (recsLoad.data ?? []).length;

  return (
    <SalesPage busy={activeLoad?.loading === true || activeLoad?.revalidating === true}>
      <SalesPageHead description={NAV_DESC.records} />

      <SalesSubTabs items={DC_TABS} value={dcSub} onChange={setDcSub} label="Data Center section" />

      {/* toolbar: search + filters + view toggle */}
      <div className="ss-toolbar">
        <div className="ss-search">
          <Icon name="search" size={16} />
          <input
            value={search[dcSub]}
            onChange={(e) => setSearchVal(e.currentTarget.value)}
            aria-label={SEARCH_PLACEHOLDER[dcSub]}
            placeholder={SEARCH_PLACEHOLDER[dcSub]}
          />
          {search[dcSub] ? (
            <button
              type="button"
              className="ss-search-clear"
              aria-label="Clear search"
              onClick={() => setSearchVal('')}
            >
              <Icon name="close" size={13} strokeWidth={2.4} />
            </button>
          ) : null}
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
              style={s(`display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 16px;border-radius:var(--radius-md);border:1px solid ${leadMetaOnly ? 'var(--accent)' : 'var(--border)'};background:${leadMetaOnly ? 'rgba(var(--accent-rgb),.12)' : 'var(--surface)'};color:${leadMetaOnly ? 'var(--accent)' : 'var(--muted)'};font-size:14px;font-weight:700;cursor:pointer;box-shadow:var(--shadow-sm);white-space:nowrap;transition:all .14s`)}
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
          <SalesSubTabs
            items={VIEW_TABS}
            value={view}
            onChange={setView}
            label={`${dcSub === 'deals' ? 'Deals' : 'Leads'} layout`}
            size="sm"
          />
        )}
      </div>
      {/* The freshness caption keeps a fixed line box whether or not there is a timestamp, so the
          content below never shifts up by a line when the first fetch lands. */}
      <div style={s('min-height:15px;margin-top:-6px;font-size:12px;color:var(--faint)')}>
        {activeLoad?.cachedAt
          ? activeLoad.revalidating
            ? 'Refreshing…'
            : `Updated ${formatCachedAt(activeLoad.cachedAt)}`
          : ''}
      </div>

      {/* content */}
      {dcSub === 'clients' && (
        <>
          {/* Reserve the tier bar while the roster loads — it used to pop in above the grid and
              shove every card down. */}
          {recsLoad.loading && !recsLoad.data ? (
            <TierDistributionSkeleton />
          ) : clientTotal > 0 ? (
            <TierDistribution counts={tierCounts} total={clientTotal} active={clientTierFilter} onPick={setClientTierFilter} />
          ) : null}
          <Gate
            loading={recsLoad.loading && !recsLoad.data}
            error={recsLoad.data ? null : recsLoad.error}
            empty={clients.length === 0}
            emptyIcon="clients"
            emptyTitle={q || clientTierFilter || clientStatusFilter !== 'all' ? 'No matching clients' : 'No clients yet'}
            emptyMsg={q || clientTierFilter || clientStatusFilter !== 'all' ? 'No clients match the current search and filters.' : 'Clients appear here once they are assigned to you.'}
            skeleton={<SalesBodySkeleton variant="grid" label="clients" />}
          >
          {/* .dc-lty scopes the tier palette; each card carries its bucket class so the shell (edge,
              wash, rail, glow) reads as the tier while the figures below keep their own semantics. */}
          <div className="dc-lty" style={s('display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px')}>
            {clients.map((c) => (
              <div key={c.id} onClick={c.onClick} className={`dc-lty-c is-${tierBucketOf(c.tier)}`}>
                <div style={s('display:flex;align-items:center;gap:12px')}>
                  <div style={s(c.avStyle)}>{c.initials}</div>
                  <div style={s('min-width:0;flex:1')}>
                    <div style={s('font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
                    <div style={s("font-size:12px;color:var(--muted);font-family:var(--font-mono);margin-top:2px")}>{c.carrier}</div>
                    {c.managerControlled ? <ManagerLoyaltyBadge /> : null}
                  </div>
                </div>
                <div style={s('margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:8px')}>
                  <span style={s(c.statusBadge.style)}>{c.statusBadge.text}</span>
                  {(() => {
                    // One badge per bucket, each with its own silhouette — a star on all four made
                    // Gold/Silver/Bronze read as the same badge in different tints.
                    const bk = tierBucketOf(c.tier);
                    // The current badge is earned from the closed previous month. Spell out the track
                    // and exact bars so the card is auditable without opening the detail modal.
                    const th = c.tier.thresholds;
                    const tip = th
                      ? `${trackCaption(c.tier)} — ${tierBucketLabel(bk)}. ` +
                        `Bronze ${numFmt(th.bronze)} / Silver ${numFmt(th.silver)} / Gold ${numFmt(th.gold)} ULSR + ULSD gal; ` +
                        `closed month: ${numFmt(Math.round(c.tier.gallons))} gal` +
                        (c.tier.nextLevel ? ` (${numFmt(Math.round(c.tier.gallonsToNext))} to ${c.tier.nextLevel})` : '')
                      : trackCaption(c.tier);
                    return (
                      <span title={tip} style={s(badge(tierBucketLabel(bk), tierBucketColor(bk)).style + `;color:${tierBucketTextColor(bk)};display:inline-flex;align-items:center;gap:5px;flex-shrink:0;cursor:help`)}>
                        <Icon name={tierBucketIcon(bk)} size={12} />{tierBucketLabel(bk)}{c.tier.grace ? ' •' : ''}
                      </span>
                    );
                  })()}
                </div>
                <ClientLoyaltyComparison
                  previousInNetworkGallons={c.previousInNetworkGallons}
                  currentInNetworkGallons={c.currentInNetworkGallons}
                  previousTotalGallons={c.previousTotalGallons}
                  currentTotalGallons={c.currentTotalGallons}
                  previousCards={c.previousCards}
                  currentCards={c.currentCards}
                  accountActiveCards={c.active}
                  owed={c.owed}
                />
                <button
                  type="button"
                  disabled={!c.miniAppEligible || launchingCarrier === c.id}
                  aria-label={`View ${c.name} mini-app`}
                  title={c.miniAppEligible ? 'Open this company in your Sales agent mini-app' : 'Debtor and inactive companies cannot be viewed'}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (c.miniAppEligible) void openAgentMiniApp(c.id);
                  }}
                  style={s(`margin-top:13px;width:100%;height:38px;border-radius:var(--radius-sm);border:1px solid ${c.miniAppEligible ? 'rgba(var(--accent-rgb),.35)' : 'var(--border)'};background:${c.miniAppEligible ? 'rgba(var(--accent-rgb),.1)' : 'var(--alt)'};color:${c.miniAppEligible ? 'var(--accent)' : 'var(--faint)'};display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;font-size:12px;font-weight:700;cursor:${c.miniAppEligible ? 'pointer' : 'not-allowed'};opacity:${launchingCarrier === c.id ? .7 : 1}`)}
                >
                  <Icon name={launchingCarrier === c.id ? 'refresh' : 'link'} size={14} />
                  {launchingCarrier === c.id ? 'Opening mini-app…' : c.miniAppEligible ? 'View mini-app' : 'Mini-app unavailable'}
                </button>
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
          emptyIcon="leads"
          emptyTitle="No leads yet"
          emptyMsg="New leads land here as soon as they are assigned to you."
          skeleton={
            <SalesBodySkeleton
              variant={leadView === 'kanban' ? 'board' : 'table'}
              label="leads"
              cols={5}
            />
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
          emptyIcon="deals"
          emptyTitle="No deals yet"
          emptyMsg="Deals appear here once a lead converts."
          skeleton={
            <SalesBodySkeleton
              variant={dealView === 'kanban' ? 'board' : 'table'}
              label="deals"
              cols={5}
            />
          }
        >
          <DealsView deals={dealsLoad.data ?? []} search={search.deals} view={dealView} stageFilter={dealStageFilter} />
        </Gate>
      )}

      {dcSub === 'rejections' && (
        <Gate
          loading={rejLoad.loading && !rejLoad.data}
          error={rejLoad.data ? null : rejLoad.error}
          empty={(rejLoad.data?.length ?? 0) === 0}
          emptyIcon="rejections"
          emptyTitle="No card declines"
          emptyMsg="Nothing has been declined for your clients yet."
          skeleton={<SalesBodySkeleton variant="table" label="rejection reports" cols={5} />}
        >
          <RejectionsView rejections={rejLoad.data ?? []} search={search.rejections} onOpen={setOpenRejection} />
        </Gate>
      )}

      {dcSub === 'money' && <MoneyCodesView search={search.money} />}

      {openRejection && (
        <RejectionDetailModal row={openRejection} onClose={() => setOpenRejection(null)} />
      )}
    </SalesPage>
  );
}
