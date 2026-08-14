/**
 * Verification Mytrion → credit-platform Orchestration config.
 * Stop factors are rows in `stop_factors`. Strategies are the JSON list in
 * `system_state.decision_strategies_json`. Both go through /api/v1 so caches
 * and config_revisions stay in sync with verification-mono.
 */
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isCreditPlatformConfigured } from '../../integrations/creditPlatformClient.js';
import {
  createDecisionStrategy,
  createStopFactor,
  isCreditPlatformConfigConfigured,
  listDecisionStrategies,
  listStopFactors,
  parseDecisionStrategy,
  parseStopFactor,
  type CreditPlatformHttpResult,
  type DecisionStrategyRecord,
  type StopFactorRecord,
  updateDecisionStrategy,
  updateStopFactor,
} from '../../integrations/creditPlatformConfig.js';
import { auditFromContext } from '../audit/auditLogger.js';
import type { TenantContext } from '../../types/tenantContext.js';

const STAGES = ['pre', 'post', 'decision'] as const;
const CHECK_TYPES = ['field_check', 'blacklist', 'sql_query'] as const;
const OPERATORS = ['gte', 'lte', 'gt', 'lt', 'eq', 'neq', 'not_in', 'contains'] as const;
const FAIL_ACTIONS = ['APPROVE', 'REJECT', 'REVIEW'] as const;
const MISSING_ACTIONS = ['PASS', 'REJECT', 'REVIEW'] as const;
const LIFECYCLES = ['draft', 'published', 'archived'] as const;

const stringList = z.array(z.string().trim().min(1).max(80)).max(40);

export const stopFactorWriteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  stage: z.enum(STAGES),
  check_type: z.enum(CHECK_TYPES).default('field_check'),
  field_path: z.string().trim().max(500).optional().nullable(),
  operator: z.enum(OPERATORS).default('gte'),
  threshold: z.string().max(8000).optional().nullable(),
  action_on_fail: z.enum(FAIL_ACTIONS).default('REJECT'),
  action_on_missing: z.enum(MISSING_ACTIONS).default('PASS'),
  provider_filter: z.string().trim().max(80).optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100_000).default(0),
  apply_at_zoho_intake: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const strategyWriteSchema = z.object({
  id: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  lifecycle: z.enum(LIFECYCLES).default('draft'),
  version: z.number().int().min(1).max(100_000).optional(),
  priority: z.number().int().min(0).max(100_000).default(100),
  summary: z.string().max(1000).default(''),
  outcome: z.string().max(1000).default(''),
  data_sources: stringList.default([]),
  stage_scope: stringList.default([]),
  decision_actions: stringList.default([]),
  combined_fields: z
    .array(
      z.object({
        label: z.string().max(120).default(''),
        source: z.string().max(80).default(''),
        path: z.string().trim().min(1).max(240),
        required: z.boolean().optional(),
        merge_key: z.string().max(80).optional(),
        weight: z.number().int().min(0).optional(),
        notes: z.string().max(240).optional(),
      }),
    )
    .max(40)
    .default([]),
  rule_bindings: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(40),
        stage: z.string().trim().min(1).max(40).default('decision'),
        purpose: z.string().max(200).default(''),
      }),
    )
    .max(20)
    .default([]),
  conditions: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(240),
        operator: z.string().trim().min(1).max(40),
        value: z.unknown().optional(),
      }),
    )
    .max(40)
    .default([]),
  logic: z.string().max(500).default(''),
  meta: z.record(z.unknown()).optional(),
});

export type StopFactorWriteInput = z.infer<typeof stopFactorWriteSchema>;
export type StrategyWriteInput = z.infer<typeof strategyWriteSchema>;

function ensureConfigured(): void {
  if (!isCreditPlatformConfigConfigured() && !isCreditPlatformConfigured()) {
    throw new AppError(
      'Credit-platform config is not configured. Set CREDIT_PLATFORM_BASE_URL and CREDIT_PLATFORM_API_KEY.',
      { statusCode: 503, code: 'CREDIT_PLATFORM_NOT_CONFIGURED', expose: true },
    );
  }
}

function httpError(res: CreditPlatformHttpResult, fallback: string): AppError {
  const detail = res.json.detail ?? res.json.error ?? res.json.raw ?? fallback;
  const message = typeof detail === 'string' ? detail : fallback;
  if (res.status === 404) {
    return new AppError(message || 'Not found', { statusCode: 404, code: 'CREDIT_PLATFORM_NOT_FOUND', expose: true });
  }
  if (res.status === 409) {
    return new AppError(message || 'Conflict', { statusCode: 409, code: 'CREDIT_PLATFORM_CONFLICT', expose: true });
  }
  if (res.status === 401 || res.status === 403) {
    return new AppError(
      'Credit-platform refused the config write. Check CREDIT_PLATFORM_API_KEY role (admin / CAP_CONFIG_EDIT).',
      { statusCode: 502, code: 'CREDIT_PLATFORM_FORBIDDEN', expose: true },
    );
  }
  return new AppError(message.slice(0, 400) || fallback, {
    statusCode: 502,
    code: 'CREDIT_PLATFORM_ERROR',
    expose: true,
  });
}

