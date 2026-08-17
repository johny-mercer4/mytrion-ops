/**
 * New applicants — the vocabulary and the arithmetic, with no React in it.
 *
 * Everything the queue and the case view need to turn a `VerificationCaseRow` into words: which
 * scope a case is in, what its status is called, which phase it sits on, how old it is, and which
 * underwriting route it is on. Pure so it can be tested against real row shapes rather than against
 * a rendered screen.
 *
 * WHY THE LABELS LIVE HERE AND NOT ON THE WIRE. `verification_statuses.label` is only joined by the
 * LIST endpoint (`deskService.list`); `deskService.detail` never joins it, so `statusLabel` is
 * `undefined` on every case-detail response. The old workspace read it anyway and silently rendered
 * "In review" for a declined case. One map, used by both surfaces, is what stops that.
 */
import type {
  VerificationCaseRow,
  VerificationPhaseStatus,
  VerificationRoute,
} from '@/api/verificationFlow';

/** The desk's own five-day decisioning target. Shared with Main — see `main/verificationOverview`. */
export { DECISION_SLA_DAYS } from '../main/verificationOverview';

const DAY_MS = 86_400_000;

export type Scope = 'open' | 'workable' | 'awaiting_sales' | 'pending_docs' | 'manager_review' | 'closed';

export const SCOPES: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'open', label: 'All open' },
  { id: 'workable', label: 'Ready to work' },
  { id: 'awaiting_sales', label: 'Waiting on Sales' },
  { id: 'pending_docs', label: 'Pending docs' },
  { id: 'manager_review', label: 'Manager review' },
  { id: 'closed', label: 'Decided' },
];

/**
 * Case status codes → what the desk calls them. Mirrors the `verification_statuses` seed in
 * migration 0121; `applicantsModel.test.ts` pins the two lists together so a new status added to
 * the seed cannot render here as a raw snake_case code.
 */
export const STATUS_LABEL: Record<string, string> = {
  intake_incomplete: 'Locked',
  intake_submitted: 'Submitted',
  in_review: 'In review',
  pending_docs: 'Pending docs',
  manager_review: 'Manager review',
  additional_verification: 'Additional verification',
  approved: 'Approved',
  deposit_prepaid: 'Deposit / prepaid',
  routed_wex: 'Routed to WEX',
  declined: 'Declined',
  declined_customer: 'Declined by customer',
  declined_blacklist: 'Declined — blacklisted',
};

/** Per-phase state → what the rail and the pane call it. The wire carries the code only. */
export const PHASE_STATE_LABEL: Record<VerificationPhaseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  pending_docs: 'Pending documents',
  manager_review: 'Manager review',
  failed: 'Declined',
  skipped: 'Not applicable',
};

export const PHASE_ORDER: readonly string[] = [
  'p1_intake',
  'p2_identity',
  'p3_screening',
  'p4_authority',
  'p5_routing',
  'p6_credit_banking',
  'p7_hard_stops',
  'p8_highway',
  'p9_risk_capacity',
  'p10_decision',
];

/** Rail-width headings. The catalog's full labels are the pane's; a 1/10th column needs the noun. */
export const PHASE_SHORT: Record<string, string> = {
  p1_intake: 'Intake',
  p2_identity: 'Identity',
  p3_screening: 'Screening',
  p4_authority: 'Authority',
  p5_routing: 'Routing',
  p6_credit_banking: 'Credit & banking',
  p7_hard_stops: 'Hard stops',
  p8_highway: 'Highway',
  p9_risk_capacity: 'Risk tier',
  p10_decision: 'Decision',
};

export const APPLICANT_LABEL: Record<string, string> = {
  owner_operator: 'Owner-operator',
  carrier: 'Carrier',
  company: 'Company',
};

export const ROUTE_LABEL: Record<VerificationRoute, string> = {
  octane_internal: 'Octane internal',
  wex: 'WEX route',
};

