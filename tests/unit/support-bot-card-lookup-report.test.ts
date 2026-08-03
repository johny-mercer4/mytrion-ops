import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  buildReport: vi.fn(),
  buildTxnReport: vi.fn(),
  listTransactions: vi.fn(),
  resolveCaller: vi.fn(),
  resolveCard: vi.fn(),
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
vi.mock('../../src/modules/carrier/txnReport.js', () => ({
  buildTxnReport: mocks.buildTxnReport,
}));
vi.mock('../../src/integrations/dwhTransactions.js', () => ({
  listDwhTransactions: mocks.listTransactions,
}));
vi.mock('../../src/modules/carrier/supportBotCaller.js', async () => {
  const { z } = await import('zod');
  return {
    supportBotCallerSchema: z.object({
      telegramUserId: z.string().min(1),
      carrierId: z.string().min(1),
    }),
    resolveSupportBotCaller: mocks.resolveCaller,
    resolveSupportBotCardByLast6: mocks.resolveCard,
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
    mocks.buildTxnReport.mockResolvedValue({
      bytes: Buffer.from('xlsx'),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'Octane_Transactions_unit-040_2026-05-03.xlsx',
    });
    mocks.listTransactions.mockResolvedValue({
      data: [{ transaction_id: 'txn-1', driver_unit: '040' }],
      totals: {},
      range: { preset: 'custom', from: '2026-05-03', to: '2026-05-05' },
      pagination: {},
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

  it('delivers an owner report scoped to the exact requested unit', async () => {
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
      url: '/support-bot/txn-report',
      payload: {
        telegramUserId: '11',
        carrierId: '5762018',
        from: '2026-05-03',
        to: '2026-05-05',
        format: 'xlsx',
        unitNumber: '040',
      },
    });
    await app.close();

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        carrierId: '5762018',
        unitNumber: '040',
        range: 'custom',
      }),
    );
    expect(mocks.buildTxnReport).toHaveBeenCalledWith(
      expect.any(Array),
      'xlsx',
      expect.objectContaining({ scopeLabel: 'Unit 040' }),
    );
    expect(response.json()).toMatchObject({
      success: true,
      scope: { type: 'unit', value: '040' },
    });
  });

  it('rejects driver-selected unit scope before querying transactions', async () => {
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
      url: '/support-bot/txn-report',
      payload: {
        telegramUserId: '12',
        carrierId: '5762018',
        unitNumber: '040',
        format: 'xlsx',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'OWNER_ONLY' } });
    expect(mocks.listTransactions).not.toHaveBeenCalled();
  });
});
