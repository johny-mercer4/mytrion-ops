/**
 * Existing clients — every carrier company-wide, with the payment and credit terms on file.
 *
 * ONE FETCH, EVERYTHING LOCAL. The roster is ~8,000 lean rows from `octane.dim_company`, pulled once
 * into the shared SWR store and cached for an hour (`useVerificationRoster`), so the scope tabs, the
 * five filters, the search box, the sort and the table/card switch are all instant and cost no round
 * trip. That is why Main prefetches it: by the time anyone opens this tab it is already warm.
 *
 * TWO VIEWS OF THE SAME ROWS. The table is the reviewer's default — seven columns, sortable, dense
 * enough to scan a page. Cards are for the same data read one carrier at a time, and are what the
 * table becomes below the 640px structure line anyway. Both open the same dialog.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Pagination,
  Select,
  Tabs,
  type DataColumn,
  type IconName,
} from '@/ds';
import type { VerificationClientRow } from '@/api/verificationClients';
import { PageHead } from '../../_shared/page';
import { formatCachedAt } from '../../_shared/swrCache';
import {
  DEFAULT_VERIFICATION_SORT,
  distinctValues,
  EMPTY_VERIFICATION_FILTERS,
  isVerificationSort,
  useFilteredVerificationClients,
  useVerificationRoster,
  type VerificationFilters,
  type VerificationSort,
} from '../verificationData';
import { ClientCard } from './ClientCard';
import { ClientDetailDialog, type ClientTab } from './ClientDetailDialog';
import {
  activityText,
  inScope,
  limitText,
  minBalanceText,
  railStyle,
  rowEdge,
  scopeCounts,
  SCOPES,
  scoreText,
  scoreTone,
  SORT_OPTIONS,
  sortLabel,
  termsIntent,
  termsLabel,
  type Scope,
} from './clientsModel';
import './clients.css';

const PAGE_SIZE = 24;

type View = 'table' | 'cards';

/** The four filters the design puts in the panel. `debtor` is a SCOPE tab here, not a filter. */
type PanelKey = 'activity' | 'paymentTerms' | 'companyType' | 'billingCycleTag';

