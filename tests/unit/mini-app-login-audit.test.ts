/**
 * auditMiniAppLogin — the carrier Telegram mini-app sign-in row.
 *
 * The point of these is the IDENTITY on the row. Before this module the only writer of
 * `mini_app.auth.login` was the password route (zero rows live, because these carriers are legacy
 * telegram-mode registrations), and the obvious context to reuse — `telegramCtx()` — carries no
 * company and no display name, which would have landed every carrier login as an anonymous
 * `telegram:<id>` with an empty Company column.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/audit/sessionEvents.js', () => ({
  auditSessionEvent: vi.fn(async () => true),
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));

import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { auditSessionEvent } from '../../src/modules/audit/sessionEvents.js';
import { auditMiniAppLogin } from '../../src/modules/carrier/miniAppLoginAudit.js';
import type { MiniAppActorRegistration } from '../../src/modules/carrier/miniAppAuth.js';

const collapsed = vi.mocked(auditSessionEvent);
const direct = vi.mocked(auditFromContext);

function registration(over: Partial<MiniAppActorRegistration> = {}): MiniAppActorRegistration {
  return {
    id: 'reg_1',
    tenantId: 'octane',
    invitationId: 'inv_1',
    profile: 'owner',
    telegramUserId: '55501',
    telegramChatId: '55501',
    telegramUsername: 'acme_owner',
    languageCode: 'en',
    carrierId: 'CARR-9',
    applicationId: null,
    companyName: 'ACME FLEET INC',
    agentName: 'Dina Carter',
    agentZohoUserId: 'z1',
    cardId: null,
    driverName: null,
    companyType: null,
    cardCount: 3,
    authMode: 'telegram',
    status: 'active',
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as MiniAppActorRegistration;
}

beforeEach(() => {
  collapsed.mockReset().mockResolvedValue(true);
  direct.mockReset().mockResolvedValue(undefined);
});

describe('auditMiniAppLogin', () => {
  it('stamps the carrier identity onto the row', async () => {
    await auditMiniAppLogin(registration(), '55501', 'telegram');

    const [ctx, fields] = collapsed.mock.calls[0]!;
    expect(ctx).toMatchObject({
      tenantId: 'octane',
      userId: 'telegram:55501',
      audience: 'customer',
      role: 'fleet_manager',
      userName: 'ACME FLEET INC',
      profiles: ['owner'],
      // auditFromContext derives the Company column from departments for customer-audience rows,
      // which is the whole reason this context is built by hand.
      departments: ['ACME FLEET INC'],
    });
    expect(fields).toMatchObject({
      action: 'mini_app.auth.login',
      status: 'ok',
      resourceType: 'registered_mini_app_company',
      resourceId: 'reg_1',
    });
    expect(fields.detail).toMatchObject({
      method: 'telegram',
      profile: 'owner',
      companyName: 'ACME FLEET INC',
      carrierId: 'CARR-9',
      telegramUserId: '55501',
    });
  });

  it('maps a driver to the driver role and prefers the driver name', async () => {
    await auditMiniAppLogin(
      registration({ profile: 'driver', driverName: 'James Walker' }),
      '55502',
      'telegram',
    );

    expect(collapsed.mock.calls[0]![0]).toMatchObject({
      role: 'driver',
      userName: 'James Walker',
      profiles: ['driver'],
    });
  });

  it('falls back to the carrier id when the company name is missing', async () => {
    await auditMiniAppLogin(
      registration({ companyName: null, driverName: null, telegramUsername: 'solo' }),
      '55503',
      'telegram',
    );

    expect(collapsed.mock.calls[0]![0]).toMatchObject({
      departments: ['CARR-9'],
      userName: 'solo',
    });
  });

  it('collapses a bootstrap re-open but never an explicit password login', async () => {
    await auditMiniAppLogin(registration(), '55504', 'telegram');
    expect(collapsed).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();

    await auditMiniAppLogin(registration(), '55504', 'password', { collapse: false });
    // The deliberate act goes straight to the writer, bypassing the session-window collapse.
    expect(direct).toHaveBeenCalledTimes(1);
    expect(collapsed).toHaveBeenCalledTimes(1);
    expect(direct.mock.calls[0]![1].detail).toMatchObject({ method: 'password' });
  });
});
