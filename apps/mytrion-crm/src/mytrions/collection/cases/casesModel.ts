/**
 * Collection cases vocabulary — scopes, stage labels, chips. No React.
 *
 * Status is a FILTER (open / closed / all), matching Verification's scope tabs. Stages are the
 * kanban columns. Closed cases can still sit on an early stage (left CMP from intake), so a
 * Closed filter does not collapse the board to the two terminal columns.
 */
import type { BadgeIntent, IconName } from '@/ds';
import type {
  CollectionCaseRow,
  CollectionCaseStatus,
  CollectionClosedReason,
  CollectionStage,
} from '@/api/collection';
import { COLLECTION_STAGES } from '@/api/collection';
import { initials } from '../collectionFormat';

export type CaseScope = 'open' | 'closed' | 'all';

/**
 * SAVED VIEWS — additive filters over the scope tabs, and every one is a real server filter.
 *
 * Deliberately three, and deliberately not "my cases": nothing writes `assignee_user_id` yet, so
 * an owner filter would be a chip that always returns nothing. It goes in when assignment does.
 */
export type SavedViewId = 'high_value' | 'never_contacted' | 'long_overdue';

export interface SavedView {
  id: SavedViewId;
  label: string;
  hint: string;
  filter: { minRemaining?: number; neverContacted?: boolean };
}

export const SAVED_VIEWS: readonly SavedView[] = [
  {
    id: 'high_value',
    label: 'Above $10k',
    hint: 'At least $10,000 still outstanding',
    filter: { minRemaining: 10_000 },
  },
  {
    id: 'never_contacted',
    label: 'Never contacted',
    hint: 'No contact attempt has ever been logged',
    filter: { neverContacted: true },
  },
  {
    id: 'long_overdue',
    label: 'Agency size',
    hint: 'Above the $5,000 agency placement floor',
    filter: { minRemaining: 5_000 },
  },
];
export type CaseViewMode = 'list' | 'kanban';

export const CASE_SCOPES: ReadonlyArray<{ id: CaseScope; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

export const STAGE_LABEL: Record<CollectionStage, string> = {
  intake: 'Intake',
  connected: 'Connected',
  with_agency: 'With agency',
  payment_plan: 'Payment plan',
  skip_tracing: 'Skip tracing',
  small_claims: 'Small claims',
  closed_successfully: 'Recovered',
  case_lost: 'Case lost',
};

export const STAGE_HINT: Record<CollectionStage, string> = {
  intake: 'Just handed off',
  connected: 'Reached the debtor',
  with_agency: 'Placed with Array',
  payment_plan: 'Paying on a plan',
  skip_tracing: 'Cannot be found',
  small_claims: 'In court',
  closed_successfully: 'Recovered or closed clean',
  case_lost: 'Written off',
};

export const CLOSED_REASON_LABEL: Record<CollectionClosedReason, string> = {
  paid_in_full: 'Paid in full',
  below_threshold: 'Below threshold',
  left_cmp: 'Left CMP',
  manual: 'Closed manually',
  case_lost: 'Case lost',
};

export const KANBAN_STAGES: readonly CollectionStage[] = COLLECTION_STAGES;

/**
 * BOARD LANES — five, not eight.
 *
 * One column per COLLECTION_STAGES entry is 8 × 260px = 2,080px of board on a ~1,192px pane, so
 * three lanes were always off-screen and the board was never a board. These five are what a
 * collector actually moves work BETWEEN; the exact stage survives on the card's chip, on the case
 * record's spine, and in the data. Every stage appears in exactly one lane — `BOARD_LANES` is
 * asserted total against COLLECTION_STAGES in collectionModel.test.ts.
 */
export interface BoardLane {
  id: string;
  label: string;
  hint: string;
  tone: string;
  stages: readonly CollectionStage[];
}

export const BOARD_LANES: readonly BoardLane[] = [
  {
    id: 'intake',
    label: 'Intake',
    hint: 'Handed off, not yet worked',
    tone: 'var(--tone-slate)',
    stages: ['intake'],
  },
  {
    id: 'working',
    label: 'Working',
    hint: 'Reached, chasing payment',
    tone: 'var(--tone-sky)',
    stages: ['connected'],
  },
  {
    id: 'plan',
    label: 'On a plan',
    hint: 'Instalments running',
    tone: 'var(--tone-emerald)',
    stages: ['payment_plan'],
  },
  {
    id: 'agency',
    label: 'Agency & legal',
    hint: 'Array, skip tracing, small claims',
    tone: 'var(--tone-amber)',
    stages: ['with_agency', 'skip_tracing', 'small_claims'],
  },
  {
    id: 'closed',
    label: 'Closed',
    hint: 'Recovered or written off',
    tone: 'var(--tone-teal)',
    stages: ['closed_successfully', 'case_lost'],
  },
];

const LANE_OF_STAGE = new Map<CollectionStage, string>(
  BOARD_LANES.flatMap((lane) => lane.stages.map((stage) => [stage, lane.id] as const)),
);

/** Which board lane a stage belongs to. Falls back to intake so an unknown stage is never lost. */
export function laneOfStage(stage: CollectionStage): string {
  return LANE_OF_STAGE.get(stage) ?? 'intake';
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage as CollectionStage] ?? stage;
}

