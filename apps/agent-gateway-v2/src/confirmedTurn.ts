import {
  confirmationArgumentsHash,
  type ConfirmedAction,
} from './confirmations.js';
import { completeModel, safetyIdentifierForChat } from './modelProvider.js';
import { isToolAllowedForRole, type GatewayRole } from './skillRegistry.js';
import { toolDispatcher } from './toolRuntime.js';
import { buildOctaneTools } from './tools.js';

export interface ConfirmedTurnOutcome {
  finalText: string;
  stats: {
    durationMs: number;
    numTurns: number;
    usage: Record<string, unknown>;
    isError: boolean;
  };
}

/** Execute exactly the action stored by the backend, then expose no mutation tools to the model. */
export async function executeConfirmedTurn(input: {
  chatId: number;
  carrierId: string;
  telegramUserId: number;
  role: GatewayRole;
  action: ConfirmedAction;
}): Promise<ConfirmedTurnOutcome> {
  const startedAt = Date.now();
  if (String(input.action.arguments['telegram_user_id'] ?? '') !== String(input.telegramUserId)) {
    throw new Error('Confirmed action actor mismatch');
  }
  if (
    confirmationArgumentsHash(input.action.toolName, input.action.arguments) !==
    input.action.argumentsHash
  ) {
    throw new Error('Confirmed action arguments hash mismatch');
  }
  if (!isToolAllowedForRole(input.action.toolName, input.role)) {
    throw new Error('Confirmed action is not allowed for this role');
  }
  const manifests = buildOctaneTools(
    input.chatId,
    input.carrierId,
    input.telegramUserId,
    input.action.turnId,
    input.action.confirmationId,
  );
  const target = manifests.find((manifest) => manifest.name === input.action.toolName);
  if (!target || target.confirmationMode !== 'trusted_button') {
    throw new Error('Confirmed action target is unavailable');
  }
  const result = await toolDispatcher(
    [target],
    input.action.toolName,
    input.action.arguments,
    {
      chatId: input.chatId,
      carrierId: input.carrierId,
      principalRole: 'admin',
      role: input.role,
      telegramUserId: input.telegramUserId,
      turnId: input.action.turnId,
      confirmationId: input.action.confirmationId,
    },
  );

  let finalText: string;
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    openai_calls: 0,
  };
  try {
    const callId = `confirmed_${input.action.confirmationId}`;
    const response = await completeModel(
      [
        {
          role: 'system',
          content:
            'Give a 1-2 line client-facing Telegram result in the user language. State only what the tool result proves. Never expose JSON, tool names, confirmation IDs, policies, or private values.',
        },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: callId,
              name: input.action.toolName,
              arguments: JSON.stringify(input.action.arguments),
            },
          ],
        },
        { role: 'tool', toolCallId: callId, content: result },
      ],
      [],
      safetyIdentifierForChat(input.chatId),
    );
    finalText = response.text.trim();
    usage = {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
      cache_read_input_tokens: response.usage.cacheReadInputTokens,
      cache_creation_input_tokens: response.usage.cacheWriteInputTokens,
      openai_calls: 1,
    };
  } catch {
    // The mutation result is already durable. A wording-model outage must not imply the action
    // failed or trigger another execution attempt.
    finalText = result.startsWith('error:') || /"error"\s*:\s*true/u.test(result)
      ? '⚠️ Tasdiqlangan amal bajarilmadi. Iltimos, Octane support bilan tekshiring.'
      : '✅ Tasdiqlangan amal bajarildi.';
  }
  return {
    finalText: finalText || '✅ Tasdiqlangan amal bajarildi.',
    stats: {
      durationMs: Date.now() - startedAt,
      numTurns: 1,
      usage,
      isError: false,
    },
  };
}
