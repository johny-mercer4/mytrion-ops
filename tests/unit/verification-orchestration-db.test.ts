import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const readQuery = vi.fn();

vi.mock('../../src/integrations/verificationDb.js', () => ({
  verificationDb: {
    isConfigured: () => true,
    query: (...args: unknown[]) => readQuery(...args),
  },
}));

vi.mock('../../src/integrations/creditPlatformWriteDb.js', () => ({
  isWriteConfigured: () => true,
  withWriteTransaction: async (fn: (q: typeof queryMock) => Promise<unknown>) => fn(queryMock),
  writeQuery: vi.fn(),
}));

import {
  createDecisionStrategy,
  createStopFactor,
  listDecisionStrategies,
  listStopFactors,
  updateDecisionStrategy,
  updateStopFactor,
} from '../../src/integrations/verificationOrchestrationDb.js';

describe('verification orchestration DB', () => {
  beforeEach(() => {
    queryMock.mockReset();
    readQuery.mockReset();
  });

  it('lists stop factors with the mono column list and optional stage filter', async () => {
    readQuery.mockResolvedValue([
      {
        id: 4,
        name: 'Min score',
        stage: 'pre',
        check_type: 'field_check',
        field_path: 'score',
        operator: 'gte',
        threshold: '500',
        action_on_fail: 'REJECT',
        action_on_missing: 'PASS',
        provider_filter: null,
        enabled: true,
        priority: 0,
        meta: {},
      },
    ]);
    const items = await listStopFactors('pre');
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Min score');
    expect(String(readQuery.mock.calls[0]?.[0])).toContain('FROM stop_factors WHERE stage = $1');
    expect(readQuery.mock.calls[0]?.[1]).toEqual(['pre']);
  });

  it('inserts a stop factor, audits, and bumps config_version', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 12 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const saved = await createStopFactor(
      {
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
        meta: {},
      },
      'Test Worker',
    );
    expect(saved).toMatchObject({ status: 'created', id: '12' });
    expect(saved.item.meta).toMatchObject({ decision_rule: true });
    const sql = queryMock.mock.calls.map((call) => String(call[0]));
    expect(sql[0]).toContain('INSERT INTO stop_factors');
    expect(sql[0]).toContain('updated_at');
    expect(sql[1]).toContain('INSERT INTO audit_log');
    expect(sql[2]).toContain("VALUES ($1, '1')");
    expect(queryMock.mock.calls[2]?.[1]).toEqual(['config_version']);
  });

  it('404s when updating a missing stop factor', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(
      updateStopFactor(
        99,
        {
          name: 'X',
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
        },
        'Test Worker',
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'VERIFICATION_NOT_FOUND' });
  });

  it('lists strategies from system_state.decision_strategies_json', async () => {
    readQuery.mockResolvedValueOnce([
      {
        value_text: JSON.stringify([
          { id: 'llc', title: 'Credit score', enabled: true, lifecycle: 'published', version: 6, priority: 100 },
        ]),
      },
    ]);
    const items = await listDecisionStrategies();
    expect(items[0]).toMatchObject({ id: 'llc', title: 'Credit score', version: 6 });
    expect(readQuery.mock.calls[0]?.[1]).toEqual(['decision_strategies_json']);
  });

  it('creates a strategy, writes revisions, audits, and bumps config_version', async () => {
    queryMock
      .mockResolvedValueOnce([{ value_text: '[]' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value_text: '[]' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const saved = await createDecisionStrategy({ title: 'Cashflow', id: 'cashflow' } as never, 'Test Worker');
    expect(saved.status).toBe('created');
    expect(saved.id).toBe('cashflow');
    const keys = queryMock.mock.calls.map((call) => call[1]?.[0]);
    expect(keys).toContain('decision_strategies_json');
    expect(keys).toContain('decision_strategies_revisions_json');
    expect(keys).toContain('config_version');
    const written = queryMock.mock.calls.find(
      (call) => call[1]?.[0] === 'decision_strategies_json' && typeof call[1]?.[1] === 'string',
    );
    const parsed = JSON.parse(String(written?.[1]?.[1] ?? '[]')) as Array<{ id: string }>;
    expect(parsed.map((item) => item.id)).toContain('cashflow');
  });

  it('appends a strategy onto an existing list without replacing it', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          value_text: JSON.stringify([
            { id: 'llc', title: 'Credit score', enabled: true, lifecycle: 'published', version: 6, priority: 100 },
          ]),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value_text: '[]' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await createDecisionStrategy({ title: 'Cashflow', id: 'cashflow' } as never, 'Test Worker');
    const written = queryMock.mock.calls.find(
      (call) => call[1]?.[0] === 'decision_strategies_json' && typeof call[1]?.[1] === 'string',
    );
    const parsed = JSON.parse(String(written?.[1]?.[1] ?? '[]')) as Array<{ id: string }>;
    expect(parsed.map((item) => item.id).sort()).toEqual(['cashflow', 'llc']);
  });

  it('increments version on update and 409s on duplicate create', async () => {
    queryMock.mockResolvedValueOnce([
      {
        value_text: JSON.stringify([
          { id: 'llc', title: 'Credit score', enabled: true, lifecycle: 'published', version: 6, priority: 100 },
        ]),
      },
    ]);
    await expect(
      createDecisionStrategy({ title: 'Credit score', id: 'llc' } as never, 'Test Worker'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VERIFICATION_CONFLICT' });

    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce([
        {
          value_text: JSON.stringify([
            { id: 'llc', title: 'Credit score', enabled: true, lifecycle: 'published', version: 6, priority: 100, meta: { severity: 'hard' } },
          ]),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value_text: '[]' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const updated = await updateDecisionStrategy(
      'llc',
      { title: 'Credit score', enabled: false, lifecycle: 'published', priority: 100 } as never,
      'Test Worker',
    );
    expect(updated.item.version).toBe(7);
    expect(updated.item.enabled).toBe(false);
    expect(updated.item.meta).toMatchObject({ severity: 'hard' });
  });
});