export function caseName(row: CollectionCaseRow): string {
  return row.debtorCompanyName?.trim() || row.displayName?.trim() || `Carrier ${row.carrierId}`;
}

export function caseInitials(row: CollectionCaseRow): string {
  return initials(caseName(row), row.carrierId);
}

export function statusOf(scope: CaseScope): CollectionCaseStatus | undefined {
  if (scope === 'all') return undefined;
  return scope;
}

export function statusChip(row: CollectionCaseRow): { intent: BadgeIntent; icon: IconName; label: string } {
  if (row.status === 'closed') {
    const reason = row.closedReason ? CLOSED_REASON_LABEL[row.closedReason] : 'Closed';
    return { intent: row.closedReason === 'case_lost' ? 'danger' : 'success', icon: 'check_circle', label: reason };
  }
  return { intent: 'info', icon: 'bolt', label: 'Open' };
}

export function stageChip(stage: CollectionStage): { intent: BadgeIntent; icon: IconName } {
  switch (stage) {
    case 'closed_successfully':
      return { intent: 'success', icon: 'check_circle' };
    case 'case_lost':
    case 'small_claims':
      return { intent: 'danger', icon: 'gavel' };
    case 'with_agency':
    case 'skip_tracing':
      return { intent: 'warning', icon: 'warning' };
    default:
      return { intent: 'info', icon: 'schedule' };
  }
}

export function daysTone(days: number): 'ok' | 'warn' | 'bad' {
  if (days >= 180) return 'bad';
  if (days >= 90) return 'warn';
  return 'ok';
}

/**
 * Case-detail invoices page like Array (50), under the route cap of 200. One page per request —
 * never the whole book. Cache keys include page + limit so page 2 cannot reuse page 1's rows.
 */
export const CASE_INVOICES_PAGE_SIZE = 50;

export function invoicePageOffset(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit);
}

export function invoiceCacheKey(caseId: string, page: number, limit: number): string {
  return `collection:case:${caseId}:invoices:${page}:${limit}`;
}

export type InvoicePanelKind = 'loading' | 'error' | 'empty' | 'ready';

/**
 * Failed fetch + no rows must not look like "this case has no invoices". Last-good rows stay
 * `ready` (the table keeps them). Empty is only a successful zero-item payload.
 */
export function invoicePanelKind(input: {
  loading: boolean;
  error: string | null;
  data: { items: readonly unknown[] } | null;
}): InvoicePanelKind {
  if (input.loading && !input.data) return 'loading';
  const items = input.data?.items ?? [];
  if (input.error && items.length === 0) return 'error';
  if (items.length === 0) return 'empty';
  return 'ready';
}
