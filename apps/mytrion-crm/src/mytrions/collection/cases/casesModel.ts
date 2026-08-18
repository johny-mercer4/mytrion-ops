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
