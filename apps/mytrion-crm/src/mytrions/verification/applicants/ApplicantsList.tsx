/**
 * New applicants — the queue.
 *
 * Red cases are LISTED, not hidden: "what am I waiting on?" is the desk's most useful question on a
 * slow morning, and a workable-only queue cannot answer it. A locked row is marked instead — a red
 * edge on the identity cell, a lock beside the name, and a "Blocked on" line that names the count.
 *
 * ONE FETCH, FILTERED IN THE BROWSER. `listDeskCases` returns the desk's whole working set inside
 * one 200-row page, so every chip, filter and sort below is instant and costs no round trip. The
 * scope counters come off the same rows as the table, so a tab can never disagree with what opening
 * it shows — the old queue took its five stat tiles from the server aggregate and its six chip
 * counts from the loaded rows, which are two different numbers wearing one label.
 *
 * `DataTable` rather than the raw `Table` primitives: identical markup on a desktop, and below the
 * 640px structure line it becomes the tap-to-open card list this queue would otherwise have to
 * hand-roll (CONVENTIONS — "reach for this before Table").
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Pagination,
  Select,
  Tabs,
  type BadgeIntent,
  type DataColumn,
  type IconName,
} from '@/ds';
import { getPolicy, listDeskCases, type VerificationCaseRow } from '@/api/verificationFlow';
import { initials as personInitials } from '@/lib/initials';
import { PageHead } from '../../_shared/page';
import { useCachedLoad } from '../../_shared/swrCache';
import { CaseView } from './CaseView';
import {
  ageDays,
  APPLICANT_LABEL,
  blockedOn,
  caseInitials,
  caseName,
  DECISION_SLA_DAYS,
  EMPTY_FILTERS,
  filtersActive,
  inScope,
  isLocked,
  phaseNumber,
  PHASE_SHORT,
  routeLabel,
  routeOf,
  SCOPES,
  selectRows,
  SORT_OPTIONS,
  statusLabel,
  type Filters,
  type Scope,
  type SortDir,
  type SortKey,
} from './applicantsModel';
import './applicants.css';

const PAGE_SIZE = 25;

/** The tenant's card cutoff moves about once a year; the queue re-reads it hourly at most. */
const STALE_POLICY = 60 * 60_000;

/** Status → chip treatment. Colour is never the only channel — each carries its own glyph. */
function statusChip(row: VerificationCaseRow): { intent: BadgeIntent; icon: IconName } {
  if (isLocked(row)) return { intent: 'danger', icon: 'lock' };
  switch (row.statusCode) {
    case 'pending_docs':
      return { intent: 'warning', icon: 'cloud_upload' };
    case 'manager_review':
    case 'additional_verification':
      return { intent: 'warning', icon: 'gavel' };
    case 'approved':
    case 'deposit_prepaid':
      return { intent: 'success', icon: 'check_circle' };
    case 'declined':
    case 'declined_customer':
    case 'declined_blacklist':
      return { intent: 'danger', icon: 'block' };
    case 'routed_wex':
      return { intent: 'info', icon: 'open_in_new' };
    default:
      return { intent: 'info', icon: 'bolt' };
  }
}

function money(value: string | null): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

