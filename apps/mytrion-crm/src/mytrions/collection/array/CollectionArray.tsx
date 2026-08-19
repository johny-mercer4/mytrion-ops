/**
 * Collection → Agency → Array Reports. Server-paged list — the book is 9k+ rows.
 *
 * Renamed, not rewritten: this is the OUTPUT of the monthly Metro 2 filing and it works. The work
 * that happens BEFORE a filing moved to its own screen (`agency/PlacementQueue`), which is what
 * the old "Array Reports" tab was missing rather than getting wrong.
 *
 * Pattern is Mytrion Watch: filter+page cache key, lastGood so a filter change does not
 * blank the table, tiles describe the WHOLE snapshot, never the current page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, DataTable, EmptyState, ErrorState, Input, Pagination, Select, type DataColumn } from '@/ds';
import {
  listArrayFacets,
  listArrayReports,
  type ArrayReportListResult,
  type ArrayReportRow,
} from '@/api/collection';
import { PageHead, KpiGrid, KpiTile } from '../../_shared/page';
import { useCachedLoad } from '../../_shared/swrCache';
import { fmtDate, money } from '../collectionFormat';
import { ArrayDetail } from './ArrayDetail';
import { accountStatusLabel, reportInitials, reportName } from './arrayModel';
import '../cases/cases.css';
import './array.css';

const PAGE_SIZE = 50;
const LOADING_MIN_HEIGHT = `${PAGE_SIZE * 45 + 34}px`;

export function CollectionArray() {
  const [period, setPeriod] = useState('all');
  const [status, setStatus] = useState('all');
  const [agency, setAgency] = useState('all');
  const [dob, setDob] = useState<'all' | 'yes' | 'no'>('all');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => setPage(1), [period, status, agency, dob, search]);

  const loadFacets = useCallback(() => listArrayFacets(), []);
  const facets = useCachedLoad('collection:array:facets', loadFacets, { staleMs: 10 * 60_000 });

  const load = useCallback(
    () =>
      listArrayReports({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        ...(period !== 'all' ? { reportPeriod: period } : {}),
        ...(status !== 'all' ? { accountStatus: status } : {}),
        ...(agency !== 'all' ? { agency } : {}),
        ...(dob === 'yes' ? { needsDobLookup: true } : {}),
        ...(dob === 'no' ? { needsDobLookup: false } : {}),
        ...(search ? { search } : {}),
      }),
    [page, period, status, agency, dob, search],
  );
  const feed = useCachedLoad(
    `collection:array:${period}:${status}:${agency}:${dob}:${search}:${page}`,
    load,
  );

  const lastGood = useRef<ArrayReportListResult | null>(null);
  if (feed.data) lastGood.current = feed.data;
  const shown = feed.data ?? lastGood.current;
  const rows = shown?.items ?? [];
  const total = shown?.total ?? 0;
  const agg = shown?.aggregates;
  const filtered = period !== 'all' || status !== 'all' || agency !== 'all' || dob !== 'all' || Boolean(search);
  const stale = feed.loading && feed.data === null && rows.length > 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns = useMemo<DataColumn<ArrayReportRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Carrier',
        rowHeader: true,
        width: '26%',
        mobile: 'primary',
        cell: (row) => (
          <span className="cc-ident">
            <span className="cc-mono" aria-hidden="true">
              {reportInitials(row)}
            </span>
            <span className="cc-ident-text">
              <span className="cc-ident-name">
                <span className="cc-ident-label">{reportName(row)}</span>
              </span>
              <span className="cc-ident-sub">
                {row.carrierId}
                {row.customerAccountNumber ? ` · ${row.customerAccountNumber}` : ''}
              </span>
            </span>
          </span>
        ),
      },
      { id: 'period', header: 'Period', width: '10%', cell: (row) => row.reportPeriod },
      {
        id: 'status',
        header: 'Account',
        width: '14%',
        mobile: 'secondary',
        cell: (row) => accountStatusLabel(row.accountStatus),
      },
      {
        id: 'balance',
        header: 'Balance',
        width: '12%',
        align: 'end',
        cell: (row) => <span className="num">{money(row.currentBalance)}</span>,
      },
      {
        id: 'past',
        header: 'Past due',
        width: '12%',
        align: 'end',
        cell: (row) => <span className="num">{money(row.amountPastDue)}</span>,
      },
      {
        id: 'agency',
        header: 'Agency',
        width: '14%',
        cell: (row) => row.agencyName ?? '—',
      },
      {
        id: 'dob',
        header: 'DOB',
        width: '8%',
        cell: (row) =>
          row.needsDobLookup ? (
            <Badge intent="warning" icon="warning">
              Needs DOB
            </Badge>
          ) : (
            fmtDate(row.dateOfBirth)
          ),
      },
    ],
    [],
  );

  if (openId) return <ArrayDetail reportId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="cc-list" data-stale={stale ? 'true' : undefined}>
      <PageHead
        kicker="Collection · Agency"
        title="Array reports"
        description="Metro 2 tradelines placed with Array — a snapshot, not the live Zoho write."
        actions={
          <div className="cc-head-actions">
            <Input
              className="cc-search"
              type="search"
              icon="search"
              placeholder="Company, carrier, account…"
              aria-label="Search array reports"
              value={term}
              onChange={(e) => setTerm(e.currentTarget.value)}
              onClear={() => setTerm('')}
            />
            <Button
              variant="secondary"
              icon="refresh"
              loading={feed.revalidating}
              onClick={() => void feed.reload()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <KpiGrid>
        <KpiTile label="Tradelines" value={String(agg?.total ?? '—')} />
        <KpiTile label="Need DOB" value={String(agg?.needsDob ?? '—')} />
        <KpiTile label="With agency" value={String(agg?.withAgency ?? '—')} />
      </KpiGrid>

      {feed.error && rows.length === 0 ? (
        <ErrorState
          size="page"
          title="Could not load Array reports"
          description="Retry the request, or check that you can reach Collection."
          primaryAction={
            <Button variant="primary" onClick={() => void feed.reload()}>
              Retry
            </Button>
          }
        />
      ) : feed.error ? (
        <div className="cc-banner" data-tone="danger" role="alert">
          <span className="cc-banner-title">Could not load Array reports</span>
          <p className="cc-banner-body">{String(feed.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => void feed.reload()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="ar-filters">
        <Select
          label="Period"
          size="sm"
          value={period}
          onChange={(v) => setPeriod(v ?? 'all')}
          options={[
            { value: 'all', label: 'All periods' },
            ...(facets.data?.periods ?? []).map((p) => ({ value: p, label: p })),
          ]}
        />
        <Select
          label="Account status"
          size="sm"
          value={status}
          onChange={(v) => setStatus(v ?? 'all')}
          options={[
            { value: 'all', label: 'All statuses' },
            ...(facets.data?.accountStatuses ?? []).map((s) => ({
              value: s,
              label: accountStatusLabel(s),
            })),
          ]}
        />
        <Select
          label="Agency"
          size="sm"
          value={agency}
          onChange={(v) => setAgency(v ?? 'all')}
          options={[
            { value: 'all', label: 'All agencies' },
            { value: 'none', label: 'Unplaced' },
            ...(facets.data?.agencies ?? []).map((a) => ({ value: a, label: a })),
          ]}
        />
        <Select
          label="DOB lookup"
          size="sm"
          value={dob}
          onChange={(v) => setDob((v ?? 'all') as 'all' | 'yes' | 'no')}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'yes', label: 'Needs DOB' },
            { value: 'no', label: 'Has DOB' },
          ]}
        />
      </div>

      {feed.error && rows.length === 0 ? null : !feed.loading && total === 0 ? (
        <EmptyState
          size="page"
          icon="inbox"
          title={filtered ? 'No reports match' : 'No Array reports'}
          description={
            filtered
              ? 'Nothing matches these filters. Clear them to see the book.'
              : 'Tradelines appear after the Array snapshot lands.'
          }
        />
      ) : (
        <div className="cc-panel">
          <DataTable<ArrayReportRow>
            caption="Array reports"
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            layout="fixed"
            density="compact"
            loading={feed.loading && rows.length === 0}
            {...(feed.loading && rows.length === 0
              ? { scrollerStyle: { minBlockSize: LOADING_MIN_HEIGHT } }
              : {})}
            onRowActivate={(row) => setOpenId(row.id)}
            empty={filtered ? 'Nothing matches. Clear the filters.' : 'No tradelines in this snapshot.'}
          />
          <div className="cc-foot">
            <span className="cc-foot-count">
              Showing{' '}
              <strong className="num">
                {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(total, (page - 1) * PAGE_SIZE + rows.length)}
              </strong>{' '}
              of <strong className="num">{total}</strong>
            </span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={stale} />
          </div>
        </div>
      )}
    </div>
  );
}
