import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  buildReport: vi.fn(),
  resolveCaller: vi.fn(),
  sendDocument: vi.fn(async () => undefined),
  takeToken: vi.fn(() => true),
}));

vi.mock('../../src/integrations/telegramCarrierBot.js', () => ({
  sendDocument: mocks.sendDocument,
  TelegramChatUnreachableError: class TelegramChatUnreachableError extends Error {},
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: mocks.audit,
}));
vi.mock('../../src/modules/carrier/cardLookupReport.js', () => ({
  buildCardLookupReport: mocks.buildReport,
}));
vi.mock('../../src/modules/carrier/supportBotCaller.js', async () => {
  const { z } = await import('zod');
  return {
    supportBotCallerSchema: z.object({
      telegramUserId: z.string().min(1),
      carrierId: z.string().min(1),
    }),
    resolveSupportBotCaller: mocks.resolveCaller,
    resolveSupportBotCardByLast6: vi.fn(),
    sendSupportBotPrivate: vi.fn(),
  };
});
vi.mock('../../src/modules/security/rateBucket.js', () => ({
  takeToken: mocks.takeToken,
}));
vi.mock('../../src/routes/v1/helpers.js', () => ({
  requireContext: () => ({ tenantId: 'tenant-a', userId: 'gateway' }),
}));

import { supportBotDocumentRoutes } from '../../src/routes/v1/supportBotDocuments.routes.js';

async function createApp() {
  const app = Fastify({ logger: false });
  errorHandlerPlugin(app);
  await app.register(sensible);
  app.decorate('supportBotGatewayAuth', async () => undefined);
  await app.register(supportBotDocumentRoutes);
  return app;
}

describe('support-bot Card Lookup report RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildReport.mockResolvedValue({
      bytes: Buffer.from('xlsx'),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'Octane_Card_Lookup_2026-08-03.xlsx',
      rows: 2,
    });
  });

  it('sends an owner or normalized manager report only to their private chat', async () => {
    mocks.resolveCaller.mockResolvedValue({
      role: 'owner',
      registration: {
        profile: 'manager',
        telegramUserId: '11',
        telegramChatId: 'private-11',
        companyName: 'ONZMOVE INC',
      },
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/card-lookup-report',
      payload: {
        telegramUserId: '11',
        carrierId: '5762018',
        format: 'xlsx',
      },
    });
    await app.close();

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.buildReport).toHaveBeenCalledWith(
      '5762018',
      'ONZMOVE INC',
      'xlsx',
    );
    expect(mocks.sendDocument).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'private-11' }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'carrier.support_bot.card_lookup_report_send',
        resourceId: '5762018',
      }),
    );
  });

  it('rejects a driver before reading or sending fleet data', async () => {
    mocks.resolveCaller.mockResolvedValue({
      role: 'driver',
      registration: {
        profile: 'driver',
        telegramUserId: '12',
        telegramChatId: 'private-12',
      },
    });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/card-lookup-report',
      payload: {
        telegramUserId: '12',
        carrierId: '5762018',
        format: 'pdf',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'OWNER_ONLY' } });
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.sendDocument).not.toHaveBeenCalled();
  });
});
