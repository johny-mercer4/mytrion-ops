import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  Calculator,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Fuel,
  Link2,
  RefreshCw,
  Search,
  Target,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import { getReferralWorkspace } from '../../../api/referrals';
import { useCachedLoad, formatCachedAt } from '../../sales/redesign/dcCache';
import { ReferralDetailModal } from './ReferralDetailModal';
import { buildReferralCards, cardMatchesFilter, type ReferralCardModel } from './referralModel';
import './referrals.css';

const PAGE_SIZE = 24;
const FILTERS = [
  { id: 'all', label: 'All referrals' },
  { id: 'Swipes (Legacy)', label: 'Swipes' },
  { id: 'Gallons (Legacy)', label: 'Legacy gallons' },
  { id: 'Gallons (Parent)', label: 'Parent · 500 gal' },
  { id: 'Gallons (Child)', label: 'Child · 1,000 gal' },
  { id: 'needs_setup', label: 'Needs setup' },
] as const;

const TYPE_META: Record<
  string,
  { label: string; className: string; Icon: typeof Fuel; caption: string }
> = {
  'Gallons (Legacy)': {
    label: 'Legacy gallons',
    className: 'mg-rf-tone-cyan',
    Icon: Fuel,
    caption: '$0.01 / gallon · monthly',
  },
  'Swipes (Legacy)': {
    label: 'Legacy swipes',
    className: 'mg-rf-tone-violet',
    Icon: CreditCard,
    caption: '$50 / unique card · monthly',
  },
  'Gallons (Parent)': {
    label: 'Parent milestone',
    className: 'mg-rf-tone-amber',
    Icon: Target,
    caption: '$50 once · 500 gallons',
  },
  'Gallons (Child)': {
    label: 'Child milestone',
    className: 'mg-rf-tone-emerald',
    Icon: Building2,
    caption: '$50 once · 1,000 gallons',
  },
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function money(value: number | string): string {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function setupCopy(card: ReferralCardModel): string {
  if (card.setupState === 'needs_calculation') return 'Calculation field required';
  if (card.setupState === 'needs_child') return 'No child referrals linked';
  if (card.setupState === 'needs_deal') return 'Related Deal with Carrier ID required';
  return '';
}

function ReferralCard({
  card,
  onOpen,
}: {
  card: ReferralCardModel;
  onOpen: (card: ReferralCardModel) => void;
}) {
  const meta = TYPE_META[card.calculation];
  const Icon = meta?.Icon ?? Calculator;
  const preview = card.previews[0];
  const paid = card.previews.some((item) => item.state === 'paid');
  const earned = card.previews.some((item) => item.state === 'earned');
  const carriers = new Set(card.previews.map((item) => item.carrierId)).size;
  return (
    <button
      type="button"
      className={`mg-rf-card ${meta?.className ?? 'mg-rf-tone-neutral'}`}
      onClick={() => onOpen(card)}
      aria-label={`Open ${card.name} referral details`}
    >
      <span className="mg-rf-card-glow" aria-hidden="true" />
      <header className="mg-rf-card-head">
        <span className="mg-rf-card-icon">
          <Icon size={19} />
        </span>
        <span className="mg-rf-card-type">
          <strong>{meta?.label ?? 'Setup required'}</strong>
          <small>{meta?.caption ?? setupCopy(card)}</small>
        </span>
        <ChevronRight className="mg-rf-card-arrow" size={16} />
      </header>

      <div className="mg-rf-card-identity">
        <span className="mg-rf-avatar">{card.name.slice(0, 2).toUpperCase()}</span>
        <span>
          <strong>{card.name}</strong>
          <small>{card.company || card.referrerId || 'Parent Referrer'}</small>
        </span>
      </div>

      {card.setupState === 'ready' ? (
        <>
          <div className="mg-rf-card-amount">
            <span>{preview?.recurring ? 'This month' : 'Milestone award'}</span>
            <strong>
              {money(card.previews.reduce((sum, item) => sum + Number(item.amountUsd), 0))}
            </strong>
            <small>
              {paid
                ? 'Previously paid'
                : earned
                  ? `${money(card.payableAmount)} payable`
                  : 'In progress'}
            </small>
          </div>
          {!preview?.recurring && preview ? (
            <div className="mg-rf-card-progress">
              <span>
                <span style={{ width: `${preview.progressPct}%` }} />
              </span>
              <small>{Math.round(preview.progressPct)}% of threshold</small>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mg-rf-card-alert">
          <TriangleAlert size={15} />
          <span>{setupCopy(card)}</span>
        </div>
      )}

      <footer className="mg-rf-card-foot">
        <span>
          <UsersRound size={13} /> {card.children.length} children
        </span>
        <span>
          <Link2 size={13} /> {card.deals.length} deals
        </span>
        <span>
          <Fuel size={13} /> {carriers} carriers
        </span>
        {paid ? (
          <span className="is-success">
            <CircleCheck size={13} /> Paid
          </span>
        ) : null}
      </footer>
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="mg-rf-grid" aria-label="Loading referral cards">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="mg-rf-card mg-rf-card-skeleton" key={index}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function ReferralsCard({ onBack }: { onBack?: () => void }) {
  const [periodMonth, setPeriodMonth] = useState(currentPeriod);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReferralCardModel | null>(null);

  const { data, loading, revalidating, error, reload, cachedAt } = useCachedLoad(
    `manager:referrals:workspace:${periodMonth}`,
    () => getReferralWorkspace(periodMonth),
    { staleMs: 120_000 },
  );
  const model = useMemo(() => (data ? buildReferralCards(data) : null), [data]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (model?.cards ?? []).filter(
        (card) =>
          cardMatchesFilter(card, filter) &&
          (!normalizedQuery || card.searchText.includes(normalizedQuery)),
      ),
    [model, filter, normalizedQuery],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [filter, normalizedQuery, periodMonth]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const filterCounts = useMemo(() => {
    const cards = model?.cards ?? [];
    return Object.fromEntries(
      FILTERS.map((item) => [
        item.id,
        cards.filter((card) => cardMatchesFilter(card, item.id)).length,
      ]),
    );
  }, [model]);

  return (
    <div className="mg-page mg-rf-page">
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          {onBack ? (
            <button
              type="button"
              className="mg-backbtn"
              onClick={onBack}
              aria-label="Back to overview"
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <div>
            <div className="mg-kicker">Partner growth</div>
            <h1 className="mg-page-title">Referral intelligence</h1>
            <p className="mg-page-sub">
              Zoho relationships, Deal carrier IDs, and MART fuel activity brought into one
              auditable calculation workspace.
            </p>
          </div>
        </div>
        <div className="mg-head-actions">
          <span className="mg-cachedat">
            {revalidating
              ? 'Refreshing…'
              : cachedAt
                ? `Updated ${formatCachedAt(cachedAt)}`
                : '\u00a0'}
          </span>
          <label className="mg-rf-month">
            <CalendarDays size={14} />
            <input
              type="month"
              value={periodMonth.slice(0, 7)}
              onChange={(event) =>
                setPeriodMonth(event.target.value ? `${event.target.value}-01` : currentPeriod())
              }
              aria-label="Calculation month"
            />
          </label>
          <button
            type="button"
            className="mg-btn"
            onClick={reload}
            disabled={loading || revalidating}
          >
            <RefreshCw size={15} className={revalidating && !loading ? 'mg-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {data ? (
        <section className="mg-rf-kpis" aria-label="Referral summary">
          <div>
            <span className="is-violet">
              <UsersRound size={17} />
            </span>
            <small>Parent referrers</small>
            <strong>{data.summary.parents.toLocaleString()}</strong>
            <em>{data.summary.configuredParents.toLocaleString()} configured</em>
          </div>
          <div>
            <span className="is-cyan">
              <Link2 size={17} />
            </span>
            <small>Related deals</small>
            <strong>{data.summary.relatedDeals.toLocaleString()}</strong>
            <em>{data.summary.connectedCarriers.toLocaleString()} MART carriers</em>
          </div>
          <div>
            <span className="is-emerald">
              <BadgeDollarSign size={17} />
            </span>
            <small>Payable this run</small>
            <strong>{money(data.summary.payableAmountUsd)}</strong>
            <em>{data.summary.earned} earned awards</em>
          </div>
          <div>
            <span className="is-amber">
              <TriangleAlert size={17} />
            </span>
            <small>Needs attention</small>
            <strong>{data.summary.needsDealLink + data.summary.needsCalculation}</strong>
            <em>missing Deal link or calculation</em>
          </div>
        </section>
      ) : null}

      <section className="mg-rf-controls">
        <label className="mg-rf-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search referrer, company, child, deal or carrier…"
            aria-label="Search referrals"
          />
        </label>
        <div className="mg-rf-filters" role="group" aria-label="Filter calculation type">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>{filterCounts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <SkeletonGrid />
      ) : error && !data ? (
        <div className="mg-error">
          <p>{error}</p>
          <button type="button" className="mg-btn" onClick={reload}>
            Retry
          </button>
        </div>
      ) : visible.length ? (
        <>
          <div className="mg-rf-result-meta">
            <span>
              Showing <strong>{visible.length}</strong> of <strong>{filtered.length}</strong>{' '}
              referrals
            </span>
            {model?.orphanChildren.length ? (
              <span className="is-warning">
                <TriangleAlert size={13} />
                {model.orphanChildren.length} unlinked child referrals
              </span>
            ) : null}
          </div>
          <div className="mg-rf-grid">
            {visible.map((card) => (
              <ReferralCard key={card.id} card={card} onOpen={setSelected} />
            ))}
          </div>
          {pageCount > 1 ? (
            <nav className="mg-rf-pagination" aria-label="Referral pages">
              <button
                type="button"
                onClick={() => setPage((value) => value - 1)}
                disabled={page === 1}
              >
                <ChevronLeft size={15} /> Previous
              </button>
              <span>
                Page <strong>{page}</strong> of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={page === pageCount}
              >
                Next <ChevronRight size={15} />
              </button>
            </nav>
          ) : null}
        </>
      ) : (
        <div className="mg-empty">
          <Search size={20} />
          {query.trim()
            ? `No referrals match “${query.trim()}”.`
            : 'No referrals match this filter.'}
        </div>
      )}

      {selected && data ? (
        <ReferralDetailModal
          card={selected}
          parentFields={data.parents.fields}
          childFields={data.children.fields}
          dealFields={data.associations.deals.fields}
          periodMonth={periodMonth}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
