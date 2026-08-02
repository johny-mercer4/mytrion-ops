import { describe, expect, it } from 'vitest';
import { assertSupportBotGroupCapacity } from '../../src/modules/carrier/supportBotGroupCapacity.js';

describe('support-bot 800-group hard limit', () => {
  it('accepts the 800th enabled mapping and rejects the 801st', () => {
    expect(() => assertSupportBotGroupCapacity(false, 799, 800)).not.toThrow();
    expect(() => assertSupportBotGroupCapacity(false, 800, 800)).toThrow(
      expect.objectContaining({
        statusCode: 409,
        code: 'SUPPORT_BOT_GROUP_LIMIT_REACHED',
      }),
    );
  });

  it('allows an existing enabled chat to be updated without consuming another slot', () => {
    expect(() => assertSupportBotGroupCapacity(true, 800, 800)).not.toThrow();
  });
});
