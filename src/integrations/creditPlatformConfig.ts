/**
 * Orchestration record types + parsers for stop_factors / decision_strategies_json.
 * Persistence lives in verificationOrchestrationDb.ts (verification Postgres), not HTTP.
 */
export interface StopFactorRecord {
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

export interface DecisionStrategyRecord {
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

export interface DecisionStrategyWrite {
  id?: string;
  title: string;
  enabled: boolean;
  lifecycle: string;
  version?: number;
  priority: number;
  summary: string;
  outcome: string;
  data_sources: string[];
  stage_scope: string[];
  decision_actions: string[];
  combined_fields: Array<{
    label?: string;
    source?: string;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

export function parseStopFactor(raw: unknown): StopFactorRecord | null {
  const row = asRecord(raw);
  const id = asNumber(row.id, Number.NaN);
  if (!Number.isFinite(id) || !asString(row.name)) return null;
  return {
    id,
    name: asString(row.name),
    stage: asString(row.stage, 'pre'),
    check_type: asString(row.check_type, 'field_check'),
    field_path: asNullableString(row.field_path),
    operator: asString(row.operator, 'gte'),
    threshold: asNullableString(row.threshold),
    action_on_fail: asString(row.action_on_fail, 'REJECT'),
    action_on_missing: asString(row.action_on_missing, 'PASS'),
    provider_filter: asNullableString(row.provider_filter),
    enabled: asBool(row.enabled, true),
    priority: asNumber(row.priority, 0),
    meta: asRecord(row.meta),
  };
}

function parseCombinedField(raw: unknown): StrategyCombinedField | null {
  const row = asRecord(raw);
  const path = asString(row.path);
  if (!path) return null;
  return {
    label: asString(row.label, path),
    source: asString(row.source),
    path,
    required: asBool(row.required, false),
    merge_key: asString(row.merge_key),
    weight: asNumber(row.weight, 0),
    notes: asString(row.notes),
  };
}

function parseRuleBinding(raw: unknown): StrategyRuleBinding | null {
  const row = asRecord(raw);
  const category = asString(row.category);
  if (!category) return null;
  return {
    category,
    stage: asString(row.stage, 'decision'),
    purpose: asString(row.purpose),
  };
}

function parseCondition(raw: unknown): StrategyCondition | null {
  const row = asRecord(raw);
  const path = asString(row.path);
  if (!path) return null;
  return {
    path,
    operator: asString(row.operator, 'eq'),
    value: row.value,
  };
}

export function parseDecisionStrategy(raw: unknown): DecisionStrategyRecord | null {
  const row = asRecord(raw);
  const id = asString(row.id);
  const title = asString(row.title);
  if (!id && !title) return null;
  return {
    id: id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: title || id,
    enabled: asBool(row.enabled, true),
    lifecycle: asString(row.lifecycle, 'published'),
    version: Math.max(1, asNumber(row.version, 1)),
    priority: asNumber(row.priority, 10),
    summary: asString(row.summary),
    outcome: asString(row.outcome),
    data_sources: asStringList(row.data_sources),
    stage_scope: asStringList(row.stage_scope),
    decision_actions: asStringList(row.decision_actions),
    combined_fields: Array.isArray(row.combined_fields)
      ? row.combined_fields.map(parseCombinedField).filter((item): item is StrategyCombinedField => item != null)
      : [],
    rule_bindings: Array.isArray(row.rule_bindings)
      ? row.rule_bindings.map(parseRuleBinding).filter((item): item is StrategyRuleBinding => item != null)
      : [],
    conditions: Array.isArray(row.conditions)
      ? row.conditions.map(parseCondition).filter((item): item is StrategyCondition => item != null)
      : [],
    logic: asString(row.logic),
    meta: asRecord(row.meta),
  };
}
