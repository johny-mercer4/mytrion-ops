/**
 * Verification Main — every number on the page, derived from the desk queue and nothing else.
 *
 * PURE ON PURPOSE. The page renders what this returns; there is no second source and no placeholder
 * branch. Everything here comes off `VerificationCaseRow` (`/verification/flow/cases`), which the
 * New applicants tab already loads under the SAME cache key — so opening Main costs one round trip
 * that the next tab reuses, and the two surfaces can never disagree about how many cases are open.
 *
 * WHAT IS NOT HERE, and why. Net terms, risk tier and the underwriting narrative live on the case
 * detail (`/verification/flow/cases/:id`), one fetch per case. A summary page that fetched ten of
 * them to enrich five rows would pay ten round trips for a subtitle, so the sentences below are
 * written from the list row's own facts. Where a fact does not exist, the field is null and the
 * page renders an em dash rather than a guess.
 *
 * THE WINDOW. `listDeskCases` pages at 200 rows, ordered by `updated_at desc`. The tenant-wide
 * counters (`aggregates`) are exact regardless; the derived series, pipeline and aging describe the
 * rows actually loaded. At the desk's present size that is the whole desk. Past 200 open cases the
 * counters stay right and the panels start describing a window — the fix then is a server-side
 * summary, not a bigger page size.
 */
import type {
  VerificationCaseRow,
  VerificationDeskAggregates,
} from '@/api/verificationFlow';

/**
 * The decisioning SLA, in days — the New Applicant Underwriting SOP's five-day target.
 *
 * One constant, two readers: the "past SLA" badge on the ageing panel and the escalation of a
 * locked case into "Needs you today". Two copies would eventually disagree about whether a
 * six-day-old case is late.
 */
export const DECISION_SLA_DAYS = 5;

/** Points on every KPI sparkline. Twelve days is the shortest window that shows a working week. */
export const TREND_DAYS = 12;

const DAY_MS = 86_400_000;

/** Terminal statuses that granted credit. `routed_wex` is terminal but is neither. */
const APPROVED_STATUSES = new Set(['approved', 'deposit_prepaid']);
const DECLINED_STATUSES = new Set(['declined', 'declined_customer', 'declined_blacklist']);

