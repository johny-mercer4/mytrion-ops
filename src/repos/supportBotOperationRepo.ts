import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  supportBotOperations,
  supportBotSessionFences,
  type NewSupportBotOperation,
  type SupportBotOperation,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface ClaimSupportBotOperationInput {
  idempotencyKey: string;
  operationType: string;
  requestHash: string;
  turnId: string;
  writeOccurrence: number;
  sessionKeyHash: string;
  fencingToken: number;
  actorTelegramUserId: string;
  carrierId: string;
  leaseExpiresAt: Date;
}

export type ClaimSupportBotOperationResult =
  | { kind: 'claimed' | 'reclaimed'; operation: SupportBotOperation }
  | { kind: 'replay'; operation: SupportBotOperation }
  | { kind: 'in_progress'; operation: SupportBotOperation }
  | { kind: 'reconcile'; operation: SupportBotOperation }
  | { kind: 'conflict'; operation: SupportBotOperation }
  | { kind: 'stale_fence'; currentFence: number | null };

export type TurnReplayDisposition =
  | { kind: 'clear' }
  | { kind: 'replay'; operations: SupportBotOperation[] }
  | { kind: 'reconcile'; operations: SupportBotOperation[] }
  | { kind: 'claimed'; operations: SupportBotOperation[] };

function sameClaim(
  existing: SupportBotOperation,
  input: ClaimSupportBotOperationInput,
): boolean {
  return (
    existing.requestHash === input.requestHash &&
    existing.operationType === input.operationType &&
    existing.turnId === input.turnId &&
    existing.writeOccurrence === input.writeOccurrence &&
    existing.sessionKeyHash === input.sessionKeyHash &&
    existing.actorTelegramUserId === input.actorTelegramUserId &&
    existing.carrierId === input.carrierId
  );
}

/**
 * Tenant-scoped operation/fence persistence. Fence verification and operation claim happen under
 * the same locked fence row and transaction; callers must not reproduce that sequence themselves.
 */
