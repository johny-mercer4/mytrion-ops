/**
 * Orchestration config against the credit_platform Postgres — same tables/SQL as
 * verification-mono `GET/POST/PUT /api/v1/stop-factors` and `/api/v1/decision-strategies`.
 * Reads use the read-only pool; writes use the VERIFICATION_WRITE_ENABLED pool.
 */
import { AppError } from '../lib/errors.js';
import { verificationDb } from './verificationDb.js';
import { isWriteConfigured, withWriteTransaction, type WriteQueryFn } from './creditPlatformWriteDb.js';
import {
  parseStopFactor,
  type DecisionStrategyRecord,
  type DecisionStrategyWrite,
  type StopFactorRecord,
  type StopFactorWrite,
} from './creditPlatformConfig.js';
import {
  appendDecisionStrategyRevision,
  CONFIG_VERSION_STATE_KEY,
  DECISION_STRATEGIES_REVISIONS_STATE_KEY,
  DECISION_STRATEGIES_STATE_KEY,
  mergeStrategyWrite,
  normalizeDecisionStrategyList,
  slugDecisionStrategyId,
  validateConditionLogic,
  type StrategyRevision,
} from './verificationOrchestrationNormalize.js';

const STOP_FACTOR_COLS =
  'id, name, stage, check_type, field_path, operator, threshold, action_on_fail, action_on_missing, provider_filter, enabled, priority, meta, updated_at';

export function isOrchestrationDbConfigured(): boolean {
  return verificationDb.isConfigured();
}

export function isOrchestrationWriteConfigured(): boolean {
  return isWriteConfigured();
}

function decisionRuleMeta(stage: string, meta: Record<string, unknown>): Record<string, unknown> {
  return stage.trim().toLowerCase() === 'decision' ? { ...meta, decision_rule: true } : meta;
}

async function bumpConfigVersion(query: WriteQueryFn): Promise<void> {
  await query(
    `INSERT INTO system_state (key, value_text)
     VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE
     SET value_text = ((COALESCE(NULLIF(system_state.value_text, ''), '0'))::bigint + 1)::text,
         updated_at = NOW()`,
    [CONFIG_VERSION_STATE_KEY],
  );
}

async function insertPlatformAudit(
  query: WriteQueryFn,
  entityType: string,
  entityId: string,
  action: string,
  changes: object,
  performedBy: string,
): Promise<void> {
  await query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changes, performed_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [entityType, entityId, action, JSON.stringify(changes), performedBy || null],
  );
}