export function VerificationClients() {
  const roster = useVerificationRoster();
  const [scope, setScope] = useState<Scope>('all');
  const [view, setView] = useState<View>('table');
  const [filters, setFilters] = useState<VerificationFilters>(EMPTY_VERIFICATION_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<VerificationSort>(DEFAULT_VERIFICATION_SORT);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<ClientTab>('details');

  const rows = useMemo(() => roster.data ?? [], [roster.data]);

  // Search is deferred so typing stays responsive across 8,000 rows; the filter itself is sync.
  const deferredQ = useDeferredValue(filters.q);
  const filtered = useFilteredVerificationClients(rows, { ...filters, q: deferredQ }, sort);
  const scoped = useMemo(() => filtered.filter((c) => inScope(c, scope)), [filtered, scope]);

  const counts = useMemo(() => scopeCounts(filtered), [filtered]);
  const companyTypes = useMemo(() => distinctValues(rows, 'companyType'), [rows]);
  const cycleTags = useMemo(() => distinctValues(rows, 'billingCycleTag'), [rows]);

  const pageCount = Math.max(1, Math.ceil(scoped.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = scoped.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const set = <K extends PanelKey>(key: K, value: VerificationFilters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const panelActive =
    filters.activity !== 'all' ||
    filters.paymentTerms !== 'all' ||
    filters.companyType != null ||
    filters.billingCycleTag != null;

  const open = useCallback((row: VerificationClientRow) => {
    setOpenId(row.carrierId);
    setClientTab('details');
  }, []);

  const openClient = useMemo(
    () => rows.find((c) => c.carrierId === openId) ?? null,
    [rows, openId],
  );

  const columns = useMemo<DataColumn<VerificationClientRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Company',
        rowHeader: true,
        sortable: true,
        width: '30%',
        mobile: 'primary',
        cell: (row) => {
          const rail = railStyle(row.companyType);
          return (
            <span className="vc-ident">
              <span
                className="vc-rail-chip"
                style={{ ['--vc-rail' as string]: rail.tone }}
                aria-hidden="true"
              >
                <Icon name={rail.icon as IconName} size="sm" />
              </span>
              <span className="vc-ident-text">
                <span className="vc-ident-name">{row.companyName}</span>
                <span className="vc-ident-sub">
                  <span className="num">
                    #{row.carrierId} · {rail.label}
                  </span>
                  {row.isDebtor ? (
                    <Badge intent="danger" size="sm" icon="warning">
                      Debtor
                    </Badge>
                  ) : null}
                  {row.isActive ? null : (
                    <Badge intent="neutral" size="sm" icon="schedule">
                      Inactive
                    </Badge>
                  )}
                </span>
              </span>
            </span>
          );
        },
        mobileCell: (row) => row.companyName,
      },
      {
        id: 'terms',
        header: 'Terms',
        sortable: true,
        width: '10%',
        mobile: 'value',
        cell: (row) => (
          <Badge intent={termsIntent(row)} size="sm">
            {termsLabel(row)}
          </Badge>
        ),
      },
      {
        id: 'cycleTag',
        header: 'Billing cycle',
        width: '16%',
        priority: 3,
        mobile: 'secondary',
        cell: (row) => (
          <span className="vc-cycle">
            <span className="vc-cycle-tag">{row.billingCycleTag || '—'}</span>
            <span className="vc-cycle-full num">{row.billingCycle || '—'}</span>
          </span>
        ),
        mobileCell: (row) => row.billingCycleTag || null,
      },
      {
        id: 'minBalance',
        header: 'Balance',
        numeric: true,
        sortable: true,
        width: '11%',
        priority: 2,
        cell: (row) => <span data-empty={minBalanceText(row) === '—'}>{minBalanceText(row)}</span>,
      },
      {
        id: 'limit',
        header: 'Limit',
        numeric: true,
        sortable: true,
        width: '11%',
        mobile: 'secondary',
        cell: (row) => (
          <span className="vc-limit" data-empty={limitText(row) === '—'}>
            {limitText(row)}
          </span>
        ),
      },
      {
        id: 'score',
        header: 'Score',
        numeric: true,
        sortable: true,
        width: '8%',
        cell: (row) => (
          <span className="vc-score" data-tone={scoreTone(row)}>
            {scoreText(row)}
          </span>
        ),
      },
      {
        id: 'last',
        header: 'Activity',
        numeric: true,
        sortable: true,
        width: '14%',
        priority: 2,
        cell: (row) => (
          <span data-empty={row.lastTransactionAt == null}>
            {activityText(row.lastTransactionAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const firstLoad = roster.loading && !roster.data;
  // `creditworthy` is a composite rank with no column of its own, so the header pin sits on the
  // column each sort actually orders by.
  const sortColumn =
    sort === 'name' ? 'name' : sort === 'score' ? 'score' : sort === 'recent' ? 'last' : null;

  return (
    <div className="vc-page">
      <PageHead
        title="Existing clients"
        description="Every carrier company-wide, with the payment and credit terms on file."
        actions={
          <div className="vc-head-actions">
            <Input
              className="vc-search"
              type="search"
              icon="search"
              placeholder="Company, carrier id, contact…"
              aria-label="Search clients"
              value={filters.q}
              onChange={(e) => {
                setFilters((f) => ({ ...f, q: e.currentTarget.value }));
                setPage(1);
              }}
              onClear={() => setFilters((f) => ({ ...f, q: '' }))}
            />
            <Button
              variant={panelActive ? 'primary' : 'secondary'}
              icon="filter_alt"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              {panelActive ? 'Filters · on' : 'Filters'}
            </Button>
            <Button
              variant="secondary"
              icon="refresh"
              loading={roster.revalidating}
              onClick={() => void roster.reload()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="vc-bar">
        <div className="vc-bar-scopes">
          <Tabs
            items={SCOPES.map((s) => ({ value: s.id, label: s.label, count: counts[s.id] }))}
            value={scope}
            onValueChange={(next) => {
              setScope(next as Scope);
              setPage(1);
            }}
            variant="line"
            aria-label="Filter the roster by status"
          />
        </div>
        <div className="vc-bar-right">
          <span className="vc-updated">
            {roster.data ? `Updated ${formatCachedAt(roster.cachedAt) || 'just now'}` : 'No roster loaded'}
          </span>
          <Tabs
            items={[
              { value: 'table', label: 'Table' },
              { value: 'cards', label: 'Cards' },
            ]}
            value={view}
            onValueChange={(next) => setView(next as View)}
            variant="pill"
            size="sm"
            aria-label="Roster layout"
          />
        </div>
      </div>

      {filtersOpen ? (
        <div className="vc-filters">
          <Select
            label="Active"
            size="sm"
            value={filters.activity}
            onChange={(v) => set('activity', (v ?? 'all') as VerificationFilters['activity'])}
            options={[
              { value: 'all', label: 'Any time' },
              { value: '30', label: 'Last 30 days' },
              { value: '60', label: 'Last 60 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
          />
          <Select
            label="Payment"
            size="sm"
            value={filters.paymentTerms}
            onChange={(v) => set('paymentTerms', (v ?? 'all') as VerificationFilters['paymentTerms'])}
            options={[
              { value: 'all', label: 'All' },
              { value: 'LOC', label: 'LOC' },
              { value: 'Prepay', label: 'Prepay' },
              { value: 'none', label: 'Not set' },
            ]}
          />
          <Select
            label="Aggregator"
            size="sm"
            value={filters.companyType ?? 'all'}
            onChange={(v) => set('companyType', v === 'all' || v == null ? null : v)}
            // Derived from the loaded rows, so a new CMP rail appears here instead of vanishing.
            options={[
              { value: 'all', label: 'All' },
              ...companyTypes.map((t) => ({ value: t, label: railStyle(t).label })),
            ]}
          />
          <Select
            label="Cycle"
            size="sm"
            value={filters.billingCycleTag ?? 'all'}
            onChange={(v) => set('billingCycleTag', v === 'all' || v == null ? null : v)}
            options={[
              { value: 'all', label: 'All' },
              ...cycleTags.map((t) => ({ value: t, label: t })),
            ]}
          />
          <Select
            label="Sort"
            size="sm"
            value={sort}
            onChange={(v) => {
              if (v && isVerificationSort(v)) setSort(v);
            }}
            options={SORT_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          />
          <span className="vc-filters-gap" />
          {panelActive ? (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => {
                setFilters((f) => ({ ...EMPTY_VERIFICATION_FILTERS, q: f.q }));
                setPage(1);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {roster.error && rows.length === 0 && !firstLoad ? (
        <EmptyState
          size="page"
          tone="error"
          title="Could not load the roster"
          description={roster.error}
          primaryAction={
            <Button variant="primary" icon="refresh" onClick={() => void roster.reload()}>
              Try again
            </Button>
          }
        />
      ) : !firstLoad && scoped.length === 0 ? (
        <EmptyState
          size="page"
          icon="apartment"
          title="No clients match"
          description="Nothing in this activity window, payment type, debtor status or search. Clear the filters to see the full roster."
        />
      ) : view === 'cards' ? (
        <>
          <div className="vc-cards">
            {paged.map((row) => (
              <ClientCard key={row.carrierId} client={row} onOpen={open} />
            ))}
          </div>
          <RosterFoot
            shown={paged.length}
            total={counts.all}
            sort={sort}
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
            bare
          />
        </>
      ) : (
        <div className="vc-panel">
          <DataTable<VerificationClientRow>
            caption="Carrier roster"
            rows={paged}
            rowKey={(row) => row.carrierId}
            columns={columns}
            layout="fixed"
            density="compact"
            loading={firstLoad}
            onRowActivate={open}
            rowState={(row) => ({ className: `vc-row-${rowEdge(row)}` })}
            leading={(row) => (
              <span
                className="vc-rail-chip"
                style={{ ['--vc-rail' as string]: railStyle(row.companyType).tone }}
                aria-hidden="true"
              >
                <Icon name={railStyle(row.companyType).icon as IconName} size="sm" />
              </span>
            )}
            sort={{
              by: sortColumn,
              direction: 'descending',
              onSort: (columnId) => {
                if (columnId === 'name') setSort('name');
                else if (columnId === 'score') setSort('score');
                else if (columnId === 'last') setSort('recent');
                else setSort('creditworthy');
                setPage(1);
              },
            }}
            empty="No clients match. Clear the filters to see the full roster."
          />
          <RosterFoot
            shown={paged.length}
            total={counts.all}
            sort={sort}
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </div>
      )}

      {openClient ? (
        <ClientDetailDialog
          client={openClient}
          open={openId != null}
          tab={clientTab}
          onTabChange={setClientTab}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

function RosterFoot({
  shown,
  total,
  sort,
  page,
  pageCount,
  onPageChange,
  bare,
}: {
  shown: number;
  total: number;
  sort: VerificationSort;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Card view has no panel to sit inside, so the footer carries its own edge. */
  bare?: boolean;
}) {
  return (
    <div className="vc-foot" data-bare={bare === true}>
      <span className="vc-foot-count">
        Showing <strong className="num">{shown}</strong> of <strong className="num">{total}</strong> ·{' '}
        {sortLabel(sort)}
      </span>
      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        pageSize={PAGE_SIZE}
        total={total}
        itemLabel="carriers"
        size="sm"
      />
    </div>
  );
}
