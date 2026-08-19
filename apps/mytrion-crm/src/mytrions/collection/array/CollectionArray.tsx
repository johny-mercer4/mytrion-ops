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
import { KpiRowSkeleton, TableSkeleton } from '../CollectionSkeletons';
import { useCachedLoad } from '../../_shared/swrCache';
import { fmtDate, money } from '../collectionFormat';
import { ArrayDetail } from './ArrayDetail';
import { accountStatusLabel, reportAccountRef, reportInitials, reportName } from './arrayModel';
import { PaymentHistoryStrip } from './PaymentHistoryStrip';
import '../cases/cases.css';
import './array.css';

const PAGE_SIZE = 50;
/** Rows to draw while loading — a screenful, not the whole page. */
const SKELETON_ROWS = 12;

/** The Metro 2 code decides the tint: derogatory statuses are not neutral facts. */
function statusIntent(code: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (['13', '78', '84'].includes(code)) return 'success';
  if (['71', '80', '83', '93'].includes(code)) return 'danger';
  if (code === '11') return 'neutral';
  return 'warning';
}

/** A zero is a fact, not a figure — it recedes so the amounts that matter carry the column. */
function Money({ value, strong }: { value: string | null; strong?: boolean }) {
  const zero = !value || Number(value) === 0;
  return (
    <span className={`num${zero ? ' cc-muted' : strong ? ' cc-strong' : ''}`}>{money(value)}</span>
  );
}

export function CollectionArray({ onOpenCase }: { onOpenCase?: (caseId: string) => void }) {
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
        width: '22%',
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
                {reportAccountRef(row) ? ` · ${reportAccountRef(row)}` : ''}
              </span>
            </span>
          </span>
        ),
      },
      { id: 'period', header: 'Period', width: '7%', cell: (row) => <span className="num">{row.reportPeriod}</span> },
      {
        id: 'status',
        header: 'Account',
        width: '14%',
        mobile: 'secondary',
        cell: (row) =>
          row.accountStatus ? (
            <Badge intent={statusIntent(row.accountStatus)}>
              <span className="num ar-code">{row.accountStatus}</span>
              {accountStatusLabel(row.accountStatus)}
            </Badge>
          ) : (
            <span className="cc-muted">—</span>
          ),
      },
      {
        id: 'history',
        header: '12 mo',
        width: '11%',
        cell: (row) => (
          <PaymentHistoryStrip
            compact
            profile={row.paymentHistoryProfile}
            reportPeriod={row.reportPeriod}
          />
        ),
      },
      {
        id: 'balance',
        header: 'Balance',
        width: '11%',
        align: 'end',
        cell: (row) => <Money value={row.currentBalance} />,
      },
      {
        id: 'past',
        header: 'Past due',
        width: '11%',
        align: 'end',
        cell: (row) => <Money value={row.amountPastDue} strong />,
      },
      {
        id: 'agency',
        header: 'Agency',
        width: '13%',
        cell: (row) =>
          row.agencyName ? row.agencyName : <span className="cc-muted">Unplaced</span>,
      },
      {
        id: 'dob',
        header: 'DOB',
        width: '11%',
        cell: (row) =>
          row.needsDobLookup ? (
            <Badge intent="warning" icon="warning">
              No DOB
            </Badge>
          ) : (
            fmtDate(row.dateOfBirth)
          ),
      },
    ],
    [],
  );

  if (openId) {
    return (
      <ArrayDetail
        reportId={openId}
        onBack={() => setOpenId(null)}
        {...(onOpenCase ? { onOpenCase } : {})}
      />
    );
  }

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

      {agg ? (
        <KpiGrid>
          <KpiTile label="Tradelines" value={agg.total.toLocaleString('en-US')} />
          <KpiTile label="Need DOB" value={agg.needsDob.toLocaleString('en-US')} />
          <KpiTile label="With agency" value={agg.withAgency.toLocaleString('en-US')} />
        </KpiGrid>
      ) : (
        <KpiRowSkeleton count={3} label="Loading the Array snapshot totals" />
      )}

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

      {feed.loading && rows.length === 0 ? (
        <TableSkeleton
          label="Loading Array tradelines"
          rows={SKELETON_ROWS}
          density="compact"
          cols={[
            { kind: 'ident', w: '22%' },
            { kind: 'text', w: '7%', chars: 6 },
            { kind: 'chip', w: '14%' },
            { kind: 'meter', w: '11%' },
            { kind: 'num', w: '11%' },
            { kind: 'num', w: '11%' },
            { kind: 'text', w: '13%', chars: 10 },
            { kind: 'text', w: '11%', chars: 8 },
          ]}
        />
      ) : feed.error && rows.length === 0 ? null : !feed.loading && total === 0 ? (
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