export function ApplicantsList({
  initialCaseId,
  onCloseCase,
}: {
  initialCaseId?: string | null;
  onCloseCase?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(initialCaseId ?? null);
  const [scope, setScope] = useState<Scope>('open');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('age');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  const loadCases = useCallback(() => listDeskCases({ limit: 200 }), []);
  const cases = useCachedLoad('verification:flow:cases', loadCases);
  const loadPolicy = useCallback(() => getPolicy(), []);
  const policy = useCachedLoad('verification:flow:policy', loadPolicy, { staleMs: STALE_POLICY });

  const rows = useMemo(() => cases.data?.items ?? [], [cases.data]);
  const wexCardCutoff = policy.data?.wexCardCutoff ?? null;
  // One clock for the whole screen: ages in the table, in the filters and in the "blocked on"
  // sentence must agree, and a per-cell Date.now() lets them drift mid-render.
  const now = useMemo(() => Date.now(), [cases.data]);

  const counts = useMemo(() => {
    const out = {} as Record<Scope, number>;
    for (const s of SCOPES) out[s.id] = rows.filter((r) => inScope(r, s.id)).length;
    return out;
  }, [rows]);

  const visible = useMemo(
    () =>
      selectRows(rows, {
        scope,
        search,
        filters,
        sortKey,
        sortDir,
        wexCardCutoff,
        slaDays: DECISION_SLA_DAYS,
        now,
      }),
    [rows, scope, search, filters, sortKey, sortDir, wexCardCutoff, now],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const reset = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const columns = useMemo<DataColumn<VerificationCaseRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Applicant',
        rowHeader: true,
        sortable: true,
        width: '25%',
        mobile: 'primary',
        cell: (row) => (
          <span className="va-ident">
            <span className="va-mono" data-locked={isLocked(row)} aria-hidden="true">
              {caseInitials(row)}
            </span>
            <span className="va-ident-text">
              <span className="va-ident-name">
                {isLocked(row) ? (
                  <span className="va-lock" title="Locked — intake incomplete">
                    <Icon name="lock" size="sm" label="Locked" />
                  </span>
                ) : null}
                {/* The ellipsis needs its own block: the row above is a flex container (it seats the
                    lock glyph beside the name), and `text-overflow` does nothing to a flex item. */}
                <span className="va-ident-label">{caseName(row)}</span>
              </span>
              <span className="va-ident-sub">
                {APPLICANT_LABEL[row.applicantType ?? ''] ?? 'Type not set'} ·{' '}
                {routeLabel(routeOf(row, wexCardCutoff))}
              </span>
            </span>
          </span>
        ),
        mobileCell: (row) => caseName(row),
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        width: '15%',
        mobile: 'value',
        cell: (row) => {
          const chip = statusChip(row);
          return (
            <Badge intent={chip.intent} size="sm" icon={chip.icon}>
              {statusLabel(row)}
            </Badge>
          );
        },
      },
      {
        id: 'phase',
        header: 'Phase',
        sortable: true,
        width: '11%',
        priority: 2,
        cell: (row) => {
          const phase = phaseNumber(row.phaseCode);
          return (
            <span className="va-phase-cell">
              <span className="va-segs" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className="va-seg" data-on={i < phase} data-locked={isLocked(row)} />
                ))}
              </span>
              <span className="va-phase-cell-label">
                <span className="num" data-locked={isLocked(row)}>
                  {phase}
                </span>
                /10 · {PHASE_SHORT[row.phaseCode] ?? 'Intake'}
              </span>
            </span>
          );
        },
      },
      {
        id: 'blocked',
        header: 'Blocked on',
        width: '14%',
        priority: 3,
        mobile: 'secondary',
        cell: (row) => (
          <span
            className="va-blocked"
            data-tone={
              isLocked(row)
                ? 'danger'
                : row.statusCode === 'pending_docs' || row.statusCode === 'manager_review'
                  ? 'warning'
                  : 'plain'
            }
          >
            {blockedOn(row, DECISION_SLA_DAYS, now)}
          </span>
        ),
      },
      {
        id: 'trucks',
        header: 'Trucks',
        numeric: true,
        sortable: true,
        width: '6.5%',
        priority: 3,
        cell: (row) => row.trucksCount ?? '—',
      },
      {
        id: 'cards',
        header: 'Cards',
        numeric: true,
        sortable: true,
        width: '6.5%',
        priority: 3,
        cell: (row) => row.fuelCardsRequested ?? '—',
      },
      {
        id: 'limit',
        header: 'Limit',
        numeric: true,
        sortable: true,
        width: '9%',
        priority: 2,
        mobile: 'secondary',
        cell: (row) => money(row.approvedLimitAmount ?? row.requestedLimit),
      },
      {
        id: 'age',
        header: 'Age',
        numeric: true,
        sortable: true,
        width: '6%',
        cell: (row) => {
          const age = ageDays(row, now);
          return (
            <span className="va-age" data-late={age > DECISION_SLA_DAYS}>
              {age}d
            </span>
          );
        },
      },
      {
        id: 'owner',
        header: 'Owner',
        align: 'end',
        width: '7%',
        priority: 2,
        cell: (row) => (
          <span className="va-owner" title={row.ownerName}>
            <Avatar initials={personInitials(row.ownerName)} size="xs" />
          </span>
        ),
        mobileCell: () => null,
      },
    ],
    [wexCardCutoff, now],
  );

  if (openId) {
    return (
      <CaseView
        caseId={openId}
        onBack={() => {
          setOpenId(null);
          onCloseCase?.();
          void cases.reload();
        }}
      />
    );
  }

  const sortLabel = `${(columns.find((c) => c.id === sortKey)?.header ?? 'age')
    .toString()
    .toLowerCase()} ${sortDir === 'asc' ? 'ascending' : 'descending'}`;

  return (
    <div className="va-list">
      <PageHead
        title="New applicants"
        description="The 10-phase underwriting flow, from intake through to the credit decision."
        actions={
          <div className="va-head-actions">
            <Input
              className="va-search"
              type="search"
              icon="search"
              placeholder="Company, EIN, MC, owner…"
              aria-label="Search applicants"
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setPage(1);
              }}
              onClear={() => setSearch('')}
            />
            <Button
              variant={filtersActive(filters) ? 'primary' : 'secondary'}
              icon="filter_alt"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              {filtersActive(filters) ? 'Filters · on' : 'Filters'}
            </Button>
            <Button
              variant="secondary"
              icon="refresh"
              loading={cases.revalidating}
              onClick={() => void cases.reload()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <Tabs
        items={SCOPES.map((s) => ({ value: s.id, label: s.label, count: counts[s.id] ?? 0 }))}
        value={scope}
        onValueChange={(value) => {
          setScope(value as Scope);
          setPage(1);
        }}
        variant="line"
        aria-label="Filter applicants by state"
      />

      {filtersOpen ? (
        <div className="va-filters">
          <Select
            label="Type"
            size="sm"
            value={filters.type}
            onChange={(v) => reset('type', v ?? 'all')}
            options={[
              { value: 'all', label: 'All' },
              { value: 'owner_operator', label: 'Owner-operator' },
              { value: 'carrier', label: 'Carrier' },
              { value: 'company', label: 'Company' },
            ]}
          />
          <Select
            label="Route"
            size="sm"
            value={filters.route}
            onChange={(v) => reset('route', v ?? 'all')}
            options={[
              { value: 'all', label: 'All' },
              { value: 'octane_internal', label: 'Octane internal' },
              { value: 'wex', label: 'WEX route' },
              { value: 'none', label: 'Not set' },
            ]}
          />
          <Select
            label="Stage"
            size="sm"
            value={filters.stage}
            onChange={(v) => reset('stage', (v ?? 'all') as Filters['stage'])}
            options={[
              { value: 'all', label: 'All ten' },
              { value: 'intake', label: 'Intake & identity · 1–3' },
              { value: 'authority', label: 'Authority & routing · 4–5' },
              { value: 'credit', label: 'Credit & hard stops · 6–7' },
              { value: 'decision', label: 'Risk & decision · 8–10' },
            ]}
          />
          <Select
            label="Age"
            size="sm"
            value={filters.age}
            onChange={(v) => reset('age', (v ?? 'all') as Filters['age'])}
            options={[
              { value: 'all', label: 'Any age' },
              { value: 'today', label: 'Today' },
              { value: 'inside', label: `Inside SLA · ≤${DECISION_SLA_DAYS}d` },
              { value: 'late', label: `Past SLA · ${DECISION_SLA_DAYS + 1}d +` },
            ]}
          />
          <Select
            label="Sort"
            size="sm"
            value={sortKey}
            onChange={(v) => {
              const next = (v ?? 'age') as SortKey;
              setSortKey(next);
              setSortDir(next === 'name' ? 'asc' : 'desc');
            }}
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <span className="va-filters-gap" />
          {filtersActive(filters) ? (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {cases.error ? (
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-title">Could not load the queue</span>
          <p className="va-banner-body">{cases.error}</p>
        </div>
      ) : null}

      {!cases.loading && rows.length === 0 && !cases.error ? (
        <EmptyState
          size="page"
          icon="inbox"
          title="No applications yet"
          description="Applications appear here once a Sales agent completes intake. Until then the case is listed but locked — nothing is hidden from this queue."
        />
      ) : (
        <div className="va-panel">
          <DataTable<VerificationCaseRow>
            caption="New applicant queue"
            rows={paged}
            rowKey={(row) => row.id}
            columns={columns}
            layout="fixed"
            density="compact"
            loading={cases.loading}
            sort={{
              by: sortKey,
              direction: sortDir === 'asc' ? 'ascending' : 'descending',
              onSort: (columnId, next) => {
                setSortKey(columnId as SortKey);
                setSortDir(next === 'ascending' ? 'asc' : 'desc');
                setPage(1);
              },
            }}
            onRowActivate={(row) => setOpenId(row.id)}
            rowState={(row) => ({
              className: isLocked(row)
                ? 'va-row-locked'
                : row.closedAt
                  ? 'va-row-closed'
                  : row.statusCode === 'pending_docs' || row.statusCode === 'manager_review'
                    ? 'va-row-blocked'
                    : '',
            })}
            leading={(row) => (
              <span className="va-mono" data-locked={isLocked(row)} aria-hidden="true">
                {caseInitials(row)}
              </span>
            )}
            empty={
              filtersActive(filters) || search.trim() !== ''
                ? 'Nothing matches this search and these filters. Clear them to see the rest of the desk.'
                : 'Nothing in this state right now. Try another tab.'
            }
          />

          <div className="va-foot">
            <span className="va-foot-count">
              Showing <strong className="num">{paged.length}</strong> of{' '}
              <strong className="num">{visible.length}</strong> · sorted by {sortLabel}
            </span>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPageChange={setPage}
              pageSize={PAGE_SIZE}
              total={visible.length}
              itemLabel="applications"
              size="sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