function wrapHttp(err: unknown, fallback: string): never {
  if (err instanceof AppError) throw err;
  if (err && typeof err === 'object' && 'status' in err && 'json' in err) {
    throw httpError(err as CreditPlatformHttpResult, fallback);
  }
  const message = err instanceof Error ? err.message : fallback;
  throw new AppError(message, { statusCode: 502, code: 'CREDIT_PLATFORM_UNREACHABLE', expose: true });
}

function stopFactorBody(input: StopFactorWriteInput): Parameters<typeof createStopFactor>[0] {
  const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
  if (input.stage === 'decision') meta.decision_rule = true;
  if (input.apply_at_zoho_intake != null) meta.apply_at_zoho_intake = input.apply_at_zoho_intake;
  return {
    name: input.name,
    stage: input.stage,
    check_type: input.check_type,
    field_path: input.field_path ?? null,
    operator: input.operator,
    threshold: input.threshold ?? null,
    action_on_fail: input.action_on_fail,
    action_on_missing: input.action_on_missing,
    provider_filter: input.provider_filter ?? null,
    enabled: input.enabled,
    priority: input.priority,
    meta,
  };
}

function strategyBody(input: StrategyWriteInput): Parameters<typeof createDecisionStrategy>[0] {
  return {
    ...(input.id ? { id: input.id } : {}),
    title: input.title,
    enabled: input.enabled,
    lifecycle: input.lifecycle,
    ...(input.version != null ? { version: input.version } : {}),
    priority: input.priority,
    summary: input.summary,
    outcome: input.outcome,
    data_sources: input.data_sources,
    stage_scope: input.stage_scope,
    decision_actions: input.decision_actions,
    combined_fields: input.combined_fields.map((field) => ({
      path: field.path,
      label: field.label,
      source: field.source,
      ...(field.required !== undefined ? { required: field.required } : {}),
      ...(field.merge_key !== undefined ? { merge_key: field.merge_key } : {}),
      ...(field.weight !== undefined ? { weight: field.weight } : {}),
      ...(field.notes !== undefined ? { notes: field.notes } : {}),
    })),
    rule_bindings: input.rule_bindings,
    conditions: input.conditions.map((condition) => ({
      path: condition.path,
      operator: condition.operator,
      ...(condition.value !== undefined ? { value: condition.value } : {}),
    })),
    logic: input.logic,
    meta: input.meta ?? {},
  };
}

export async function listVerificationStopFactors(stage?: string): Promise<{ items: StopFactorRecord[] }> {
  ensureConfigured();
  try {
    return { items: await listStopFactors(stage) };
  } catch (err) {
    wrapHttp(err, 'Failed to list stop factors');
  }
}

export async function saveVerificationStopFactor(
  ctx: TenantContext,
  input: StopFactorWriteInput,
  id?: number,
): Promise<{ status: string; id: string; item: StopFactorRecord | null }> {
  ensureConfigured();
  const body = stopFactorBody(input);
  try {
    const res = id == null ? await createStopFactor(body) : await updateStopFactor(id, body);
    if (!res.ok) throw httpError(res, id == null ? 'Failed to create stop factor' : 'Failed to update stop factor');
    const savedId = String(res.json.id ?? id ?? '');
    await auditFromContext(ctx, {
      action: id == null ? 'verification.stop_factor.create' : 'verification.stop_factor.update',
      status: 'ok',
      resourceType: 'stop_factor',
      resourceId: savedId,
      detail: { name: input.name, stage: input.stage },
    });
    return { status: String(res.json.status ?? (id == null ? 'created' : 'updated')), id: savedId, item: parseStopFactor({ ...body, id: Number(savedId) || id }) };
  } catch (err) {
    wrapHttp(err, id == null ? 'Failed to create stop factor' : 'Failed to update stop factor');
  }
}

export async function listVerificationStrategies(): Promise<{ items: DecisionStrategyRecord[] }> {
  ensureConfigured();
  try {
    return { items: await listDecisionStrategies() };
  } catch (err) {
    wrapHttp(err, 'Failed to list decision strategies');
  }
}

export async function saveVerificationStrategy(
  ctx: TenantContext,
  input: StrategyWriteInput,
  id?: string,
): Promise<{ status: string; id: string; item: DecisionStrategyRecord | null }> {
  ensureConfigured();
  const body = strategyBody(input);
  try {
    const res = id
      ? await updateDecisionStrategy(id, body)
      : await createDecisionStrategy(body);
    if (!res.ok) throw httpError(res, id ? 'Failed to update strategy' : 'Failed to create strategy');
    const savedId = String(res.json.id ?? id ?? input.id ?? '');
    const rawItem = res.json.item;
    await auditFromContext(ctx, {
      action: id ? 'verification.strategy.update' : 'verification.strategy.create',
      status: 'ok',
      resourceType: 'decision_strategy',
      resourceId: savedId,
      detail: { title: input.title },
    });
    return {
      status: String(res.json.status ?? (id ? 'updated' : 'created')),
      id: savedId,
      item: parseDecisionStrategy(rawItem) ?? parseDecisionStrategy({ ...body, id: savedId }),
    };
  } catch (err) {
    wrapHttp(err, id ? 'Failed to update strategy' : 'Failed to create strategy');
  }
}
