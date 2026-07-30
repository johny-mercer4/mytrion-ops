import { describe, expect, it } from 'vitest';
import { supportBotMemoryRepo } from '../../src/repos/supportBotMemoryRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function context(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: 'gateway',
    audience: 'customer',
    role: 'fleet_manager',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: `req:${tenantId}`,
  };
}

describe('support-bot memory vector isolation', () => {
  it('binds tenant, carrier, chat, and Telegram user into every recall query', () => {
    const rendered = supportBotMemoryRepo
      .buildSearchQuery(
        context('tenant-a'),
        {
          carrierId: 'carrier-a',
          chatId: '-1001',
          telegramUserId: 'user-a',
        },
        [0.1, 0.2, 0.3],
        3,
      )
      .toSQL();

    expect(rendered.sql).toContain('"support_bot_memories"."tenant_id"');
    expect(rendered.sql).toContain('"support_bot_memories"."carrier_id"');
    expect(rendered.sql).toContain('"support_bot_memories"."chat_id"');
    expect(rendered.sql).toContain('"support_bot_memories"."telegram_user_id"');
    expect(rendered.params).toEqual(
      expect.arrayContaining([
        'tenant-a',
        'carrier-a',
        '-1001',
        'user-a',
      ]),
    );
  });

  it('produces distinct recall partitions for another user and tenant', () => {
    const tenantAUserA = supportBotMemoryRepo
      .buildSearchQuery(
        context('tenant-a'),
        {
          carrierId: 'carrier-a',
          chatId: '-1001',
          telegramUserId: 'user-a',
        },
        [0.1],
        3,
      )
      .toSQL().params;
    const tenantBUserB = supportBotMemoryRepo
      .buildSearchQuery(
        context('tenant-b'),
        {
          carrierId: 'carrier-a',
          chatId: '-1001',
          telegramUserId: 'user-b',
        },
        [0.1],
        3,
      )
      .toSQL().params;

    expect(tenantAUserA).toContain('tenant-a');
    expect(tenantAUserA).toContain('user-a');
    expect(tenantAUserA).not.toContain('tenant-b');
    expect(tenantAUserA).not.toContain('user-b');
    expect(tenantBUserB).toContain('tenant-b');
    expect(tenantBUserB).toContain('user-b');
  });
});
