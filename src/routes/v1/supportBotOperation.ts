import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { supportBotRequestHash } from '../../modules/carrier/supportBotOperationIdentity.js';
import { executeSupportBotOperation } from '../../modules/carrier/supportBotOperationService.js';
import { supportBotConfirmationRepo } from '../../repos/supportBotConfirmationRepo.js';
import { requireContext } from './helpers.js';

const operationHeadersSchema = z.object({
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/u),
  confirmationId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  writeOccurrence: z.coerce.number().int().min(0).max(100),
  sessionKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  fencingToken: z.coerce.number().int().positive(),
});

function stringHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function operationHeaders(request: FastifyRequest) {
  return operationHeadersSchema.parse({
    idempotencyKey: stringHeader(request, 'idempotency-key'),
    confirmationId: stringHeader(request, 'x-support-bot-confirmation-id'),
    turnId: stringHeader(request, 'x-support-bot-turn-id'),
    writeOccurrence: stringHeader(request, 'x-support-bot-write-occurrence'),
    sessionKeyHash: stringHeader(request, 'x-support-bot-session-key'),
    fencingToken: stringHeader(request, 'x-support-bot-fencing-token'),
  });
}

export interface SupportBotWriteResult {
  operationId: string | null;
  replayed: boolean;
  result: Record<string, unknown>;
}

const confirmedToolByOperation = {
  money_code: 'octane_money_code',
  card_action: 'octane_card_action',
  card_limits: 'octane_card_limits',
  card_info: 'octane_card_info',
  service_request: 'octane_service_request',
  override: 'octane_override',
} as const;

type SupportBotMutationOperation = keyof typeof confirmedToolByOperation;

async function requireConsumedConfirmation(
  request: FastifyRequest,
  input: {
    confirmationId: string;
    turnId: string;
    writeOccurrence: number;
    operationType: SupportBotMutationOperation;
    actorTelegramUserId: string;
    carrierId: string;
    confirmationArguments: Record<string, unknown>;
  },
): Promise<void> {
  const confirmation = await supportBotConfirmationRepo.findById(
    requireContext(request),
    input.confirmationId,
  );
  const toolName = confirmedToolByOperation[input.operationType];
  const argumentsHash = supportBotRequestHash(toolName, input.confirmationArguments);
  if (
    !confirmation ||
    confirmation.status !== 'consumed' ||
    confirmation.carrierId !== input.carrierId ||
    confirmation.telegramUserId !== input.actorTelegramUserId ||
    confirmation.toolName !== toolName ||
    confirmation.argumentsHash !== argumentsHash ||
    input.turnId !== `confirmation:${confirmation.id}` ||
    input.writeOccurrence !== 0
  ) {
    throw new AppError('Mutation does not match a consumed Telegram confirmation', {
      statusCode: 403,
      code: 'SUPPORT_BOT_CONFIRMATION_REQUIRED',
      expose: true,
    });
  }
}

/** Shared idempotency/fencing boundary for every Telegram-originated state mutation. */
export async function executeSupportBotWrite<TOutput extends Record<string, unknown>>(
  request: FastifyRequest,
  input: {
    operationType: SupportBotMutationOperation;
    actorTelegramUserId: string;
    carrierId: string;
    validatedArguments: Record<string, unknown>;
    confirmationArguments: Record<string, unknown>;
    execute: () => Promise<TOutput>;
    prepare?: () => void | Promise<void>;
    sanitize: (output: TOutput) => Record<string, unknown>;
    leaseMs?: number;
  },
): Promise<SupportBotWriteResult> {
  if (!env.FF_SUPPORT_BOT_IDEMPOTENCY) {
    await input.prepare?.();
    const output = await input.execute();
    return { operationId: null, replayed: false, result: input.sanitize(output) };
  }
  const headers = operationHeaders(request);
  await requireConsumedConfirmation(request, {
    confirmationId: headers.confirmationId,
    turnId: headers.turnId,
    writeOccurrence: headers.writeOccurrence,
    operationType: input.operationType,
    actorTelegramUserId: input.actorTelegramUserId,
    carrierId: input.carrierId,
    confirmationArguments: input.confirmationArguments,
  });
  const { confirmationId: _confirmationId, ...operationMetadata } = headers;
  const execution = await executeSupportBotOperation(requireContext(request), {
    ...operationMetadata,
    operationType: input.operationType,
    requestHash: supportBotRequestHash(input.operationType, input.validatedArguments),
    actorTelegramUserId: input.actorTelegramUserId,
    carrierId: input.carrierId,
    leaseExpiresAt: new Date(Date.now() + (input.leaseMs ?? 2 * 60_000)),
    ...(input.prepare ? { prepare: input.prepare } : {}),
    execute: input.execute,
    sanitize: input.sanitize,
  });
  return execution;
}
