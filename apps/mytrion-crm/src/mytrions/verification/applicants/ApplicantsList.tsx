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
  salesOwnerLabel,
  salesOwnerName,
  SCOPES,
  verificationOwnerName,
  selectRows,
  SORT_OPTIONS,
  statusLabel,
  statusShort,
  type Filters,
  type Scope,
  type SortDir,
  type SortKey,
} from './applicantsModel';
import './applicants.css';

/**
 * 15, not 25. Comfortable rows measure 66px, so a 25-row page is 1,650px of table — four screens of
 * scroll to reach a paginator, on a queue that has never left the teens. At 15 the page is about one
 * screen and the control is reachable without scrolling to it.
 */
const PAGE_SIZE = 15;

/**
 * Height reserved for the table while it loads.
 *
 * `DataTable`'s table-mode loading state is a single `TableMessageRow` — `skeletonRows` is card-mode
 * only — so the panel stands ~90px tall and then leaps to a full page when the rows land. Measured:
 * the queue jumped 645px and the roster 999px, both under the reader's cursor.
 *
 * Sized to a FULL page, which is now also the most the table can hold, so a full first page lands
 * with no movement at all. Measured in Chrome at 1440px: comfortable row 66px, header 37px.
 */
const LOADING_MIN_HEIGHT = `${PAGE_SIZE * 66 + 37}px`;

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
  /** The desk's Verification agent, from the same policy load the route cutoff comes from. */
  const deskOwner = policy.data?.verificationOwner?.name ?? null;
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
        width: '22%',
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
                <span className="va-ident-label" title={caseName(row)}>
                  {caseName(row)}
                </span>
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
        // `Badge` is `white-space: nowrap` by design, so a chip wider than its column does not wrap
        // or clip — it paints over the next cell. Two things keep it in: `statusShort` (the design's
        // own one-word label rather than the endpoint's stitched phrase) and the wrapper's
        // `min-width: 0` + ellipsis, which is what makes the width not load-bearing.
        width: '12%',
        mobile: 'value',
        cell: (row) => {
          const chip = statusChip(row);
          return (
            <span className="va-status-cell" title={statusLabel(row)}>
              <Badge intent={chip.intent} size="sm" icon={chip.icon}>
                <span className="va-status-label">{statusShort(row)}</span>
              </Badge>
            </span>
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
        width: '12%',
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
        mobileCell: (row) => blockedOn(row, DECISION_SLA_DAYS, now),
      },
      {
        id: 'trucks',
        header: 'Trucks',
        numeric: true,
        sortable: true,
        // 6.5%, the design's own track. A numeric header is its LABEL plus a sort glyph — "TRUCKS"
        // with the arrows is 64px at 1280, and a 5% track (49px) let the glyph overflow left into
        // "Blocked on". The values are one digit; the header is what sets the floor here.
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
        width: '7%',
        priority: 2,
        cell: (row) => money(row.approvedLimitAmount ?? row.requestedLimit),
      },
      {
        id: 'age',
        header: 'Age',
        numeric: true,
        sortable: true,
        width: '5%',
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
        header: 'Sales owner',
        sortable: true,
        width: '18%',
        priority: 2,
        // The NAME, not just a mark. Two initials in a circle is unreadable as an identity — the desk
        // has to know which Sales agent to chase, and hovering 17 rows to find out is not reading.
        // `xs`, not `sm`: at 1280 the column has ~126px of content box, and a 24px mark with a 8px
        // gap left too little for "Islombek Mamurov". `title` recovers the rest of a long name.
        //
        // BOTH owners, in two lines. The header names the first; the second labels itself, because
        // "Sarvar Asqarov" alone under a Sales heading is exactly the confusion this column had. It
        // costs no row height — the applicant cell beside it is already two taller lines — and the
        // sub-line reads `Desk pool` rather than a name whenever no credit agent holds the case.
        cell: (row) => (
          <span className="va-owners">
            <span className="va-owner" title={salesOwnerLabel(row)} data-empty={!salesOwnerName(row)}>
              {salesOwnerName(row) ? (
                <Avatar initials={personInitials(salesOwnerName(row) ?? '')} size="xs" />
              ) : (
                <Icon name="person" size="sm" className="va-owner-none" />
              )}
              <span className="va-owner-name">{salesOwnerLabel(row)}</span>
            </span>
            {/* Absent, not a placeholder, when the desk agent is unknown: a stand-in word sitting
                under a Sales agent's name reads as if it described HIM. */}
            {verificationOwnerName(row, deskOwner) ? (
              <span
                className="va-owner-sub"
                title={`Verification · ${verificationOwnerName(row, deskOwner) ?? ''}`}
              >
                Verification ·{' '}
                <span className="va-owner-sub-name">{verificationOwnerName(row, deskOwner)}</span>
              </span>
            ) : null}
          </span>
        ),
        mobile: 'secondary',
        mobileCell: (row) => salesOwnerLabel(row),
      },
    ],
    [wexCardCutoff, deskOwner, now],
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
        title="Verification Case"
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
          description="Applications appear once Sales starts intake. Locked ones are listed too."
        />
      ) : (
        <div className="va-panel">
          <DataTable<VerificationCaseRow>
            caption="New applicant queue"
            rows={paged}
            rowKey={(row) => row.id}
            columns={columns}
            layout="fixed"
            density="comfortable"
            loading={cases.loading}
            {...(cases.loading && !cases.data
              ? { scrollerStyle: { minBlockSize: LOADING_MIN_HEIGHT } }
              : {})}
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
                ? 'Nothing matches. Clear the filters.'
                : 'Nothing in this state.'
            }
          />

          <div className="va-foot">
            {/* ONE summary. `Pagination` renders its own "Showing X–Y of Z" when handed `total` and
                `pageSize`, which put two counts of the same rows side by side. It gets neither, so
                it renders controls only and this line is the single count. */}
            <span className="va-foot-count">
              Showing{' '}
              <strong className="num">
                {visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–
                {(currentPage - 1) * PAGE_SIZE + paged.length}
              </strong>{' '}
              of <strong className="num">{visible.length}</strong> · sorted by {sortLabel}
            </span>
            <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
