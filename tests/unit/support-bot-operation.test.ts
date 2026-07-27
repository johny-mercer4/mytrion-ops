import { describe, expect, it, vi } from 'vitest';
import type { SupportBotOperation } from '../../src/db/schema/index.js';
import {
  supportBotIdempotencyKey,
  supportBotRequestHash,
  supportBotSessionKeyHash,
} from '../../src/modules/carrier/supportBotOperationIdentity.js';
import { createSupportBotOperationExecutor } from '../../src/modules/carrier/supportBotOperationService.js';
import type {
  ClaimSupportBotOperationInput,
  ClaimSupportBotOperationResult,
} from '../../src/repos/supportBotOperationRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'request-1',
};

const claimInput: ClaimSupportBotOperationInput = {
  idempotencyKey: 'idem-1',
  operationType: 'card_action',
  requestHash: 'hash-1',
  turnId: 'tg:100',
  writeOccurrence: 0,
  sessionKeyHash: 'session-hash',
  fencingToken: 7,
  actorTelegramUserId: '9001',
  carrierId: '44',
  leaseExpiresAt: new Date('2026-07-28T03:00:00.000Z'),
};

function operation(
  overrides: Partial<SupportBotOperation> = {},
): SupportBotOperation {
  return {
    id: 'sbo-1',
    tenantId: 'tenant-a',
    idempotencyKey: claimInput.idempotencyKey,
    operationType: claimInput.operationType,
    requestHash: claimInput.requestHash,
    turnId: claimInput.turnId,
    writeOccurrence: claimInput.writeOccurrence,
    sessionKeyHash: claimInput.sessionKeyHash,
    fencingToken: claimInput.fencingToken,
    actorTelegramUserId: claimInput.actorTelegramUserId,
    carrierId: claimInput.carrierId,
    status: 'processing',
    phase: 'claimed',
    sanitizedResponse: null,
    errorCode: null,
    leaseExpiresAt: claimInput.leaseExpiresAt,
    attempts: 1,
    createdAt: new Date('2026-07-28T02:00:00.000Z'),
    updatedAt: new Date('2026-07-28T02:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}

function fakeRepo(claim: ClaimSupportBotOperationResult) {
  return {
    claim: vi.fn(async () => claim),
    markExternalStarted: vi.fn(async () => true),
    markSucceeded: vi.fn(async () => undefined),
    markUnknown: vi.fn(async () => undefined),
  };
}

describe('support-bot operation identity', () => {
  it('hashes semantically identical validated arguments identically', () => {
    const a = supportBotRequestHash('card_action', {
      action: 'deactivate',
      nested: { z: 2, a: 1 },
    });
    const b = supportBotRequestHash('card_action', {
      nested: { a: 1, z: 2 },
      action: 'deactivate',
    });
    expect(a).toBe(b);
  });

  it('separates repeated writes in the same turn by persisted occurrence', () => {
    const base = {
      environment: 'staging',
      botIdentity: 'support',
      turnId: 'tg:100',
      tenantId: 'tenant-a',
      carrierId: '44',
      telegramUserId: '9001',
      operationType: 'card_action',
      requestHash: 'hash-1',
    };
    expect(supportBotIdempotencyKey({ ...base, writeOccurrence: 0 })).not.toBe(
      supportBotIdempotencyKey({ ...base, writeOccurrence: 1 }),
    );
  });

  it('does not expose raw Telegram identity in a session hash', () => {
    const hash = supportBotSessionKeyHash('staging', 'support', '-100', '9001');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('9001');
  });
});

describe('support-bot operation executor', () => {
  it('crosses the external boundary once and persists only the sanitized result', async () => {
    const repo = fakeRepo({ kind: 'claimed', operation: operation() });
    const execute = vi.fn(async () => ({
      success: true,
      last6: '123456',
      raw: { providerSecret: 'never-store' },
    }));
    const run = createSupportBotOperationExecutor(repo);

    await expect(
      run(ctx, {
        ...claimInput,
        execute,
        sanitize: (result) => ({ success: result.success, last6: result.last6 }),
      }),
    ).resolves.toEqual({
      operationId: 'sbo-1',
      replayed: false,
      result: { success: true, last6: '123456' },
    });
    expect(repo.markExternalStarted).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(repo.markSucceeded).toHaveBeenCalledWith(ctx, 'sbo-1', {
      success: true,
      last6: '123456',
    });
  });

  it('replays a completed result without executing the provider', async () => {
    const replay = { success: true, last6: '123456' };
    const repo = fakeRepo({
      kind: 'replay',
      operation: operation({
        status: 'succeeded',
        phase: 'completed',
        sanitizedResponse: replay,
      }),
    });
    const execute = vi.fn(async () => ({ success: true }));
    const run = createSupportBotOperationExecutor(repo);

    await expect(
      run(ctx, {
        ...claimInput,
        execute,
        sanitize: (result) => result,
      }),
    ).resolves.toEqual({
      operationId: 'sbo-1',
      replayed: true,
      result: replay,
    });
    expect(repo.markExternalStarted).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['stale_fence', 'SUPPORT_BOT_STALE_FENCE'],
    ['conflict', 'SUPPORT_BOT_IDEMPOTENCY_CONFLICT'],
    ['in_progress', 'SUPPORT_BOT_OPERATION_IN_PROGRESS'],
    ['reconcile', 'SUPPORT_BOT_OPERATION_RECONCILIATION_REQUIRED'],
  ] as const)('rejects %s before provider execution', async (kind, code) => {
    const result: ClaimSupportBotOperationResult =
      kind === 'stale_fence'
        ? { kind, currentFence: 8 }
        : { kind, operation: operation() };
    const repo = fakeRepo(result);
    const execute = vi.fn(async () => ({ success: true }));
    const run = createSupportBotOperationExecutor(repo);

    await expect(
      run(ctx, {
        ...claimInput,
        execute,
        sanitize: (output) => output,
      }),
    ).rejects.toMatchObject({ code });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses the provider call when the final fence check is lost', async () => {
    const repo = fakeRepo({ kind: 'claimed', operation: operation() });
    repo.markExternalStarted.mockResolvedValue(false);
    const execute = vi.fn(async () => ({ success: true }));
    const run = createSupportBotOperationExecutor(repo);

    await expect(
      run(ctx, {
        ...claimInput,
        execute,
        sanitize: (output) => output,
      }),
    ).rejects.toMatchObject({ code: 'SUPPORT_BOT_STALE_FENCE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('marks an ambiguous provider failure unknown and never retries it', async () => {
    const repo = fakeRepo({ kind: 'claimed', operation: operation() });
    const execute = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const run = createSupportBotOperationExecutor(repo);

    await expect(
      run(ctx, {
        ...claimInput,
        execute,
        sanitize: (output) => output,
      }),
    ).rejects.toMatchObject({ code: 'SUPPORT_BOT_OPERATION_OUTCOME_UNKNOWN' });
    expect(execute).toHaveBeenCalledOnce();
    expect(repo.markUnknown).toHaveBeenCalledWith(ctx, 'sbo-1', 'Error');
  });
});
