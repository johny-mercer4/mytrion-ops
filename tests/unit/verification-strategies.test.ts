import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/verificationOrchestrationDb.js', () => ({
  isOrchestrationDbConfigured: vi.fn(() => true),
  isOrchestrationWriteConfigured: vi.fn(() => true),
  listStopFactors: vi.fn(),
  createStopFactor: vi.fn(),
  updateStopFactor: vi.fn(),
  listDecisionStrategies: vi.fn(),
  createDecisionStrategy: vi.fn(),
  updateDecisionStrategy: vi.fn(),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));

import { AppError } from '../../src/lib/errors.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  createDecisionStrategy,
  createStopFactor,
  isOrchestrationDbConfigured,
  isOrchestrationWriteConfigured,
  listDecisionStrategies,
  listStopFactors,
  updateStopFactor,
} from '../../src/integrations/verificationOrchestrationDb.js';
import {
  listVerificationStopFactors,
  listVerificationStrategies,
  saveVerificationStopFactor,
  saveVerificationStrategy,
  stopFactorWriteSchema,
  strategyWriteSchema,
} from '../../src/modules/verification/verificationStrategies.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const listSf = vi.mocked(listStopFactors);
const createSf = vi.mocked(createStopFactor);
const updateSf = vi.mocked(updateStopFactor);
const listSt = vi.mocked(listDecisionStrategies);
const createSt = vi.mocked(createDecisionStrategy);
const dbConfigured = vi.mocked(isOrchestrationDbConfigured);
const writeConfigured = vi.mocked(isOrchestrationWriteConfigured);

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:1',
  userName: 'Test Worker',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: ['verification'],
  allDepartmentAccess: true,
  requestId: 'req_test',
};

const sampleFactor = {
  id: 9,
  name: 'Min score',
  stage: 'decision',
  check_type: 'field_check',
  field_path: null,
  operator: 'gte',
  threshold: '600',
  action_on_fail: 'REJECT',
  action_on_missing: 'PASS',
  provider_filter: null,
  enabled: true,
  priority: 0,
  meta: { decision_rule: true },
};

describe('verification strategy schemas', () => {
  it('accepts a stop-factor write and stamps decision_rule via save', async () => {
    const parsed = stopFactorWriteSchema.parse({
      name: 'Min score',
      stage: 'decision',
      check_type: 'field_check',
      operator: 'gte',
      threshold: '600',
      action_on_fail: 'REJECT',
    });
    createSf.mockResolvedValue({ status: 'created', id: '9', item: sampleFactor });
    const saved = await saveVerificationStopFactor(ctx, parsed);
    expect(saved.id).toBe('9');
    expect(createSf).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Min score',
        stage: 'decision',
        meta: expect.objectContaining({ decision_rule: true }),
      }),
      'Test Worker',
    );
  });

  it('requires a strategy title', () => {
    expect(() => strategyWriteSchema.parse({ title: '' })).toThrow();
    expect(strategyWriteSchema.parse({ title: 'Standard approval' }).lifecycle).toBe('draft');
  });
});

describe('verification strategy module', () => {
  it('lists stop factors and strategies from the verification DB', async () => {
    listSf.mockResolvedValue([]);
    listSt.mockResolvedValue([]);
    await expect(listVerificationStopFactors('pre')).resolves.toEqual({ items: [] });
    await expect(listVerificationStrategies()).resolves.toEqual({ items: [] });
    expect(listSf).toHaveBeenCalledWith('pre');
  });

  it('maps a missing stop factor to 404', async () => {
    updateSf.mockRejectedValue(
      new AppError('stop factor not found', { statusCode: 404, code: 'VERIFICATION_NOT_FOUND', expose: true }),
    );
    const parsed = stopFactorWriteSchema.parse({ name: 'X', stage: 'pre' });
    await expect(saveVerificationStopFactor(ctx, parsed, 3)).rejects.toMatchObject({
      statusCode: 404,
      code: 'VERIFICATION_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('creates a strategy through the verification DB', async () => {
    createSt.mockResolvedValue({
      status: 'created',
      id: 'cashflow',
      item: {
        id: 'cashflow',
        title: 'Cashflow',
        enabled: true,
        lifecycle: 'draft',
        version: 1,
        priority: 100,
        summary: '',
        outcome: '',
        data_sources: [],
        stage_scope: [],
        decision_actions: [],
        combined_fields: [],
        rule_bindings: [],
        conditions: [],
        logic: '',
        meta: {},
      },
    });
    const parsed = strategyWriteSchema.parse({ title: 'Cashflow', id: 'cashflow' });
    const saved = await saveVerificationStrategy(ctx, parsed);
    expect(saved.id).toBe('cashflow');
    expect(createSt).toHaveBeenCalled();
  });

  it('fails closed when the verification DSN is unset', async () => {
    dbConfigured.mockReturnValue(false);
    await expect(listVerificationStrategies()).rejects.toMatchObject({
      statusCode: 503,
      code: 'VERIFICATION_DB_UNCONFIGURED',
    });
    dbConfigured.mockReturnValue(true);
  });

  it('fails closed on write when VERIFICATION_WRITE_ENABLED is off', async () => {
    writeConfigured.mockReturnValue(false);
    const parsed = stopFactorWriteSchema.parse({ name: 'X', stage: 'pre' });
    await expect(saveVerificationStopFactor(ctx, parsed)).rejects.toMatchObject({
      statusCode: 503,
      code: 'VERIFICATION_WRITE_DISABLED',
    });
    writeConfigured.mockReturnValue(true);
  });
});