const PHASE_ORDER: readonly string[] = [
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

/**
 * Column headings for the pipeline rail. The full labels ("Initial Identity / Business
 * Verification") are the case workspace's; a 46px-wide rail needs the noun, and the row number
 * beside it already says which phase it is.
 */
const PHASE_SHORT: Record<string, string> = {
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

const APPLICANT_LABEL: Record<string, string> = {
  owner_operator: 'Owner-operator',
  carrier: 'Carrier',
  company: 'Company',
};

export type NeedsTone = 'danger' | 'warning' | 'info' | 'plain';
export type DecisionOutcome = 'approved' | 'declined' | 'other';

export interface NeedsRow {
  id: string;
  name: string;
  /** Why this case is at the top of the list, in the desk's own words. */
  why: string;
  tone: NeedsTone;
  ageDays: number;
  ownerName: string;
}

export interface PipelineRow {
  code: string;
  label: string;
  order: number;
  count: number;
  /** The phase holds at least one case nobody can move: locked, pending docs or manager review. */
  blocked: boolean;
}

export interface AgingBucket {
  label: string;
  count: number;
}

export interface DecisionRow {
  id: string;
  name: string;
  /** Applicant type and the Sales owner — the two facts the list row actually carries. */
  meta: string;
  outcome: DecisionOutcome;
  /** Approved limit in dollars. Null on a decline, and on an approval with no limit recorded. */
  limit: number | null;
}

export interface VerificationOverview {
  /** Closed in the last 7 days, and how that compares with the 7 days before it. */
  decided: { week: number; approved: number; declined: number; previousWeek: number; delta: number };
  openCount: number;
  awaitingSales: number;
  /** Submitted-to-decision, over the last 30 days. Null until something has been decided. */
  medianDaysToDecision: number | null;
  approvedExposureWeek: number;
  /** Twelve daily points per KPI — each series IS its own tile's metric, not a stand-in for it. */
  trend: {
    open: number[];
    awaitingSales: number[];
    medianDaysToDecision: number[];
    approvedExposure: number[];
  };
  needsToday: NeedsRow[];
  pipeline: PipelineRow[];
  aging: AgingBucket[];
  pastSla: number;
  decisions: DecisionRow[];
}

function caseName(row: VerificationCaseRow): string {
  return (
    row.companyName ||
    [row.firstName, row.lastName].filter(Boolean).join(' ') ||
    'Untitled application'
  );
}

function time(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function amount(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Whole days a case has been on the desk. The clock starts when the application is created. */
function ageDays(row: VerificationCaseRow, now: number): number {
  const created = time(row.createdAt);
  if (created == null) return 0;
  return Math.max(0, Math.floor((now - created) / DAY_MS));
}

/** The desk's own clock on a case: intake completion, or creation while Sales still owes it. */
function startedAt(row: VerificationCaseRow): number | null {
  return time(row.submittedAt) ?? time(row.createdAt);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function outcomeOf(row: VerificationCaseRow): DecisionOutcome {
  if (APPROVED_STATUSES.has(row.statusCode)) return 'approved';
  if (DECLINED_STATUSES.has(row.statusCode)) return 'declined';
  return 'other';
}

/**
 * Rank a case by how much it is holding the desk up. Lower sorts first.
 *
 * Past-SLA locked cases lead because they are the only ones whose clock has already run out, and
 * they are also the ones the desk cannot fix alone — that is the whole point of surfacing them.
 */
function urgency(row: VerificationCaseRow, age: number): number {
  const locked = !row.verificationProcess;
  if (locked && age > DECISION_SLA_DAYS) return 0;
  if (row.statusCode === 'manager_review') return 1;
  if (row.statusCode === 'pending_docs') return 2;
  if (locked) return 3;
  if (row.statusCode === 'intake_submitted') return 4;
  return 5;
}

function toneFor(row: VerificationCaseRow, age: number): NeedsTone {
  const locked = !row.verificationProcess;
  if (locked && age > DECISION_SLA_DAYS) return 'danger';
  if (row.statusCode === 'manager_review' || row.statusCode === 'pending_docs') return 'warning';
  if (locked) return 'danger';
  if (row.statusCode === 'intake_submitted') return 'info';
  return 'plain';
}

function moneyShort(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** One line saying what this case is waiting on, built only from facts on the list row. */
function whyFor(row: VerificationCaseRow, age: number): string {
  const outstanding = row.intakeMissing?.length ?? 0;
  if (!row.verificationProcess) {
    if (age > DECISION_SLA_DAYS) {
      return `${age} days waiting on Sales — past the ${DECISION_SLA_DAYS}-day SLA`;
    }
    return outstanding > 0
      ? `Waiting on Sales — ${outstanding} item${outstanding === 1 ? '' : 's'} outstanding`
      : 'Waiting on Sales — intake not started';
  }
  if (row.statusCode === 'manager_review') {
    // The amount is a FACT on the row; "over the desk limit" would be a cause no column records.
    const requested = amount(row.requestedLimit);
    return requested == null ? 'Manager review' : `Manager review — ${moneyShort(requested)} requested`;
  }
  if (row.statusCode === 'pending_docs') return 'Documents requested from Sales';
  if (row.statusCode === 'intake_submitted') return 'Intake complete — ready to work';
  const phase = PHASE_ORDER.indexOf(row.phaseCode) + 1;
  const label = row.statusLabel ?? 'In review';
  return phase > 0 ? `${label} — phase ${phase} of 10` : label;
}

/** Midnight-to-midnight boundaries for the last `TREND_DAYS` days, oldest first. */
function dayEnds(now: number): number[] {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const last = end.getTime();
  return Array.from({ length: TREND_DAYS }, (_, i) => last - (TREND_DAYS - 1 - i) * DAY_MS);
}

export interface OverviewInput {
  rows: readonly VerificationCaseRow[];
  aggregates: VerificationDeskAggregates;
  /** Injected so the derivation is testable and the page has one clock, not one per panel. */
  now: number;
}

export function buildOverview({ rows, aggregates, now }: OverviewInput): VerificationOverview {
  const open = rows.filter((r) => !r.closedAt);
  const ages = new Map(rows.map((r) => [r.id, ageDays(r, now)]));

  const weekAgo = now - 7 * DAY_MS;
  const twoWeeksAgo = now - 14 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const closedWithin = (from: number, to: number): VerificationCaseRow[] =>
    rows.filter((r) => {
      const at = time(r.closedAt);
      return at != null && at >= from && at < to;
    });

  const thisWeek = closedWithin(weekAgo, Infinity);
  const previousWeek = closedWithin(twoWeeksAgo, weekAgo);

  const decidedLastMonth = closedWithin(monthAgo, Infinity);
  const decisionDays = decidedLastMonth
    .map((r) => {
      const from = startedAt(r);
      const at = time(r.closedAt);
      return from == null || at == null ? null : Math.max(0, (at - from) / DAY_MS);
    })
    .filter((d): d is number => d != null);
  const medianDays = median(decisionDays);

  const approvedExposureWeek = thisWeek
    .filter((r) => outcomeOf(r) === 'approved')
    .reduce((sum, r) => sum + (amount(r.approvedLimitAmount) ?? 0), 0);

  // ── Trend: each series is the tile's own measure, one point per day, 0 where nothing happened.
  const ends = dayEnds(now);
  const trend = {
    open: ends.map(
      (end) =>
        rows.filter((r) => {
          const created = time(r.createdAt);
          const closed = time(r.closedAt);
          return created != null && created <= end && (closed == null || closed > end);
        }).length,
    ),
    awaitingSales: ends.map(
      (end) =>
        rows.filter((r) => {
          const created = time(r.createdAt);
          const submitted = time(r.submittedAt);
          const closed = time(r.closedAt);
          return (
            created != null &&
            created <= end &&
            (submitted == null || submitted > end) &&
            (closed == null || closed > end)
          );
        }).length,
    ),
    medianDaysToDecision: ends.map((end) => {
      const days = closedWithin(end - DAY_MS, end)
        .map((r) => {
          const from = startedAt(r);
          const at = time(r.closedAt);
          return from == null || at == null ? null : Math.max(0, (at - from) / DAY_MS);
        })
        .filter((d): d is number => d != null);
      return median(days) ?? 0;
    }),
    approvedExposure: ends.map((end) =>
      closedWithin(end - DAY_MS, end)
        .filter((r) => outcomeOf(r) === 'approved')
        .reduce((sum, r) => sum + (amount(r.approvedLimitAmount) ?? 0), 0),
    ),
  };

  // ── Needs you today: the five open cases holding the desk up, worst first.
  const needsToday: NeedsRow[] = [...open]
    .sort((a, b) => {
      const ageA = ages.get(a.id) ?? 0;
      const ageB = ages.get(b.id) ?? 0;
      const rank = urgency(a, ageA) - urgency(b, ageB);
      return rank !== 0 ? rank : ageB - ageA;
    })
    .slice(0, 5)
    .map((row) => {
      const age = ages.get(row.id) ?? 0;
      return {
        id: row.id,
        name: caseName(row),
        why: whyFor(row, age),
        tone: toneFor(row, age),
        ageDays: age,
        ownerName: row.ownerName,
      };
    });

  // ── Pipeline: where the open cases actually sit.
  const blockedStatuses = new Set(['pending_docs', 'manager_review']);
  const pipeline: PipelineRow[] = PHASE_ORDER.map((code, index) => {
    const inPhase = open.filter((r) => r.phaseCode === code);
    return {
      code,
      label: PHASE_SHORT[code] ?? code,
      order: index + 1,
      count: inPhase.length,
      blocked: inPhase.some((r) => !r.verificationProcess || blockedStatuses.has(r.statusCode)),
    };
  });

  // ── Ageing: how long the open cases have been waiting.
  const openAges = open.map((r) => ages.get(r.id) ?? 0);
  const aging: AgingBucket[] = [
    { label: '0–1 day', count: openAges.filter((d) => d <= 1).length },
    { label: '2–3 days', count: openAges.filter((d) => d >= 2 && d <= 3).length },
    { label: '4–7 days', count: openAges.filter((d) => d >= 4 && d <= 7).length },
    { label: '8 days +', count: openAges.filter((d) => d >= 8).length },
  ];

  const decisions: DecisionRow[] = [...thisWeek]
    .sort((a, b) => (time(b.closedAt) ?? 0) - (time(a.closedAt) ?? 0))
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      name: caseName(row),
      meta: [APPLICANT_LABEL[row.applicantType ?? ''], row.ownerName].filter(Boolean).join(' · '),
      outcome: outcomeOf(row),
      limit: amount(row.approvedLimitAmount),
    }));

  return {
    decided: {
      week: thisWeek.length,
      approved: thisWeek.filter((r) => outcomeOf(r) === 'approved').length,
      declined: thisWeek.filter((r) => outcomeOf(r) === 'declined').length,
      previousWeek: previousWeek.length,
      delta: thisWeek.length - previousWeek.length,
    },
    // Tenant-wide and exact — these come off the server's own counters, not the loaded page.
    openCount: aggregates.awaitingSales + aggregates.workable,
    awaitingSales: aggregates.awaitingSales,
    medianDaysToDecision: medianDays == null ? null : Math.round(medianDays * 10) / 10,
    approvedExposureWeek,
    trend,
    needsToday,
    pipeline,
    aging,
    pastSla: openAges.filter((d) => d > DECISION_SLA_DAYS).length,
    decisions,
  };
}
