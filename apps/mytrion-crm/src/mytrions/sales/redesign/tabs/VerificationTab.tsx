/**
 * Sales "Verification" tab — the agent's own credit applications, on Mytrion's own database.
 *
 * Applications are NOT started here. The Zoho Deal poller creates them
 * (`automation.verification.case-ingest`) and assigns them to the Deal's owner; this tab is where
 * that agent completes intake and then watches underwriting.
 *
 * SAME QUEUE, SAME SHAPE AS THE DESK. This reads `/verification/applications`, which returns the
 * same `VerificationCaseRow` the Verification desk's own queue reads, so the surface is the desk's
 * `applicants` list — the mono identity tile, the status chip, the ten-segment phase meter, the age
 * — rendered from `applicants.css` and `ds/DataTable` rather than from a second card grid that
 * happened to describe the same row. A case looks the same on both desks because it IS the same row.
 *
 * `data-mytrion="verification"` on the queue root is what brings that stylesheet alive: every `.va-*`
 * rule is scoped under it. It binds `--badge-tone` and nothing else (see `styles/global.css`), which
 * no `.va-*` rule and no `ds/Badge` intent reads — the Sales identity badge lives in the shell
 * header, outside this subtree. Same hosting trick `VerificationProgress` already uses for the spine.
 *
 * WHAT SALES DOES NOT SEE. No findings, no phase verdicts, no decision controls, and not the desk's
 * "Blocked on" sentence — the agent gets `askFor`, which says what THEY owe. The credit agent's name
 * is the desk's business too; the only owner named here is a Sales colleague whose Deal this is.
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
  Tabs,
  type BadgeIntent,
  type DataColumn,
  type IconName,
} from '@/ds';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { listApplications, type VerificationCaseRow } from '@/api/verificationFlow';
import { initials as personInitials } from '@/lib/initials';
import { NAV_DESC } from '../salesData';
import { useCachedLoad } from '../dcCache';
import { SalesPage, SalesPageHead } from '../SalesPage';
import { ApplicationIntake } from '../applicationIntake';
import { VerificationDeskSurface } from '../verificationDeskScope';
import {
  ageDays,
  caseInitials,
  caseName,
  isLocked,
  money,
  phaseNumber,
  routeLabel,
  salesOwnerLabel,
  salesOwnerName,
  statusShort,
} from '../../../verification/applicants/applicantsModel';
import {
  anotherAgentsDeal,
  applicantLabel,
  askFor,
  inSalesScope,
  salesPhaseLabel,
  SALES_SCOPES,
  selectSalesRows,
  type SalesScope,
  type SalesSortDir,
  type SalesSortKey,
} from '../salesVerificationQueue';
import '../../../verification/applicants/applicants.css';

/**
 * The whole book in one page, filtered in the browser.
 *
 * 24 was the old card grid's page and it is not enough here: the scope tabs carry counts, and a count
 * taken over the first 24 of 40 rows is a number that contradicts the tab it labels. 200 is the
 * route's own cap (`listQuery` in `verificationApplications.routes.ts`) and two orders of magnitude
 * above any agent's book.
 */
const FETCH_LIMIT = 200;

/** 15 rows, the desk's own page. A comfortable row is 66px, so a page is about one screen. */
const PAGE_SIZE = 15;

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

/** The ask line's tone → the `.va-blocked` data attribute that colours it. */
const ASK_TONE: Record<ReturnType<typeof askFor>['tone'], string> = {
  danger: 'danger',
  warn: 'warning',
  ok: 'plain',
  none: 'plain',
};

/**
 * Column tracks, as two sets rather than one with holes.
 *
 * The Sales-owner column only exists on a page that actually contains a colleague's Deal (see the
 * column's own note), and `layout="fixed"` needs the remaining tracks to add up to 100 either way —
 * a set that leaves 14% unclaimed hands the slack to whichever column has the longest content.
 */
