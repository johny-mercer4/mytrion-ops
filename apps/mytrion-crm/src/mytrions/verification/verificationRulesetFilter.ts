import type { DecisionStrategyRow, StopFactorRow } from '../../api/verificationStrategies';

export type EnabledFilter = 'all' | 'enabled' | 'disabled';

export interface RulesetListFilters {
  q: string;
  enabled: EnabledFilter;
}

function haystackMatch(parts: Array<string | null | undefined>, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return parts.some((part) => (part ?? '').toLowerCase().includes(term));
}

export function filterStrategies(
  rows: readonly DecisionStrategyRow[],
  filters: RulesetListFilters,
): DecisionStrategyRow[] {
  return rows.filter((row) => {
    if (filters.enabled === 'enabled' && !row.enabled) return false;
    if (filters.enabled === 'disabled' && row.enabled) return false;
    return haystackMatch(
      [row.title, row.id, row.lifecycle, row.summary, row.decision_actions.join(' '), row.stage_scope.join(' ')],
      filters.q,
    );
  });
}

export function filterStopFactors(
  rows: readonly StopFactorRow[],
  filters: RulesetListFilters & { stage: string },
): StopFactorRow[] {
  return rows.filter((row) => {
    if (filters.stage && row.stage !== filters.stage) return false;
    if (filters.enabled === 'enabled' && !row.enabled) return false;
    if (filters.enabled === 'disabled' && row.enabled) return false;
    return haystackMatch([row.name, row.field_path, row.operator, row.action_on_fail, row.stage], filters.q);
  });
}

export function countEnabled(rows: readonly { enabled: boolean }[]): number {
  return rows.filter((row) => row.enabled).length;
}

export function stageLabel(stage: string): string {
  if (stage === 'pre') return 'Pre-check';
  if (stage === 'post') return 'Post-check';
  if (stage === 'decision') return 'Decision';
  return stage || '—';
}

/** Word-boundary clamp for list summaries. CSS line-clamp is the width safety net. */
export function clampSummary(text: string, maxChars = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const breakAt = Math.max(
    slice.lastIndexOf(' '),
    slice.lastIndexOf(','),
    slice.lastIndexOf(';'),
    slice.lastIndexOf(':'),
  );
  const cut = breakAt >= Math.floor(maxChars * 0.55) ? slice.slice(0, breakAt) : slice;
  return `${cut.replace(/[\s,;:.]+$/u, '')}…`;
}

export function lifecycleLabel(lifecycle: string): string {
  if (lifecycle === 'published') return 'Published';
  if (lifecycle === 'archived') return 'Archived';
  if (lifecycle === 'draft') return 'Draft';
  return lifecycle || 'Draft';
}

export function formatConditionValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function parseConditionValue(raw: string, operator: string): unknown {
  const trimmed = raw.trim();
  if (operator === 'exists' || operator === 'not_exists' || operator === 'truthy') return undefined;
  if (operator === 'in' || operator === 'not_in') {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return trimmed;
}

export const CONDITION_OPERATORS: { id: string; label: string }[] = [
  { id: 'eq', label: 'equals' },
  { id: 'neq', label: 'does not equal' },
  { id: 'in', label: 'is one of' },
  { id: 'not_in', label: 'is not one of' },
  { id: 'contains', label: 'contains' },
  { id: 'gte', label: 'at least' },
  { id: 'lte', label: 'at most' },
  { id: 'gt', label: 'greater than' },
  { id: 'lt', label: 'less than' },
  { id: 'exists', label: 'exists' },
  { id: 'not_exists', label: 'does not exist' },
  { id: 'truthy', label: 'is true' },
];

export const STAGE_SCOPE_CHIPS = [
  'fmcsa',
  'plaid_bs',
  'highway',
  'creditsafe',
  'isoftpull',
  'crosscheck',
  'zoho',
  'stop_factor_pre',
  'stop_factor_after',
  'blacklist',
  'antifraud',
];

export const DATA_SOURCE_CHIPS = [
  'zoho',
  'fmcsa',
  'plaid',
  'creditsafe',
  'isoftpull',
  'highway',
  'blacklist',
  'antifraud',
  'manual',
];

export const DECISION_ACTION_CHIPS = ['approve', 'review', 'reject', 'hold'];
