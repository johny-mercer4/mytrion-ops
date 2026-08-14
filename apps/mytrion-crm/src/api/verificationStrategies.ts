import { request } from './transport';

export type StopFactorStage = 'pre' | 'post' | 'decision';
export type StopFactorCheckType = 'field_check' | 'blacklist' | 'sql_query';
export type StopFactorOperator = 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq' | 'not_in' | 'contains';
export type StopFactorAction = 'APPROVE' | 'REJECT' | 'REVIEW';
export type StrategyLifecycle = 'draft' | 'published' | 'archived';

export interface StopFactorRow {
  id: number;
  name: string;
  stage: string;
  check_type: string;
  field_path: string | null;
  operator: string;
  threshold: string | null;
  action_on_fail: string;
  action_on_missing: string;
  provider_filter: string | null;
  enabled: boolean;
  priority: number;
  meta: Record<string, unknown>;
}

export interface StrategyCombinedField {
  label: string;
  source: string;
  path: string;
  required: boolean;
  merge_key: string;
  weight: number;
  notes: string;
}

export interface StrategyRuleBinding {
  category: string;
  stage: string;
  purpose: string;
}

export interface StrategyCondition {
  path: string;
  operator: string;
  value?: unknown;
}

export interface DecisionStrategyRow {
  id: string;
  title: string;
  enabled: boolean;
  lifecycle: string;
  version: number;
  priority: number;
  summary: string;
  outcome: string;
  data_sources: string[];
  stage_scope: string[];
  decision_actions: string[];
  combined_fields: StrategyCombinedField[];
  rule_bindings: StrategyRuleBinding[];
  conditions: StrategyCondition[];
  logic: string;
  meta: Record<string, unknown>;
}

export interface StopFactorWrite {
  name: string;
  stage: StopFactorStage;
  check_type: StopFactorCheckType;
  field_path?: string | null;
  operator: StopFactorOperator;
  threshold?: string | null;
  action_on_fail: StopFactorAction;
  action_on_missing: 'PASS' | 'REJECT' | 'REVIEW';
  provider_filter?: string | null;
  enabled: boolean;
  priority: number;
  apply_at_zoho_intake?: boolean;
  meta?: Record<string, unknown>;
}

export interface StrategyWrite {
  id?: string;
  title: string;
  enabled: boolean;
  lifecycle: StrategyLifecycle;
  priority: number;
  summary: string;
  outcome: string;
  data_sources: string[];
  stage_scope: string[];
  decision_actions: string[];
  combined_fields: Array<{
    label: string;
    source: string;
    path: string;
    required?: boolean;
    merge_key?: string;
    weight?: number;
    notes?: string;
  }>;
  rule_bindings: StrategyRuleBinding[];
  conditions: Array<{ path: string; operator: string; value?: unknown }>;
  logic: string;
  meta?: Record<string, unknown>;
}

export interface ConfigSaveResult {
  status: string;
  id: string;
}

function asItems<T>(data: unknown): T[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? (items as T[]) : [];
}

export async function listStopFactors(
  stage?: StopFactorStage | '',
  signal?: AbortSignal,
): Promise<StopFactorRow[]> {
  const data = await request('GET', '/verification/stop-factors', {
    query: stage ? { stage } : {},
    ...(signal ? { signal } : {}),
  });
  return asItems<StopFactorRow>(data);
}

export async function saveStopFactor(body: StopFactorWrite, id?: number): Promise<ConfigSaveResult> {
  const data = id
    ? await request('PUT', `/verification/stop-factors/${id}`, { body })
    : await request('POST', '/verification/stop-factors', { body });
  const raw = data as Partial<ConfigSaveResult>;
  return { status: raw.status ?? 'saved', id: String(raw.id ?? id ?? '') };
}

export async function listDecisionStrategies(signal?: AbortSignal): Promise<DecisionStrategyRow[]> {
  const data = await request('GET', '/verification/strategies', {
    ...(signal ? { signal } : {}),
  });
  return asItems<DecisionStrategyRow>(data);
}

export async function saveDecisionStrategy(body: StrategyWrite, id?: string): Promise<ConfigSaveResult> {
  const data = id
    ? await request('PUT', `/verification/strategies/${encodeURIComponent(id)}`, { body })
    : await request('POST', '/verification/strategies', { body });
  const raw = data as Partial<ConfigSaveResult>;
  return { status: raw.status ?? 'saved', id: String(raw.id ?? id ?? '') };
}
