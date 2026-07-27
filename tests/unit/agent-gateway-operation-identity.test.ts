import { describe, expect, it } from 'vitest';
import {
  gatewayOperationKey,
  gatewaySessionKeyHash,
} from '../../apps/agent-gateway/src/operationIdentity.js';

describe('agent-gateway operation identity', () => {
  const base = {
    environment: 'staging',
    botIdentity: 'octane-test',
    turnId: 'tg:700',
    writeOccurrence: 0,
    tenantId: 'tenant-a',
    carrierId: '44',
    telegramUserId: 9001,
    operationType: 'card_action',
  };

  it('is stable across argument key order', () => {
    const left = gatewayOperationKey({
      ...base,
      arguments: { action: 'deactivate', nested: { z: 2, a: 1 } },
    });
    const right = gatewayOperationKey({
      ...base,
      arguments: { nested: { a: 1, z: 2 }, action: 'deactivate' },
    });
    expect(left).toBe(right);
  });

  it('separates turns and repeated calls', () => {
    const first = gatewayOperationKey({
      ...base,
      arguments: { action: 'deactivate' },
    });
    expect(
      gatewayOperationKey({
        ...base,
        writeOccurrence: 1,
        arguments: { action: 'deactivate' },
      }),
    ).not.toBe(first);
    expect(
      gatewayOperationKey({
        ...base,
        turnId: 'tg:701',
        arguments: { action: 'deactivate' },
      }),
    ).not.toBe(first);
  });

  it('hashes the session without exposing Telegram IDs', () => {
    const hash = gatewaySessionKeyHash('staging', 'octane-test', -100, 9001);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('9001');
  });
});
