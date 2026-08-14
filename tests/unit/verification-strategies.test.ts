import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/creditPlatformConfig.js', () => ({
  isCreditPlatformConfigConfigured: vi.fn(() => true),
  listStopFactors: vi.fn(),
  createStopFactor: vi.fn(),
  updateStopFactor: vi.fn(),
  listDecisionStrategies: vi.fn(),
  createDecisionStrategy: vi.fn(),
  updateDecisionStrategy: vi.fn(),
  parseStopFactor: vi.fn((raw: { id?: number; name?: string }) =>
    raw.id && raw.name
      ? {
          id: raw.id,
          name: raw.name,
          stage: 'pre',
          check_type: 'field_check',
          field_path: null,
          operator: 'gte',
          threshold: null,
          action_on_fail: 'REJECT',
          action_on_missing: 'PASS',
          provider_filter: null,
          enabled: true,
          priority: 0,
          meta: {},
        }
      : null,
  ),
  parseDecisionStrategy: vi.fn((raw: { id?: string; title?: string }) =>
    raw.id || raw.title
      ? {
          id: raw.id ?? 'x',
          title: raw.title ?? 'X',
          enabled: true,
          lifecycle: 'draft',
          version: 1,
          priority: 10,
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
        }
      : null,
  ),
}));

vi.mock('../../src/integrations/creditPlatformClient.js', () => ({
  isCreditPlatformConfigured: vi.fn(() => true),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));

import { AppError } from '../../src/lib/errors.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  createStopFactor,
  createDecisionStrategy,
  isCreditPlatformConfigConfigured,
  listDecisionStrategies,
  listStopFactors,
  updateStopFactor,
} from '../../src/integrations/creditPlatformConfig.js';
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
const configured = vi.mocked(isCreditPlatformConfigConfigured);

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:1',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: ['verification'],
  allDepartmentAccess: true,
  requestId: 'req_test',
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
    createSf.mockResolvedValue({ ok: true, status: 201, json: { status: 'created', id: '9' } });
    const saved = await saveVerificationStopFactor(ctx, parsed);
    expect(saved.id).toBe('9');
    expect(createSf).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Min score',
        stage: 'decision',
        meta: expect.objectContaining({ decision_rule: true }),
      }),
    );
  });

  it('requires a strategy title', () => {
    expect(() => strategyWriteSchema.parse({ title: '' })).toThrow();
    expect(strategyWriteSchema.parse({ title: 'Standard approval' }).lifecycle).toBe('draft');
  });
});

describe('verification strategy module', () => {
  it('lists stop factors and strategies from credit-platform', async () => {
    listSf.mockResolvedValue([]);
    listSt.mockResolvedValue([]);
    await expect(listVerificationStopFactors('pre')).resolves.toEqual({ items: [] });
    await expect(listVerificationStrategies()).resolves.toEqual({ items: [] });
    expect(listSf).toHaveBeenCalledWith('pre');
  });

  it('maps a 403 config write to an operator-facing 502', async () => {
    updateSf.mockResolvedValue({
      ok: false,
      status: 403,
      json: { detail: 'admin role required' },
    });
    const parsed = stopFactorWriteSchema.parse({ name: 'X', stage: 'pre' });
    await expect(saveVerificationStopFactor(ctx, parsed, 3)).rejects.toMatchObject({
      statusCode: 502,
      code: 'CREDIT_PLATFORM_FORBIDDEN',
    } satisfies Partial<AppError>);
  });

  it('creates a strategy through the config API', async () => {
    createSt.mockResolvedValue({
      ok: true,
      status: 201,
      json: { status: 'created', id: 'cashflow', item: { id: 'cashflow', title: 'Cashflow' } },
    });
    const parsed = strategyWriteSchema.parse({ title: 'Cashflow', id: 'cashflow' });
    const saved = await saveVerificationStrategy(ctx, parsed);
    expect(saved.id).toBe('cashflow');
    expect(createSt).toHaveBeenCalled();
  });

  it('fails closed when credit-platform is not configured', async () => {
    configured.mockReturnValue(false);
    const client = await import('../../src/integrations/creditPlatformClient.js');
    vi.mocked(client.isCreditPlatformConfigured).mockReturnValue(false);
    await expect(listVerificationStrategies()).rejects.toMatchObject({
      statusCode: 503,
      code: 'CREDIT_PLATFORM_NOT_CONFIGURED',
    });
    configured.mockReturnValue(true);
    vi.mocked(client.isCreditPlatformConfigured).mockReturnValue(true);
  });
});
