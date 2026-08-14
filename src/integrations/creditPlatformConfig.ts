/**
 * Credit-platform Orchestration config — stop_factors + decision_strategies.
 * Calls /api/v1 so the core-api invalidates caches, audits, and writes revisions
 * the same way the verification-mono admin UI does. No raw SQL.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const TIMEOUT_MS = 12_000;

export interface CreditPlatformHttpResult {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

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
  value: unknown;
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
  meta: Record<string, unknown>;
}

function baseUrl(): string {
  return env.CREDIT_PLATFORM_BASE_URL.replace(/\/+$/, '');
}

export function isCreditPlatformConfigConfigured(): boolean {
  return Boolean(env.CREDIT_PLATFORM_BASE_URL && (env.CREDIT_PLATFORM_API_KEY || env.CREDIT_PLATFORM_ANALYST_API_KEY));
}

function configHeaders(write: boolean): Record<string, string> {
  const key = env.CREDIT_PLATFORM_API_KEY || env.CREDIT_PLATFORM_ANALYST_API_KEY;
  return {
    'X-Api-Key': key,
    'X-Internal-Api-Key': key,
    'X-User-Role': write ? 'admin' : 'analyst',
    'X-User-Name': 'verification-mytrion',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function requestJson(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown> | undefined,
  write: boolean,
): Promise<CreditPlatformHttpResult> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...configHeaders(write) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = asRecord(JSON.parse(text));
      } catch {
        json = { raw: text.slice(0, 300) };
      }
    }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, path, method }, 'credit-platform config request failed');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function asItems(json: Record<string, unknown>): unknown[] {
  return Array.isArray(json.items) ? json.items : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

export async function listStopFactors(stage?: string): Promise<StopFactorRecord[]> {
  const q = stage ? `?stage=${encodeURIComponent(stage)}` : '';
  const res = await requestJson('GET', `/api/v1/stop-factors${q}`, undefined, false);
  if (!res.ok) return Promise.reject(res);
  return asItems(res.json).map(parseStopFactor).filter((item): item is StopFactorRecord => item != null);
}

export async function createStopFactor(body: StopFactorWrite): Promise<CreditPlatformHttpResult> {
  return requestJson('POST', '/api/v1/stop-factors', { ...body }, true);
}

export async function updateStopFactor(id: number, body: StopFactorWrite): Promise<CreditPlatformHttpResult> {
  return requestJson('PUT', `/api/v1/stop-factors/${id}`, { ...body }, true);
}

export async function listDecisionStrategies(): Promise<DecisionStrategyRecord[]> {
  const res = await requestJson('GET', '/api/v1/decision-strategies', undefined, false);
  if (!res.ok) return Promise.reject(res);
  return asItems(res.json)
    .map(parseDecisionStrategy)
    .filter((item): item is DecisionStrategyRecord => item != null);
}

export async function createDecisionStrategy(body: DecisionStrategyWrite): Promise<CreditPlatformHttpResult> {
  return requestJson('POST', '/api/v1/decision-strategies', { ...body }, true);
}

export async function updateDecisionStrategy(
  id: string,
  body: DecisionStrategyWrite,
): Promise<CreditPlatformHttpResult> {
  return requestJson('PUT', `/api/v1/decision-strategies/${encodeURIComponent(id)}`, { ...body }, true);
}