const TRACKS_WITH_OWNER = {
  name: '19%',
  status: '15%',
  phase: '14%',
  ask: '14%',
  trucks: '6%',
  cards: '6%',
  limit: '7%',
  age: '5%',
  // The point of this column is the NAME — at 11% it read "Robert T…", which identifies nobody.
  owner: '14%',
} as const;

const TRACKS = {
  name: '25%',
  status: '16%',
  phase: '15%',
  ask: '18%',
  trucks: '7%',
  cards: '7%',
  limit: '7%',
  age: '5%',
  owner: '0',
} as const;

/**
 * Whose list this is — the View-as target when one is picked, else the signed-in worker.
 *
 * Used for one thing: deciding whether a Sales owner is worth naming. A case reaches an agent three
 * ways — they submitted it, they were ASSIGNED it, or they own the Zoho Deal — so a row in your list
 * can belong to a different agent, and that is when you need the name. Naming yourself on every row
 * would be noise.
 */
function viewerZohoId(): string | null {
  return getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? null;
}

export function VerificationTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [scope, setScope] = useState<SalesScope>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SalesSortKey>('age');
  const [sortDir, setSortDir] = useState<SalesSortDir>('desc');
  const [page, setPage] = useState(1);

  const load = useCallback(() => listApplications({ limit: FETCH_LIMIT }), []);
  const { data, loading, error, revalidating, reload } = useCachedLoad(
    'sales:verification:applications',
    load,
  );

  const rows = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const viewer = viewerZohoId();
  // One clock for the whole screen: the ages in the table and the sort that orders them must agree,
  // and a per-cell Date.now() lets them drift mid-render.
  const now = useMemo(() => Date.now(), [data]);

  const counts = useMemo(() => {
    const out = {} as Record<SalesScope, number>;
    for (const s of SALES_SCOPES) out[s.id] = rows.filter((r) => inSalesScope(r, s.id)).length;
    return out;
  }, [rows]);

  const visible = useMemo(
    () => selectSalesRows(rows, { scope, search, sortKey, sortDir, now }),
    [rows, scope, search, sortKey, sortDir, now],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /**
   * The owner column exists only when the page holds somebody else's Deal.
   *
   * On your own book every cell would read your own name, which is a column of noise — and the
   * question it answers ("do I have to fill this in, or has it moved to Robert?") only has an answer
   * worth a track when the answer is sometimes no.
   */
  const showOwner = paged.some((row) => anotherAgentsDeal(row, viewer));
  const track = showOwner ? TRACKS_WITH_OWNER : TRACKS;

  const columns = useMemo<DataColumn<VerificationCaseRow>[]>(() => {
    const base: DataColumn<VerificationCaseRow>[] = [
      {
        id: 'name',
        header: 'Applicant',
        rowHeader: true,
        sortable: true,
        width: track.name,
        mobile: 'primary',
        cell: (row) => (
          <span className="va-ident">
            <span className="va-mono" data-locked={isLocked(row)} aria-hidden="true">
              {caseInitials(row)}
            </span>
            <span className="va-ident-text">
              <span className="va-ident-name">
                {isLocked(row) ? (
                  <span className="va-lock" title="Not submitted — intake incomplete">
                    <Icon name="lock" size="sm" label="Not submitted" />
                  </span>
                ) : null}
                {/* The ellipsis needs its own block: the row above is a flex container (it seats the
                    lock glyph beside the name), and `text-overflow` does nothing to a flex item. */}
                <span className="va-ident-label" title={caseName(row)}>
                  {caseName(row)}
                </span>
              </span>
              <span className="va-ident-sub">
                {applicantLabel(row.applicantType)}
                {/* The route is only worth a mention when it LEAVES Octane — "Octane internal" on
                    every other row is a column of the default. */}
                {row.underwritingRoute === 'wex' ? ` · ${routeLabel('wex')}` : ''}
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
        // `Badge` is `white-space: nowrap` by design, so a chip wider than its column paints over the
        // next cell rather than wrapping. `statusShort` (one word) plus the wrapper's `min-width: 0`
        // and ellipsis is what keeps the width from being load-bearing.
        width: track.status,
        mobile: 'value',
        cell: (row) => {
          const chip = statusChip(row);
          return (
            <span className="va-status-cell" title={row.statusLabel ?? row.statusCode}>
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
        width: track.phase,
        priority: 2,
        cell: (row) => {
          const phase = phaseNumber(row.phaseCode);
          const label = salesPhaseLabel(row.phaseCode);
          return (
            <span className="va-phase-cell">
              <span className="va-segs" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className="va-seg" data-on={i < phase} data-locked={isLocked(row)} />
                ))}
              </span>
              <span className="va-phase-cell-label" title={label.full}>
                <span className="num" data-locked={isLocked(row)}>
                  {phase}
                </span>
                /10 · {label.short}
              </span>
            </span>
          );
        },
      },
      {
        id: 'ask',
        // The desk's column here is "Blocked on" and says what somebody else is waiting for. This one
        // is addressed to the reader, so it is a second person heading and a second person sentence.
        header: 'Needs from you',
        width: track.ask,
        priority: 3,
        mobile: 'secondary',
        cell: (row) => {
          const ask = askFor(row);
          return (
            <span className="va-blocked" data-tone={ASK_TONE[ask.tone]}>
              {ask.text}
            </span>
          );
        },
        mobileCell: (row) => askFor(row).text,
      },
      {
        id: 'trucks',
        header: 'Trucks',
        numeric: true,
        sortable: true,
        width: track.trucks,
        priority: 3,
        cell: (row) => row.trucksCount ?? '—',
      },
      {
        id: 'cards',
        header: 'Cards',
        numeric: true,
        sortable: true,
        width: track.cards,
        priority: 3,
        cell: (row) => row.fuelCardsRequested ?? '—',
      },
      {
        id: 'limit',
        header: 'Limit',
        numeric: true,
        sortable: true,
        width: track.limit,
        priority: 2,
        cell: (row) => money(row.approvedLimitAmount ?? row.requestedLimit),
      },
      {
        id: 'age',
        header: 'Age',
        numeric: true,
        sortable: true,
        width: track.age,
        cell: (row) => <span className="va-age">{ageDays(row, now)}d</span>,
      },
    ];

    if (!showOwner) return base;
    return [
      ...base,
      {
        id: 'owner',
        header: 'Sales owner',
        width: track.owner,
        priority: 2,
        mobile: 'secondary',
        // The NAME, not just a mark: two initials in a circle identifies nobody, and the point of
        // this column is knowing the application moved to a colleague. Blank on your own rows rather
        // than repeating your name — the absence IS the answer.
        cell: (row) =>
          anotherAgentsDeal(row, viewer) ? (
            <span className="va-owner" title={salesOwnerLabel(row)}>
              <Avatar initials={personInitials(salesOwnerName(row) ?? '')} size="xs" />
              <span className="va-owner-name">{salesOwnerLabel(row)}</span>
            </span>
          ) : (
            ''
          ),
        mobileCell: (row) => (anotherAgentsDeal(row, viewer) ? salesOwnerLabel(row) : ''),
      },
    ];
  }, [track, now, showOwner, viewer]);

  if (openId) {
    return (
      <SalesPage>
        <ApplicationIntake
          applicationId={openId}
          onBack={() => {
            setOpenId(null);
            void reload();
          }}
        />
      </SalesPage>
    );
  }

  const sortLabel = `${(columns.find((c) => c.id === sortKey)?.header ?? 'age')
    .toString()
    .toLowerCase()} ${sortDir === 'asc' ? 'ascending' : 'descending'}`;

  return (
    <SalesPage busy={loading}>
      <SalesPageHead
        description={NAV_DESC.verification}
        /* Direct children of `.ss-page-actions`, which is already the flex row with the gap. A
           wrapper carrying the desk's `.va-head-actions` gets NO styling here: every `.va-*` rule is
           a descendant of `[data-mytrion='verification']`, and the page head is outside that root. */
        actions={
          <>
            <Input
              className="ss-vf-q"
              type="search"
              icon="search"
              placeholder="Company, EIN, MC, DOT…"
              aria-label="Search your applications"
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setPage(1);
              }}
              onClear={() => setSearch('')}
            />
            <Button variant="secondary" icon="refresh" loading={revalidating} onClick={() => void reload()}>
              Refresh
            </Button>
          </>
        }
      />

      <VerificationDeskSurface>
        <div className="va-list">
        <Tabs
          items={SALES_SCOPES.map((s) => ({ value: s.id, label: s.label, count: counts[s.id] ?? 0 }))}
          value={scope}
          onValueChange={(value) => {
            setScope(value as SalesScope);
            setPage(1);
          }}
          variant="line"
          aria-label="Filter applications by state"
        />

        {error ? (
          <div className="va-banner" data-tone="danger" role="alert">
            <span className="va-banner-glyph" aria-hidden="true">
              <Icon name="error" size="sm" />
            </span>
            <span className="va-banner-text">
              <span className="va-banner-title">Could not load your applications</span>
              <p className="va-banner-body">{String(error)}</p>
            </span>
          </div>
        ) : null}

        {/* One loader per surface: `loading` is only true when there is nothing to show, and the
            DataTable owns it. A revalidation keeps the rows and reports on the Refresh button. */}
        {!loading && rows.length === 0 && !error ? (
          <EmptyState
            size="page"
            icon="inbox"
            title="No applications yet"
            description="Applications are created automatically from your Deals in Zoho — you do not start one here. When a Deal reaches an application stage it appears in this list, red, waiting for you to fill in the details and upload the documents."
          />
        ) : (
          <div className="va-panel">
            <DataTable<VerificationCaseRow>
              caption="Your credit applications"
              rows={paged}
              rowKey={(row) => row.id}
              columns={columns}
              layout="fixed"
              density="comfortable"
              loading={loading}
              skeletonRows={PAGE_SIZE}
              sort={{
                by: sortKey,
                direction: sortDir === 'asc' ? 'ascending' : 'descending',
                onSort: (columnId, next) => {
                  setSortKey(columnId as SalesSortKey);
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
                    : row.statusCode === 'pending_docs'
                      ? 'va-row-blocked'
                      : '',
              })}
              leading={(row) => (
                <span className="va-mono" data-locked={isLocked(row)} aria-hidden="true">
                  {caseInitials(row)}
                </span>
              )}
              empty={
                search.trim() !== ''
                  ? 'Nothing matches that search.'
                  : 'Nothing in this filter. Try another.'
              }
            />

            <div className="va-foot">
              {/* ONE summary. `Pagination` renders its own "Showing X–Y of Z" when handed `total` and
                  `pageSize`, which puts two counts of the same rows side by side. It gets neither.
                  And no count at all while the rows are still coming: "Showing 0–0 of 0" over a panel
                  of skeletons is a real figure asserting the agent has no applications. */}
              <span className="va-foot-count">
                {loading ? (
                  'Loading your applications…'
                ) : (
                  <>
                    Showing{' '}
                    <strong className="num">
                      {visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–
                      {(currentPage - 1) * PAGE_SIZE + paged.length}
                    </strong>{' '}
                    of <strong className="num">{visible.length}</strong> · sorted by {sortLabel}
                    {/* NO SILENT CAP. The route tops out at 200 rows, so a book bigger than that
                        would quietly lose the tail and the count above would look complete. */}
                    {total > rows.length ? (
                      <>
                        {' '}· showing the {rows.length} most recently updated of{' '}
                        <strong className="num">{total}</strong>
                      </>
                    ) : null}
                  </>
                )}
              </span>
              {loading ? null : (
                <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
              )}
            </div>
          </div>
        )}
        </div>
      </VerificationDeskSurface>
    </SalesPage>
  );
}