async function setSystemStateText(query: WriteQueryFn, key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO system_state (key, value_text, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()`,
    [key, value],
  );
}

async function readStateText(query: WriteQueryFn | undefined, key: string): Promise<string> {
  if (query) {
    const rows = await query<{ value_text: string | null }>(
      'SELECT value_text FROM system_state WHERE key = $1',
      [key],
    );
    return String(rows[0]?.value_text ?? '').trim();
  }
  const rows = await verificationDb.query<{ value_text: string | null }>(
    'SELECT value_text FROM system_state WHERE key = $1',
    [key],
  );
  return String(rows[0]?.value_text ?? '').trim();
}

function parseStrategyJson(raw: string): DecisionStrategyRecord[] {
  if (!raw) return normalizeDecisionStrategyList([]);
  try {
    return normalizeDecisionStrategyList(JSON.parse(raw) as unknown);
  } catch {
    return normalizeDecisionStrategyList([]);
  }
}

function parseRevisionJson(raw: string): StrategyRevision[] {
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as unknown;
    return Array.isArray(items) ? (items as StrategyRevision[]) : [];
  } catch {
    return [];
  }
}

export async function listStopFactors(stage?: string): Promise<StopFactorRecord[]> {
  const normalized = (stage ?? '').trim().toLowerCase();
  const rows = normalized
    ? await verificationDb.query<Record<string, unknown>>(
        `SELECT ${STOP_FACTOR_COLS} FROM stop_factors WHERE stage = $1 ORDER BY priority, id`,
        [normalized],
      )
    : await verificationDb.query<Record<string, unknown>>(
        `SELECT ${STOP_FACTOR_COLS} FROM stop_factors ORDER BY priority, id`,
      );
  return rows.map(parseStopFactor).filter((item): item is StopFactorRecord => item != null);
}

export async function createStopFactor(
  body: StopFactorWrite,
  actor: string,
): Promise<{ status: 'created'; id: string; item: StopFactorRecord }> {
  const meta = decisionRuleMeta(body.stage, body.meta);
  return withWriteTransaction(async (query) => {
    const rows = await query<{ id: number }>(
      `INSERT INTO stop_factors
         (name, stage, check_type, field_path, operator, threshold, action_on_fail,
          action_on_missing, provider_filter, enabled, priority, meta, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, NOW())
       RETURNING id`,
      [
        body.name,
        body.stage,
        body.check_type,
        body.field_path,
        body.operator,
        body.threshold,
        body.action_on_fail,
        body.action_on_missing,
        body.provider_filter,
        body.enabled,
        body.priority,
        JSON.stringify(meta),
      ],
    );
    const id = rows[0]?.id;
    if (id == null) throw new Error('stop factor insert returned no id');
    const saved = parseStopFactor({ ...body, meta, id });
    if (!saved) throw new Error('stop factor insert produced an unreadable row');
    await insertPlatformAudit(query, 'stop_factor', String(id), 'created', { ...body, meta }, actor);
    await bumpConfigVersion(query);
    return { status: 'created' as const, id: String(id), item: saved };
  });
}

export async function updateStopFactor(
  id: number,
  body: StopFactorWrite,
  actor: string,
): Promise<{ status: 'updated'; id: string; item: StopFactorRecord }> {
  const meta = decisionRuleMeta(body.stage, body.meta);
  return withWriteTransaction(async (query) => {
    const existing = await query<{ stage: string }>('SELECT stage FROM stop_factors WHERE id = $1', [id]);
    if (!existing[0]) {
      throw new AppError('stop factor not found', {
        statusCode: 404,
        code: 'VERIFICATION_NOT_FOUND',
        expose: true,
      });
    }
    await query(
      `UPDATE stop_factors
          SET name = $1, stage = $2, check_type = $3, field_path = $4, operator = $5,
              threshold = $6, action_on_fail = $7, action_on_missing = $8, provider_filter = $9,
              enabled = $10, priority = $11, meta = $12::jsonb, updated_at = NOW()
        WHERE id = $13`,
      [
        body.name,
        body.stage,
        body.check_type,
        body.field_path,
        body.operator,
        body.threshold,
        body.action_on_fail,
        body.action_on_missing,
        body.provider_filter,
        body.enabled,
        body.priority,
        JSON.stringify(meta),
        id,
      ],
    );
    const saved = parseStopFactor({ ...body, meta, id });
    if (!saved) throw new Error('stop factor update produced an unreadable row');
    await insertPlatformAudit(query, 'stop_factor', String(id), 'updated', { ...body, meta }, actor);
    await bumpConfigVersion(query);
    return { status: 'updated' as const, id: String(id), item: saved };
  });
}

export async function listDecisionStrategies(): Promise<DecisionStrategyRecord[]> {
  const raw = await readStateText(undefined, DECISION_STRATEGIES_STATE_KEY);
  return parseStrategyJson(raw);
}

async function saveStrategies(
  query: WriteQueryFn,
  items: DecisionStrategyRecord[],
  revision: DecisionStrategyRecord,
  action: string,
  actor: string,
  previous: DecisionStrategyRecord | null,
): Promise<DecisionStrategyRecord> {
  const normalized = normalizeDecisionStrategyList(items);
  await setSystemStateText(query, DECISION_STRATEGIES_STATE_KEY, JSON.stringify(normalized));
  const saved = normalized.find((item) => item.id === revision.id);
  if (!saved) throw new Error('decision strategy save lost the target row');
  const revisions = parseRevisionJson(await readStateText(query, DECISION_STRATEGIES_REVISIONS_STATE_KEY));
  const nextRevisions = appendDecisionStrategyRevision(revisions, saved, action, actor, previous);
  await setSystemStateText(
    query,
    DECISION_STRATEGIES_REVISIONS_STATE_KEY,
    JSON.stringify(nextRevisions),
  );
  await insertPlatformAudit(
    query,
    'decision_strategy',
    saved.id,
    action === 'created' ? 'created' : 'updated',
    { ...saved },
    actor,
  );
  await bumpConfigVersion(query);
  return saved;
}

export async function createDecisionStrategy(
  body: DecisionStrategyWrite,
  actor: string,
): Promise<{ status: 'created'; id: string; item: DecisionStrategyRecord }> {
  return withWriteTransaction(async (query) => {
    const items = parseStrategyJson(await readStateText(query, DECISION_STRATEGIES_STATE_KEY));
    const normalized = normalizeDecisionStrategyList([{ ...mergeStrategyWrite(body), version: 1 }])[0];
    if (!normalized) throw new Error('decision strategy create produced no row');
    const logicError = validateConditionLogic(normalized.logic, normalized.conditions.length);
    if (logicError) {
      throw new AppError(`invalid condition logic: ${logicError}`, {
        statusCode: 400,
        code: 'VERIFICATION_INVALID_LOGIC',
        expose: true,
      });
    }
    if (items.some((item) => item.id === normalized.id)) {
      throw new AppError('decision strategy id already exists', {
        statusCode: 409,
        code: 'VERIFICATION_CONFLICT',
        expose: true,
      });
    }
    const saved = await saveStrategies(query, [...items, normalized], normalized, 'created', actor, null);
    return { status: 'created' as const, id: saved.id, item: saved };
  });
}

export async function updateDecisionStrategy(
  strategyId: string,
  body: DecisionStrategyWrite,
  actor: string,
): Promise<{ status: 'updated'; id: string; item: DecisionStrategyRecord }> {
  const normalizedId = slugDecisionStrategyId(strategyId);
  return withWriteTransaction(async (query) => {
    const items = parseStrategyJson(await readStateText(query, DECISION_STRATEGIES_STATE_KEY));
    const existing = items.find((item) => item.id === normalizedId);
    if (!existing) {
      throw new AppError('decision strategy not found', {
        statusCode: 404,
        code: 'VERIFICATION_NOT_FOUND',
        expose: true,
      });
    }
    const payload = {
      ...mergeStrategyWrite(body, existing),
      id: normalizedId,
      version: Math.max(1, existing.version) + 1,
    };
    const updated = normalizeDecisionStrategyList([payload])[0];
    if (!updated) throw new Error('decision strategy update produced no row');
    const logicError = validateConditionLogic(updated.logic, updated.conditions.length);
    if (logicError) {
      throw new AppError(`invalid condition logic: ${logicError}`, {
        statusCode: 400,
        code: 'VERIFICATION_INVALID_LOGIC',
        expose: true,
      });
    }
    const saved = await saveStrategies(
      query,
      items.map((item) => (item.id === normalizedId ? updated : item)),
      updated,
      'updated',
      actor,
      existing,
    );
    return { status: 'updated' as const, id: saved.id, item: saved };
  });
}

export { parseStopFactor };
