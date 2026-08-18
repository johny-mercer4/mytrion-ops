import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

interface RecordedCall {
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];
let existingRows: Array<Record<string, unknown>> = [];
let pendingValues: Record<string, unknown> | null = null;
let queryKind: 'insert' | 'select' = 'select';

function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]): Record<string, unknown> => {
    calls.push({ method, args });
    if (method === 'insert') queryKind = 'insert';
    if (method === 'select') queryKind = 'select';
    if (method === 'values') pendingValues = args[0] as Record<string, unknown>;
    return builder;
  };
  for (const method of ['insert', 'values', 'onConflictDoNothing', 'returning', 'select', 'from', 'where', 'limit']) {
    builder[method] = record(method);
  }
  builder.execute = record('execute');
  builder.transaction = async (callback: (tx: Record<string, unknown>) => unknown) => callback(builder);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
    queryKind === 'insert' && pendingValues
      ? [{ ...pendingValues }]
      : existingRows,
  ).then(resolve);
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { automationLogRepo } from '../../src/repos/automationLogRepo.js';

const ctx: TenantContext = {
  tenantId: 'tenant-acme',
  userId: 'zoho:42',
  audience: 'internal',
  role: 'worker',
  scopes: [],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'automation-log-test',
};

describe('automation log lifecycle identity', () => {
  beforeEach(() => {
    calls = [];
    existingRows = [];
    pendingValues = null;
    queryKind = 'select';
  });

  it('uses the generated row id as run_id for a legacy succeeded payload', async () => {
    await automationLogRepo.insert(ctx, {
      automationType: 'balance_check',
      actorUserId: ctx.userId,
    });

    const values = calls.find((call) => call.method === 'values')?.args[0] as {
      id: string;
      runId: string;
      phase: string;
    };
    expect(values.id).toBeTruthy();
    expect(values.runId).toBe(values.id);
    expect(values.phase).toBe('succeeded');
  });

  it('keeps a caller-provided lifecycle run id distinct from the row id', async () => {
    const runId = '4f86cf44-1daa-4fd3-8df5-999cb27430c9';
    await automationLogRepo.insert(ctx, {
      automationType: 'balance_check',
      actorUserId: ctx.userId,
      runId,
      phase: 'started',
    });

    const values = calls.find((call) => call.method === 'values')?.args[0] as {
      id: string;
      runId: string;
    };
    expect(values.runId).toBe(runId);
    expect(values.id).not.toBe(runId);
  });

  it('returns the stored phase when the same lifecycle request is replayed', async () => {
    const runId = '4f86cf44-1daa-4fd3-8df5-999cb27430c9';
    existingRows = [{
      id: 'stored-phase',
      tenantId: ctx.tenantId,
      runId,
      phase: 'started',
      actorUserId: ctx.userId,
      impersonatorUserId: null,
      automationType: 'balance_check',
      originSource: 'Mytrion Horizon',
    }];

    const result = await automationLogRepo.insert(ctx, {
      automationType: 'balance_check',
      actorUserId: ctx.userId,
      originSource: 'Mytrion Horizon',
      runId,
      phase: 'started',
    });

    expect(result).toMatchObject({ inserted: false, log: { id: 'stored-phase' } });
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('rejects a second, contradictory terminal outcome for one run', async () => {
    const runId = '4f86cf44-1daa-4fd3-8df5-999cb27430c9';
    existingRows = [{
      tenantId: ctx.tenantId,
      runId,
      phase: 'succeeded',
      actorUserId: ctx.userId,
      impersonatorUserId: null,
      automationType: 'balance_check',
      originSource: 'Mytrion Horizon',
    }];

    await expect(automationLogRepo.insert(ctx, {
      automationType: 'balance_check',
      actorUserId: ctx.userId,
      originSource: 'Mytrion Horizon',
      runId,
      phase: 'failed',
      durationMs: 50,
      errorCode: 'automation_failed',
    })).rejects.toMatchObject({ statusCode: 409, code: 'AUTOMATION_RUN_CONFLICT' });
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('rejects attribution changes between lifecycle phases', async () => {
    const runId = '4f86cf44-1daa-4fd3-8df5-999cb27430c9';
    existingRows = [{
      tenantId: ctx.tenantId,
      runId,
      phase: 'started',
      actorUserId: 'zoho:someone-else',
      impersonatorUserId: null,
      automationType: 'balance_check',
      originSource: 'Mytrion Horizon',
    }];

    await expect(automationLogRepo.insert(ctx, {
      automationType: 'balance_check',
      actorUserId: ctx.userId,
      originSource: 'Mytrion Horizon',
      runId,
      phase: 'succeeded',
      durationMs: 50,
    })).rejects.toMatchObject({ statusCode: 409, code: 'AUTOMATION_RUN_CONFLICT' });
  });
});
