import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

const mocks = vi.hoisted(() => ({
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
  search: vi.fn(),
  insert: vi.fn(),
  evict: vi.fn(async () => 0),
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    FF_SUPPORT_BOT_MEMORY: true,
    SUPPORT_BOT_MEMORY_TOP_K: 3,
    SUPPORT_BOT_MEMORY_MIN_SCORE: 0.35,
    SUPPORT_BOT_MEMORY_TTL_DAYS: 30,
    SUPPORT_BOT_MEMORY_MAX_PER_USER: 200,
  },
}));
vi.mock('../../src/modules/knowledge/embedder.js', () => ({
  embedQuery: mocks.embedQuery,
}));
vi.mock('../../src/repos/supportBotMemoryRepo.js', () => ({
  supportBotMemoryRepo: {
    search: mocks.search,
    insert: mocks.insert,
    evictBeyondCap: mocks.evict,
  },
}));

import {
  buildSupportBotTurnMemory,
  commitSupportBotMemory,
  recallSupportBotMemory,
  sanitizeSupportBotMemoryText,
} from '../../src/modules/carrier/supportBotMemory.js';

const ctx: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-a',
};
const scope = {
  carrierId: 'carrier-a',
  chatId: '-1001',
  telegramUserId: '9001',
};

describe('support-bot per-user semantic memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue([]);
    mocks.insert.mockResolvedValue({ id: 'memory-1' });
  });

  it('redacts Telegram ids, card-like numbers, amounts, PINs, and Money Codes', () => {
    const clean = sanitizeSupportBotMemoryText(
      '[msg 7 from Jamshid (id 900123)]: card 917022, $1,500, PIN: 8844, money code ABC-12345',
    );
    expect(clean).not.toContain('900123');
    expect(clean).not.toContain('917022');
    expect(clean).not.toContain('$1,500');
    expect(clean).not.toContain('8844');
    expect(clean).not.toContain('ABC-12345');
    expect(clean).toContain('[REDACTED');
  });

  it('recalls only through the complete caller scope and pages to top-k', async () => {
    mocks.search.mockResolvedValue([
      {
        id: 'memory-a',
        content: 'User previously asked about a held card.',
        kind: 'turn_summary',
        createdAt: new Date(),
        score: 0.91,
      },
      {
        id: 'weak',
        content: 'Unrelated.',
        kind: 'turn_summary',
        createdAt: new Date(),
        score: 0.1,
      },
    ]);

    const rows = await recallSupportBotMemory(ctx, scope, 'that card from yesterday', 8);

    expect(mocks.search).toHaveBeenCalledWith(
      ctx,
      scope,
      [0.1, 0.2, 0.3],
      3,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toContain('held card');
  });

  it('commits a sanitized idempotent turn summary in the same scope', async () => {
    const stored = await commitSupportBotMemory(
      ctx,
      scope,
      '[msg 8 from J (id 9001)]: card 917022 status?',
      '•••• 917022 is on hold; balance is $400.',
    );

    expect(stored).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith(
      ctx,
      scope,
      expect.objectContaining({
        content: expect.not.stringContaining('917022'),
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        embedding: [0.1, 0.2, 0.3],
        expiresAt: expect.any(Date),
      }),
    );
    expect(mocks.evict).toHaveBeenCalledWith(ctx, scope, 200);
  });

  it('does not store greetings or silent turns', () => {
    expect(buildSupportBotTurnMemory('salom', 'Salom!')).toBeNull();
    expect(buildSupportBotTurnMemory('status?', 'SILENT')).toBeNull();
  });
});
