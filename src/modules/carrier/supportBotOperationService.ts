import { AppError } from '../../lib/errors.js';
import {
  supportBotOperationRepo,
  type ClaimSupportBotOperationInput,
  type ClaimSupportBotOperationResult,
} from '../../repos/supportBotOperationRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

interface OperationRepo {
  claim(
    ctx: TenantContext,
    input: ClaimSupportBotOperationInput,
  ): Promise<ClaimSupportBotOperationResult>;
  markExternalStarted(
    ctx: TenantContext,
    operationId: string,
    sessionKeyHash: string,
    fencingToken: number,
  ): Promise<boolean>;
  markSucceeded(
    ctx: TenantContext,
    operationId: string,
    response: Record<string, unknown>,
  ): Promise<void>;
  markUnknown(ctx: TenantContext, operationId: string, errorCode: string): Promise<void>;
}

export interface ExecuteSupportBotOperationInput<TOutput extends Record<string, unknown>>
  extends ClaimSupportBotOperationInput {
  execute: () => Promise<TOutput>;
  sanitize: (output: TOutput) => Record<string, unknown>;
}

export interface SupportBotOperationExecution {
  operationId: string;
  replayed: boolean;
  result: Record<string, unknown>;
}

function conflict(code: string, message: string): AppError {
  return new AppError(message, { statusCode: 409, code, expose: true });
}

/**
 * State-changing support-bot execution boundary. Authorization and input validation must happen
 * before this function. Once `external_started` commits, every ambiguous failure becomes `unknown`
 * and cannot be retried automatically.
 */
export function createSupportBotOperationExecutor(repo: OperationRepo) {
  return async function executeSupportBotOperation<TOutput extends Record<string, unknown>>(
    ctx: TenantContext,
    input: ExecuteSupportBotOperationInput<TOutput>,
  ): Promise<SupportBotOperationExecution> {
    const claim = await repo.claim(ctx, input);
    if (claim.kind === 'stale_fence') {
      throw conflict('SUPPORT_BOT_STALE_FENCE', 'This worker no longer owns the session.');
    }
    if (claim.kind === 'conflict') {
      throw conflict(
        'SUPPORT_BOT_IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for another operation.',
      );
    }
    if (claim.kind === 'in_progress') {
      throw conflict(
        'SUPPORT_BOT_OPERATION_IN_PROGRESS',
        'This operation is already in progress.',
      );
    }
    if (claim.kind === 'reconcile') {
      throw conflict(
        'SUPPORT_BOT_OPERATION_RECONCILIATION_REQUIRED',
        'The previous attempt has an uncertain outcome and must be reconciled.',
      );
    }
    if (claim.kind === 'replay') {
      if (!claim.operation.sanitizedResponse) {
        throw conflict(
          'SUPPORT_BOT_REPLAY_RESULT_MISSING',
          'The completed operation has no safe replay result.',
        );
      }
      return {
        operationId: claim.operation.id,
        replayed: true,
        result: claim.operation.sanitizedResponse,
      };
    }

    const operation = claim.operation;
    const started = await repo.markExternalStarted(
      ctx,
      operation.id,
      input.sessionKeyHash,
      input.fencingToken,
    );
    if (!started) {
      throw conflict('SUPPORT_BOT_STALE_FENCE', 'This worker no longer owns the session.');
    }

    let output: TOutput;
    try {
      output = await input.execute();
    } catch (error) {
      await repo
        .markUnknown(
          ctx,
          operation.id,
          error instanceof Error ? error.name : 'EXTERNAL_OPERATION_ERROR',
        )
        .catch(() => undefined);
      throw conflict(
        'SUPPORT_BOT_OPERATION_OUTCOME_UNKNOWN',
        'The provider outcome is uncertain. The operation was not retried.',
      );
    }

    const sanitized = input.sanitize(output);
    try {
      await repo.markSucceeded(ctx, operation.id, sanitized);
    } catch {
      // The provider returned success but persistence did not. Leave the durable phase at
      // external_started so turn replay routes to reconciliation instead of repeating the write.
      throw conflict(
        'SUPPORT_BOT_OPERATION_OUTCOME_UNKNOWN',
        'The provider succeeded but the result could not be recorded.',
      );
    }
    return { operationId: operation.id, replayed: false, result: sanitized };
  };
}

export const executeSupportBotOperation =
  createSupportBotOperationExecutor(supportBotOperationRepo);
