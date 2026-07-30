import { useEffect, useMemo, useRef, useState } from 'react';
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
  FileSpreadsheet,
  FileText,
  Fuel,
  Link2,
  RefreshCw,
  Search,
  Target,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import { getReferralWorkspace } from '../../../api/referrals';
import { MytrionPageLoader } from '../../_shared/MytrionPageLoader';
import { useCachedLoad, formatCachedAt } from '../../sales/redesign/dcCache';
import { ReferralDetailModal } from './ReferralDetailModal';
import { downloadReferralCsv, downloadReferralExcel } from './referralExport';
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

function periodLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function money(value: number | string): string {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function quantity(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function paginationItems(page: number, count: number): Array<number | string> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const pages = new Set([1, count, page - 1, page, page + 1]);
  const sorted = [...pages].filter((value) => value > 0 && value <= count).sort((a, b) => a - b);
  const items: Array<number | string> = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && value - previous > 1) items.push(`ellipsis-${previous}`);
    items.push(value);
  });
  return items;
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
  const calculatedBonus = card.previews.reduce((sum, item) => sum + Number(item.amountUsd), 0);
  const activity = card.previews.reduce(
    (sum, item) =>
      sum +
      (item.bonusType === 'swipes_legacy'
        ? item.periodSwipes
        : item.recurring
          ? item.periodGallons
          : item.cumulativeGallons),
    0,
  );
  const activityLabel =
    preview?.bonusType === 'swipes_legacy'
      ? 'Unique cards'
      : preview?.recurring
        ? 'Eligible gallons'
        : 'Cumulative gallons';
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
          <div className="mg-rf-card-metrics">
            <div>
              <span>{activityLabel}</span>
              <strong>{quantity(activity)}</strong>
            </div>
            <div>
              <span>Calculated bonus</span>
              <strong>{money(calculatedBonus)}</strong>
            </div>
          </div>
          <div className="mg-rf-card-payout">
            <span>
              {paid
                ? 'Previously paid'
                : earned
                  ? `${money(card.payableAmount)} payable`
                  : 'In progress'}
            </span>
            <strong>{preview?.recurring ? 'Monthly' : 'One-time'}</strong>
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

export function ReferralsCard({ onBack }: { onBack?: () => void }) {
  const [periodMonth, setPeriodMonth] = useState(currentPeriod);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReferralCardModel | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState('');
  const monthInputRef = useRef<HTMLInputElement>(null);
  const forceRefreshRef = useRef(false);

  const { data, loading, revalidating, error, reload, cachedAt } = useCachedLoad(
    `manager:referrals:workspace:${periodMonth}`,
    () => {
      const refresh = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return getReferralWorkspace(periodMonth, { refresh });
    },
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
  const rangeStart = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(page * PAGE_SIZE, filtered.length);
  const exportReady =
    Boolean(data && model && data.periodMonth === periodMonth) && !loading && !revalidating;

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

  const exportData = async (format: 'csv' | 'xlsx'): Promise<void> => {
    if (!model || !exportReady) return;
    setExporting(format);
    setExportError('');
    try {
      if (format === 'csv') downloadReferralCsv(model.cards, periodMonth);
      else await downloadReferralExcel(model.cards, periodMonth);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'Could not create the export.');
    } finally {
      setExporting(null);
    }
  };

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
            <h1 className="mg-page-title">Referrals</h1>
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
          {data && data.periodMonth === periodMonth ? (
            <span className="mg-rf-live-badge">
              <Calculator size={13} />
              {revalidating ? 'Calculating…' : 'Live calculation'}
            </span>
          ) : null}
          <div className="mg-rf-month" data-focus-shell>
            <button
              type="button"
              onClick={() => {
                const input = monthInputRef.current;
                if (!input) return;
                try {
                  input.showPicker();
                } catch {
                  input.focus();
                  input.click();
                }
              }}
              aria-label={`Choose calculation month, currently ${periodLabel(periodMonth)}`}
              aria-haspopup="dialog"
            >
              <CalendarDays size={15} />
              <span className="mg-rf-month-copy">
                <small>Month</small>
                <strong>{periodLabel(periodMonth)}</strong>
              </span>
              <ChevronRight className="mg-rf-month-chevron" size={14} aria-hidden="true" />
            </button>
            <input
              ref={monthInputRef}
              type="month"
              value={periodMonth.slice(0, 7)}
              max={currentPeriod().slice(0, 7)}
              onChange={(event) =>
                setPeriodMonth(event.target.value ? `${event.target.value}-01` : currentPeriod())
              }
              aria-label="Calculation month"
              tabIndex={-1}
            />
          </div>
          <button
            type="button"
            className="mg-btn"
            onClick={() => {
              forceRefreshRef.current = true;
              reload();
            }}
            disabled={loading || revalidating}
          >
            <RefreshCw size={15} className={revalidating && !loading ? 'mg-spin' : ''} />
            Refresh
          </button>
          <div className="mg-rf-export" aria-label="Export complete calculation">
            <button
              type="button"
              className="mg-btn"
              onClick={() => void exportData('xlsx')}
              disabled={!exportReady || exporting !== null}
              title={
                exportReady
                  ? 'Export every referral calculation to Excel'
                  : 'Available after calculation'
              }
            >
              <FileSpreadsheet size={15} />
              {exporting === 'xlsx' ? 'Preparing…' : 'Excel'}
            </button>
            <button
              type="button"
              className="mg-btn"
              onClick={() => void exportData('csv')}
              disabled={!exportReady || exporting !== null}
              title={
                exportReady
                  ? 'Export every referral calculation to CSV'
                  : 'Available after calculation'
              }
            >
              <FileText size={15} />
              {exporting === 'csv' ? 'Preparing…' : 'CSV'}
            </button>
          </div>
        </div>
      </header>
      {exportError ? <div className="mg-rf-export-error">{exportError}</div> : null}

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
            <small>Payable selected month</small>
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
        <MytrionPageLoader
          label="Calculating referral workspace…"
          detail="Connecting Zoho relationships with MART transaction history"
        />
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
              Showing{' '}
              <strong>
                {rangeStart}–{rangeEnd}
              </strong>{' '}
              of <strong>{filtered.length}</strong> referrals
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
                aria-label="Previous referral page"
              >
                <ChevronLeft size={15} />
              </button>
              {paginationItems(page, pageCount).map((item) =>
                typeof item === 'number' ? (
                  <button
                    key={item}
                    type="button"
                    className={item === page ? 'is-current' : ''}
                    aria-current={item === page ? 'page' : undefined}
                    aria-label={`Referral page ${item}`}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={item} aria-hidden="true">
                    …
                  </span>
                ),
              )}
              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={page === pageCount}
                aria-label="Next referral page"
              >
                <ChevronRight size={15} />
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