export function caseName(row: Pick<VerificationCaseRow, 'companyName' | 'firstName' | 'lastName'>): string {
  return (
    row.companyName ||
    [row.firstName, row.lastName].filter(Boolean).join(' ') ||
    'Untitled application'
  );
}

/** Two letters for the mono tile. Company initials where there is a company, person's where not. */
export function caseInitials(row: Pick<VerificationCaseRow, 'companyName' | 'firstName' | 'lastName'>): string {
  const source = caseName(row);
  const words = source.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function statusLabel(row: Pick<VerificationCaseRow, 'statusCode' | 'statusLabel'>): string {
  // The list endpoint DOES stitch a label; prefer the server's word when it is there.
  return row.statusLabel ?? STATUS_LABEL[row.statusCode] ?? row.statusCode;
}

export function isLocked(row: Pick<VerificationCaseRow, 'verificationProcess'>): boolean {
  return !row.verificationProcess;
}

export function phaseNumber(phaseCode: string): number {
  const index = PHASE_ORDER.indexOf(phaseCode);
  return index < 0 ? 1 : index + 1;
}

/** Whole days on the desk. The clock starts when the application is created. */
export function ageDays(row: Pick<VerificationCaseRow, 'createdAt'>, now: number): number {
  const created = Date.parse(row.createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((now - created) / DAY_MS));
}

/**
 * Which underwriting route a case is on.
 *
 * The stored `underwriting_route` column is never written by the flow module — only read and
 * filtered — so it is NULL on every sales-origin case and a UI that trusts it shows "Octane
 * internal" for nothing and "WEX" for no one. The route is a FUNCTION of the card count against the
 * tenant's cutoff, which is exactly how the server derives it on the case detail
 * (`resolveUnderwritingRoute`). Null cards means the question has not been answered yet.
 */
export function routeOf(
  row: Pick<VerificationCaseRow, 'fuelCardsRequested' | 'underwritingRoute'>,
  wexCardCutoff: number | null,
): VerificationRoute | null {
  if (row.fuelCardsRequested == null) return row.underwritingRoute;
  if (wexCardCutoff == null) return row.underwritingRoute;
  return row.fuelCardsRequested > wexCardCutoff ? 'wex' : 'octane_internal';
}

export function routeLabel(route: VerificationRoute | null): string {
  return route == null ? 'Route not set' : ROUTE_LABEL[route];
}

export function inScope(row: VerificationCaseRow, scope: Scope): boolean {
  switch (scope) {
    case 'workable':
      return row.verificationProcess && !row.closedAt;
    case 'awaiting_sales':
      return !row.verificationProcess;
    case 'pending_docs':
      return row.statusCode === 'pending_docs';
    case 'manager_review':
      return row.statusCode === 'manager_review';
    case 'closed':
      return Boolean(row.closedAt);
    // "All open" is the desk's working set — a decided case has left it.
    default:
      return !row.closedAt;
  }
}

/** One sentence saying what the case is waiting on, from facts on the list row alone. */
export function blockedOn(row: VerificationCaseRow, slaDays: number, now: number): string {
  const outstanding = row.intakeMissing?.length ?? 0;
  if (isLocked(row)) {
    const age = ageDays(row, now);
    if (age > slaDays) return `${age} days waiting on Sales — past the ${slaDays}-day SLA`;
    return outstanding > 0
      ? `Waiting on Sales — ${outstanding} item${outstanding === 1 ? '' : 's'} outstanding`
      : 'Waiting on Sales — intake not started';
  }
  if (row.closedAt) return `Decided — ${statusLabel(row)}`;
  switch (row.statusCode) {
    case 'pending_docs':
      return 'Documents requested from Sales';
    case 'manager_review':
      // Deliberately NOT "over the desk limit": there is no limit column, and four of the five
      // routes into this status are nothing to do with an amount (a company applicant with no
      // MC/DOT lands here at intake). The real reason is on the case's own timeline.
      return 'With a manager';
    case 'additional_verification':
      return 'Additional verification requested';
    case 'intake_submitted':
      return 'Intake complete — ready to work';
    default:
      return `${PHASE_SHORT[row.phaseCode] ?? 'Underwriting'} in progress`;
  }
}

// ── Filtering and sorting ──────────────────────────────────────────────────────────────────────

export type StageFilter = 'all' | 'intake' | 'authority' | 'credit' | 'decision';
export type AgeFilter = 'all' | 'today' | 'inside' | 'late';
export type SortKey = 'age' | 'name' | 'phase' | 'status' | 'trucks' | 'cards' | 'limit';
export type SortDir = 'asc' | 'desc';

export interface Filters {
  type: string;
  route: string;
  stage: StageFilter;
  age: AgeFilter;
}

export const EMPTY_FILTERS: Filters = { type: 'all', route: 'all', stage: 'all', age: 'all' };

export function filtersActive(f: Filters): boolean {
  return f.type !== 'all' || f.route !== 'all' || f.stage !== 'all' || f.age !== 'all';
}

const STAGE_RANGE: Record<Exclude<StageFilter, 'all'>, [number, number]> = {
  intake: [1, 3],
  authority: [4, 5],
  credit: [6, 7],
  decision: [8, 10],
};

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'age', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'phase', label: 'Furthest along' },
  { value: 'limit', label: 'Largest limit' },
];

