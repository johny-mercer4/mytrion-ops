import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findActiveByTelegramUserId: vi.fn(),
  },
}));

vi.mock('../../apps/agent-gateway/src/config.js', () => ({
  config: {
    botToken: 'test-bot-token',
    octaneBase: 'https://octane.test',
    octaneKey: 'internal-test-key',
  },
}));

import { registeredMiniAppCompanyRepo } from '../../src/repos/registeredMiniAppCompanyRepo.js';
import { resolveSupportBotDmAccess } from '../../src/modules/carrier/supportBotDmAccess.js';
import { dmAccessFor } from '../../apps/agent-gateway/src/dmAccess.js';
import { shouldEngage } from '../../apps/agent-gateway/src/filter.js';
import { answerCallback } from '../../apps/agent-gateway/src/telegram.js';
import type { TgMessage } from '../../apps/agent-gateway/src/telegram.js';
import { makeContext } from '../fixtures/seed.js';

const registration = (
  profile: 'owner' | 'manager' | 'driver',
  overrides: Record<string, unknown> = {},
) =>
  ({
    profile,
    carrierId: 'carrier-42',
    companyName: 'Road Runner LLC',
    ...overrides,
  }) as never;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('support-bot private-chat authorization', () => {
  it.each(['owner', 'manager'] as const)(
    'resolves an active %s registration to its server-owned carrier',
    async (profile) => {
      vi.mocked(
        registeredMiniAppCompanyRepo.findActiveByTelegramUserId,
      ).mockResolvedValueOnce(registration(profile));

      await expect(
        resolveSupportBotDmAccess(makeContext(), '777'),
      ).resolves.toEqual({
        carrierId: 'carrier-42',
        profile,
        companyName: 'Road Runner LLC',
      });
    },
  );

  it('denies drivers and registrations without a carrier', async () => {
    vi.mocked(
      registeredMiniAppCompanyRepo.findActiveByTelegramUserId,
    )
      .mockResolvedValueOnce(registration('driver'))
      .mockResolvedValueOnce(registration('owner', { carrierId: null }));

    await expect(
      resolveSupportBotDmAccess(makeContext(), '778'),
    ).resolves.toBeNull();
    await expect(
      resolveSupportBotDmAccess(makeContext(), '779'),
    ).resolves.toBeNull();
  });
});

describe('gateway DM access client', () => {
  it('accepts only a validated owner/manager payload from Mytrion', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access: {
              carrierId: 'carrier-42',
              profile: 'manager',
              companyName: 'Road Runner LLC',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access: {
              carrierId: 'carrier-42',
              profile: 'driver',
              companyName: 'Road Runner LLC',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(dmAccessFor(880001)).resolves.toMatchObject({
      carrierId: 'carrier-42',
      profile: 'manager',
    });
    await expect(dmAccessFor(880002)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://octane.test/v1/support-bot/dm-access?telegramUserId=880001',
    );
  });

  it('fails closed when Mytrion is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')));
    await expect(dmAccessFor(880003)).resolves.toBeNull();
  });
});

describe('private-chat engagement', () => {
  it('engages every private message without requiring an @mention', () => {
    const message: TgMessage = {
      message_id: 1,
      chat: { id: 991, type: 'private' },
      from: { id: 991, first_name: 'Owner' },
      text: 'show my invoices',
    };
    expect(shouldEngage(message, 'octane_bot')).toBe(true);
  });

  it('keeps group messages mention-gated', () => {
    const message: TgMessage = {
      message_id: 2,
      chat: { id: -1001, type: 'supergroup' },
      from: { id: 991, first_name: 'Owner' },
      text: 'show my invoices',
    };
    expect(shouldEngage(message, 'octane_bot')).toBe(false);
  });
});

describe('unavailable button UX', () => {
  it('answers the Telegram callback with a visible alert', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await answerCallback('callback-1', 'Request this action again.');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.telegram.org/bottest-bot-token/answerCallbackQuery',
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      callback_query_id: 'callback-1',
      text: 'Request this action again.',
      show_alert: true,
    });
  });
});
