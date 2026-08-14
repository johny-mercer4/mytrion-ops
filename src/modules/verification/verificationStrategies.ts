/**
 * Verification Mytrion → Orchestration config.
 * Stop factors are rows in `stop_factors`. Strategies are the JSON list in
 * `system_state.decision_strategies_json`. Both go through the verification Postgres
 * pools (same SQL as verification-mono Orchestration), not CREDIT_PLATFORM_BASE_URL.
 */
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { DecisionStrategyRecord, StopFactorRecord } from '../../integrations/creditPlatformConfig.js';
import {
  createDecisionStrategy,
  createStopFactor,
  isOrchestrationDbConfigured,
  isOrchestrationWriteConfigured,
  listDecisionStrategies,
  listStopFactors,
  updateDecisionStrategy,
  updateStopFactor,
} from '../../integrations/verificationOrchestrationDb.js';
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

function ensureReadConfigured(): void {
  if (!isOrchestrationDbConfigured()) {
    throw new AppError(
      'Verification database is not configured. Set VERIFICATION_DATABASE_URL.',
      { statusCode: 503, code: 'VERIFICATION_DB_UNCONFIGURED', expose: true },
    );
  }
}

function ensureWriteConfigured(): void {
  ensureReadConfigured();
  if (!isOrchestrationWriteConfigured()) {
    throw new AppError(
      'Verification write-back is disabled. Set VERIFICATION_WRITE_ENABLED=1.',
      { statusCode: 503, code: 'VERIFICATION_WRITE_DISABLED', expose: true },
    );
  }
}

function wrapDb(err: unknown, fallback: string): never {
  if (err instanceof AppError) throw err;
  const message = err instanceof Error ? err.message : fallback;
  throw new AppError(message.slice(0, 400) || fallback, {
    statusCode: 502,
    code: 'VERIFICATION_DB_ERROR',
    expose: true,
  });
}

function actorName(ctx: TenantContext): string {
  return (ctx.userName || ctx.userId || 'verification-mytrion').trim();
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
    ...(input.meta ? { meta: input.meta } : {}),
  };
}

export async function listVerificationStopFactors(stage?: string): Promise<{ items: StopFactorRecord[] }> {
  ensureReadConfigured();
  try {
    return { items: await listStopFactors(stage) };
  } catch (err) {
    wrapDb(err, 'Failed to list stop factors');
  }
}

export async function saveVerificationStopFactor(
  ctx: TenantContext,
  input: StopFactorWriteInput,
  id?: number,
): Promise<{ status: string; id: string; item: StopFactorRecord | null }> {
  ensureWriteConfigured();
  const body = stopFactorBody(input);
  try {
    const res = id == null ? await createStopFactor(body, actorName(ctx)) : await updateStopFactor(id, body, actorName(ctx));
    await auditFromContext(ctx, {
      action: id == null ? 'verification.stop_factor.create' : 'verification.stop_factor.update',
      status: 'ok',
      resourceType: 'stop_factor',
      resourceId: res.id,
      detail: { name: input.name, stage: input.stage },
    });
    return { status: res.status, id: res.id, item: res.item };
  } catch (err) {
    wrapDb(err, id == null ? 'Failed to create stop factor' : 'Failed to update stop factor');
  }
}

export async function listVerificationStrategies(): Promise<{ items: DecisionStrategyRecord[] }> {
  ensureReadConfigured();
  try {
    return { items: await listDecisionStrategies() };
  } catch (err) {
    wrapDb(err, 'Failed to list decision strategies');
  }
}

export async function saveVerificationStrategy(
  ctx: TenantContext,
  input: StrategyWriteInput,
  id?: string,
): Promise<{ status: string; id: string; item: DecisionStrategyRecord | null }> {
  ensureWriteConfigured();
  const body = strategyBody(input);
  try {
    const res = id
      ? await updateDecisionStrategy(id, body, actorName(ctx))
      : await createDecisionStrategy(body, actorName(ctx));
    await auditFromContext(ctx, {
      action: id ? 'verification.strategy.update' : 'verification.strategy.create',
      status: 'ok',
      resourceType: 'decision_strategy',
      resourceId: res.id,
      detail: { title: input.title },
    });
    return { status: res.status, id: res.id, item: res.item };
  } catch (err) {
    wrapDb(err, id ? 'Failed to update strategy' : 'Failed to create strategy');
  }
}