function numeric(value: string | number | null): number {
  if (value == null) return -1;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : -1;
}

export interface QueueQuery {
  scope: Scope;
  search: string;
  filters: Filters;
  sortKey: SortKey;
  sortDir: SortDir;
  wexCardCutoff: number | null;
  slaDays: number;
  now: number;
}

/**
 * The visible queue: scope, then filters, then search, then sort.
 *
 * All client-side, over the page `listDeskCases` returned — the desk's whole case count is two
 * orders of magnitude below the 200-row page, and a filter that costs a round trip is a filter
 * nobody uses twice.
 */
export function selectRows(
  rows: readonly VerificationCaseRow[],
  q: QueueQuery,
): VerificationCaseRow[] {
  const needle = q.search.trim().toLowerCase();

  const out = rows.filter((row) => {
    if (!inScope(row, q.scope)) return false;
    if (q.filters.type !== 'all' && (row.applicantType ?? '') !== q.filters.type) return false;
    if (q.filters.route !== 'all') {
      const route = routeOf(row, q.wexCardCutoff);
      if ((route ?? 'none') !== q.filters.route) return false;
    }
    if (q.filters.stage !== 'all') {
      const [from, to] = STAGE_RANGE[q.filters.stage];
      const phase = phaseNumber(row.phaseCode);
      if (phase < from || phase > to) return false;
    }
    if (q.filters.age !== 'all') {
      const age = ageDays(row, q.now);
      if (q.filters.age === 'today' && age > 0) return false;
      if (q.filters.age === 'inside' && age > q.slaDays) return false;
      if (q.filters.age === 'late' && age <= q.slaDays) return false;
    }
    if (needle) {
      const haystack = [
        caseName(row),
        row.ownerName,
        row.email ?? '',
        row.phone ?? '',
        row.ein ?? '',
        row.mc ?? '',
        row.dot ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const dir = q.sortDir === 'asc' ? 1 : -1;
  const key = (row: VerificationCaseRow): string | number => {
    switch (q.sortKey) {
      case 'name':
        return caseName(row).toLowerCase();
      case 'phase':
        return phaseNumber(row.phaseCode);
      case 'status':
        return statusLabel(row).toLowerCase();
      case 'trucks':
        return numeric(row.trucksCount);
      case 'cards':
        return numeric(row.fuelCardsRequested);
      case 'limit':
        return numeric(row.approvedLimitAmount ?? row.requestedLimit);
      default:
        return ageDays(row, q.now);
    }
  };

  return out.sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });
}