export const supportBotOperationRepo = {
  /** Register a new owner epoch using one global Postgres sequence. Gaps are harmless. */
  async issueFence(ctx: TenantContext, sessionKeyHash: string): Promise<number> {
    const rows = await db.execute<{ current_fence: string | number }>(sql`
      WITH next_fence AS (
        SELECT nextval('support_bot_fencing_seq')::bigint AS value
      )
      INSERT INTO support_bot_session_fences (
        tenant_id,
        session_key_hash,
        current_fence,
        updated_at
      )
      SELECT ${ctx.tenantId}, ${sessionKeyHash}, value, now()
      FROM next_fence
      ON CONFLICT (tenant_id, session_key_hash)
      DO UPDATE SET
        current_fence = EXCLUDED.current_fence,
        updated_at = now()
      RETURNING current_fence
    `);
    return Number(firstOrThrow(rows, 'issuing support-bot fence returned no row').current_fence);
  },

  /**
   * Atomically verify the current fence and claim/replay one idempotency operation.
   * An expired pre-external claim is safe to reclaim. Anything that reached the external boundary
   * requires reconciliation rather than a blind retry.
   */
  async claim(
    ctx: TenantContext,
    input: ClaimSupportBotOperationInput,
    now = new Date(),
  ): Promise<ClaimSupportBotOperationResult> {
    return db.transaction(async (tx) => {
      const fenceRows = await tx
        .select({ currentFence: supportBotSessionFences.currentFence })
        .from(supportBotSessionFences)
        .where(
          and(
            eq(supportBotSessionFences.tenantId, ctx.tenantId),
            eq(supportBotSessionFences.sessionKeyHash, input.sessionKeyHash),
          ),
        )
        .limit(1)
        .for('update');
      const currentFence = fenceRows[0]?.currentFence ?? null;
      if (currentFence !== input.fencingToken) {
        return { kind: 'stale_fence', currentFence };
      }

      const values: NewSupportBotOperation = {
        tenantId: ctx.tenantId,
        idempotencyKey: input.idempotencyKey,
        operationType: input.operationType,
        requestHash: input.requestHash,
        turnId: input.turnId,
        writeOccurrence: input.writeOccurrence,
        sessionKeyHash: input.sessionKeyHash,
        fencingToken: input.fencingToken,
        actorTelegramUserId: input.actorTelegramUserId,
        carrierId: input.carrierId,
        leaseExpiresAt: input.leaseExpiresAt,
      };
      const inserted = await tx
        .insert(supportBotOperations)
        .values(values)
        // Either the idempotency key or the persisted (turn, occurrence) slot may collide.
        // Targetless DO NOTHING keeps the transaction usable so we can classify both safely.
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return { kind: 'claimed', operation: inserted[0] };

      const keyRows = await tx
        .select()
        .from(supportBotOperations)
        .where(
          and(
            eq(supportBotOperations.tenantId, ctx.tenantId),
            eq(supportBotOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      const existingRows = keyRows.length
        ? keyRows
        : await tx
            .select()
            .from(supportBotOperations)
            .where(
              and(
                eq(supportBotOperations.tenantId, ctx.tenantId),
                eq(supportBotOperations.turnId, input.turnId),
                eq(
                  supportBotOperations.writeOccurrence,
                  input.writeOccurrence,
                ),
              ),
            )
            .limit(1);
      const existing = firstOrThrow(
        existingRows,
        'idempotency conflict returned no existing operation',
      );
      if (!sameClaim(existing, input)) return { kind: 'conflict', operation: existing };
      if (existing.status === 'succeeded') return { kind: 'replay', operation: existing };
      if (
        existing.status === 'unknown' ||
        existing.phase !== 'claimed'
      ) {
        return { kind: 'reconcile', operation: existing };
      }
      if (
        existing.status === 'processing' &&
        existing.leaseExpiresAt.getTime() > now.getTime()
      ) {
        return { kind: 'in_progress', operation: existing };
      }

      const reclaimed = await tx
        .update(supportBotOperations)
        .set({
          status: 'processing',
          phase: 'claimed',
          fencingToken: input.fencingToken,
          leaseExpiresAt: input.leaseExpiresAt,
          attempts: sql`${supportBotOperations.attempts} + 1`,
          errorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(supportBotOperations.tenantId, ctx.tenantId),
            eq(supportBotOperations.id, existing.id),
            inArray(supportBotOperations.status, ['processing', 'failed_safe']),
            eq(supportBotOperations.phase, 'claimed'),
          ),
        )
        .returning();
      return {
        kind: 'reclaimed',
        operation: firstOrThrow(reclaimed, 'reclaiming support-bot operation returned no row'),
      };
    });
  },

  /** Last fence check immediately before crossing the external side-effect boundary. */
  async markExternalStarted(
    ctx: TenantContext,
    operationId: string,
    sessionKeyHash: string,
    fencingToken: number,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const fences = await tx
        .select({ currentFence: supportBotSessionFences.currentFence })
        .from(supportBotSessionFences)
        .where(
          and(
            eq(supportBotSessionFences.tenantId, ctx.tenantId),
            eq(supportBotSessionFences.sessionKeyHash, sessionKeyHash),
          ),
        )
        .limit(1)
        .for('update');
      if (fences[0]?.currentFence !== fencingToken) return false;
      const rows = await tx
        .update(supportBotOperations)
        .set({ phase: 'external_started', updatedAt: new Date() })
        .where(
          and(
            eq(supportBotOperations.tenantId, ctx.tenantId),
            eq(supportBotOperations.id, operationId),
            eq(supportBotOperations.status, 'processing'),
            eq(supportBotOperations.phase, 'claimed'),
            eq(supportBotOperations.fencingToken, fencingToken),
          ),
        )
        .returning({ id: supportBotOperations.id });
      return rows.length === 1;
    });
  },

  async markSucceeded(
    ctx: TenantContext,
    operationId: string,
    sanitizedResponse: Record<string, unknown>,
  ): Promise<void> {
    await db
      .update(supportBotOperations)
      .set({
        status: 'succeeded',
        phase: 'completed',
        sanitizedResponse,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supportBotOperations.tenantId, ctx.tenantId),
          eq(supportBotOperations.id, operationId),
          eq(supportBotOperations.status, 'processing'),
        ),
      );
  },

  async markFailedSafe(
    ctx: TenantContext,
    operationId: string,
    errorCode: string,
  ): Promise<void> {
    await db
      .update(supportBotOperations)
      .set({
        status: 'failed_safe',
        phase: 'claimed',
        errorCode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supportBotOperations.tenantId, ctx.tenantId),
          eq(supportBotOperations.id, operationId),
          eq(supportBotOperations.phase, 'claimed'),
        ),
      );
  },

  async markUnknown(
    ctx: TenantContext,
    operationId: string,
    errorCode: string,
  ): Promise<void> {
    await db
      .update(supportBotOperations)
      .set({
        status: 'unknown',
        errorCode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supportBotOperations.tenantId, ctx.tenantId),
          eq(supportBotOperations.id, operationId),
          eq(supportBotOperations.phase, 'external_started'),
        ),
      );
  },

  async turnDisposition(
    ctx: TenantContext,
    turnId: string,
  ): Promise<TurnReplayDisposition> {
    const operations = await db
      .select()
      .from(supportBotOperations)
      .where(
        and(
          eq(supportBotOperations.tenantId, ctx.tenantId),
          eq(supportBotOperations.turnId, turnId),
        ),
      );
    if (!operations.length) return { kind: 'clear' };
    if (
      operations.some(
        (operation) =>
          operation.status === 'unknown' ||
          operation.phase === 'external_started' ||
          operation.phase === 'external_completed' ||
          operation.phase === 'delivery_queued',
      )
    ) {
      return { kind: 'reconcile', operations };
    }
    if (operations.every((operation) => operation.status === 'succeeded')) {
      return { kind: 'replay', operations };
    }
    return { kind: 'claimed', operations };
  },
};
