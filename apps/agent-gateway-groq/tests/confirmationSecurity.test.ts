import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatcher: vi.fn(async () => JSON.stringify({ success: true })),
  completeModel: vi.fn(async () => {
    throw new Error('wording model unavailable');
  }),
  roleAllowed: vi.fn(() => true),
}));

const target = {
  name: 'octane_card_action',
  description: 'Deactivate one card',
  parameters: {},
  riskClass: 'write' as const,
  confirmationMode: 'trusted_button' as const,
  execute: vi.fn(),
};

vi.mock('../src/config.js', () => ({
  config: {
    octaneBase: 'http://localhost:3000',
    octaneSupportBotKey: 'test-support-key',
  },
}));
vi.mock('../src/tools.js', () => ({ buildOctaneTools: () => [target] }));
vi.mock('../src/toolRuntime.js', () => ({ toolDispatcher: mocks.dispatcher }));
vi.mock('../src/modelProvider.js', () => ({
  completeModel: mocks.completeModel,
  safetyIdentifierForChat: () => 'safe-chat',
}));
vi.mock('../src/skillRegistry.js', () => ({ isToolAllowedForRole: mocks.roleAllowed }));

import {
  confirmationArgumentsHash,
  newConfirmationToken,
  parseConfirmationCallback,
} from '../src/confirmations.js';
import { executeConfirmedTurn } from '../src/confirmedTurn.js';
import { gatewayOperationKey } from '../src/operationIdentity.js';
import { backendErrorInfo } from '../src/octaneClient.js';

const argumentsValue = {
  telegram_user_id: 9001,
  action: 'deactivate',
  card_last6: '123456',
};

function action() {
  return {
    confirmationId: 'confirmation-1',
    toolName: 'octane_card_action' as const,
    arguments: argumentsValue,
    argumentsHash: confirmationArgumentsHash('octane_card_action', argumentsValue),
    turnId: 'confirmation:confirmation-1',
  };
}

describe('server-bound confirmation trajectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.roleAllowed.mockReturnValue(true);
    mocks.dispatcher.mockResolvedValue(JSON.stringify({ success: true }));
    mocks.completeModel.mockRejectedValue(new Error('wording model unavailable'));
  });

  it('accepts only opaque callbacks; typed yes and model-shaped callbacks are untrusted', () => {
    const token = newConfirmationToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/u);
    expect(parseConfirmationCallback(`c:${token}`)).toEqual({ decision: 'confirm', token });
    expect(parseConfirmationCallback(`x:${token}`)).toEqual({ decision: 'cancel', token });
    expect(parseConfirmationCallback('yes')).toBeNull();
    expect(parseConfirmationCallback('confirm:octane_card_action:yes')).toBeNull();
    expect(parseConfirmationCallback(`c:${token}:octane_override`)).toBeNull();
  });

  it('executes exactly the backend-stored tool and arguments once', async () => {
    const result = await executeConfirmedTurn({
      chatId: -1001,
      carrierId: 'carrier-a',
      telegramUserId: 9001,
      role: 'owner',
      action: action(),
    });

    expect(mocks.dispatcher).toHaveBeenCalledTimes(1);
    expect(mocks.dispatcher).toHaveBeenCalledWith(
      [target],
      'octane_card_action',
      argumentsValue,
      expect.objectContaining({
        chatId: -1001,
        carrierId: 'carrier-a',
        telegramUserId: 9001,
        turnId: 'confirmation:confirmation-1',
        confirmationId: 'confirmation-1',
      }),
    );
    expect(mocks.completeModel).toHaveBeenCalledWith(expect.any(Array), [], 'safe-chat');
    expect(result.finalText).toContain('amal bajarildi');
  });

  it('fails closed before dispatch on actor, hash, or role tampering', async () => {
    await expect(
      executeConfirmedTurn({
        chatId: -1001,
        carrierId: 'carrier-a',
        telegramUserId: 9002,
        role: 'owner',
        action: action(),
      }),
    ).rejects.toThrow('actor mismatch');

    await expect(
      executeConfirmedTurn({
        chatId: -1001,
        carrierId: 'carrier-a',
        telegramUserId: 9001,
        role: 'owner',
        action: { ...action(), argumentsHash: 'tampered' },
      }),
    ).rejects.toThrow('arguments hash mismatch');

    mocks.roleAllowed.mockReturnValue(false);
    await expect(
      executeConfirmedTurn({
        chatId: -1001,
        carrierId: 'carrier-a',
        telegramUserId: 9001,
        role: 'driver',
        action: action(),
      }),
    ).rejects.toThrow('not allowed');
    expect(mocks.dispatcher).not.toHaveBeenCalled();
  });

  it('derives the same write key for duplicate delivery of one confirmed turn', () => {
    const base = {
      environment: 'production',
      botIdentity: 'octane-bot',
      turnId: 'confirmation:confirmation-1',
      writeOccurrence: 0,
      tenantId: 'octane',
      carrierId: 'carrier-a',
      telegramUserId: 9001,
      operationType: 'card_action',
      arguments: argumentsValue,
    };
    expect(gatewayOperationKey(base)).toBe(gatewayOperationKey({
      ...base,
      arguments: { card_last6: '123456', action: 'deactivate', telegram_user_id: 9001 },
    }));
    expect(gatewayOperationKey(base)).not.toBe(
      gatewayOperationKey({ ...base, turnId: 'confirmation:confirmation-2' }),
    );
  });

  it('preserves the backend fail-closed error code and safe message', () => {
    expect(backendErrorInfo({
      error: {
        code: 'SUPPORT_BOT_IDEMPOTENCY_CONFLICT',
        message: 'The key belongs to another operation.',
      },
    }, 409)).toEqual({
      code: 'SUPPORT_BOT_IDEMPOTENCY_CONFLICT',
      message: 'The key belongs to another operation.',
    });
  });
});
