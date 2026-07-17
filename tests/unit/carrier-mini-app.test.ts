import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.TELEGRAM_CARRIER_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_CARRIER_BOT_USERNAME = 'octane_test_bot';
  // Driver card scoping resolves the card number through the DWH; without a URL configured
  // resolveDriverCardNumber short-circuits to null and every driver read would 503.
  process.env.DWH_DATABASE_URL = 'postgres://dwh-test/stub';
});

vi.mock('../../src/integrations/dwhCards.js', () => ({
  listDwhCards: vi.fn(async () => []),
  findDwhCardByNumber: vi.fn(async () => null),
}));

vi.mock('../../src/integrations/dwhTransactions.js', () => ({
  listDwhTransactions: vi.fn(),
  resolveDwhTxnRange: vi.fn(() => ({ preset: 'month', from: '2026-07-01', to: '2026-07-17' })),
}));

vi.mock('../../src/wrappers/serverCrmWrapper.js', () => ({
  serverCrmWrapper: {
    getCarrierBalance: vi.fn(),
    getCarrierOverview: vi.fn(async () => ({ company_name: 'Acme Transport LLC', is_active: true })),
    getCards: vi.fn(),
    getLastUsed: vi.fn(),
    getTransactions: vi.fn(),
    getPaymentInfo: vi.fn(),
    getInvoices: vi.fn(),
    getInvoiceSignedUrl: vi.fn(),
  },
}));

vi.mock('../../src/db/client.js', () => ({
  db: {
    transaction: async <T>(fn: (tx: object) => Promise<T>): Promise<T> => fn({}),
  },
}));

vi.mock('../../src/repos/carrierInvitationRepo.js', () => ({
  carrierInvitationRepo: {
    create: vi.fn(),
    findById: vi.fn(),
    findLiveDriverByCard: vi.fn(),
    listPendingDriverInvitesByCarrier: vi.fn(async () => []),
    markRedeemed: vi.fn(),
  },
}));

vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findByTelegramUserId: vi.fn(),
    list: vi.fn(async () => []),
    listDriversByCarrier: vi.fn(async () => []),
    upsert: vi.fn(),
  },
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/integrations/telegramCarrierBot.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/telegramCarrierBot.js')>();
  return {
    ...mod,
    verifyTelegramInitData: vi.fn(() => ({ ok: true, fields: {} })),
    parseInitDataUser: vi.fn(() => ({ id: 123456, username: 'fleet_owner' })),
    signTelegramInitData: vi.fn(() => 'signed-init-data'),
    sendDocument: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { carrierInvitationRepo } from '../../src/repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../src/repos/registeredMiniAppCompanyRepo.js';
import { listDwhCards } from '../../src/integrations/dwhCards.js';
import { listDwhTransactions } from '../../src/integrations/dwhTransactions.js';
import { sendDocument, TelegramChatUnreachableError } from '../../src/integrations/telegramCarrierBot.js';
import { serverCrmWrapper } from '../../src/wrappers/serverCrmWrapper.js';

const inviteRepo = vi.mocked(carrierInvitationRepo);
const registrationRepo = vi.mocked(registeredMiniAppCompanyRepo);
const dwhCards = vi.mocked(listDwhCards);
const dwhTxns = vi.mocked(listDwhTransactions);
const botSendDocument = vi.mocked(sendDocument);
const crm = vi.mocked(serverCrmWrapper);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function inviteRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'inv_1',
    tenantId: DEFAULT_TENANT_ID,
    profile: 'owner' as const,
    carrierId: '5758544',
    applicationId: 'APP-9',
    companyName: 'Acme Transport LLC',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    cardId: null,
    driverName: null,
    companyType: 'fleet-manager' as const,
    cardCount: 3,
    status: 'pending' as const,
    redeemedCarrierUserId: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function registrationRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'rma_1',
    tenantId: DEFAULT_TENANT_ID,
    invitationId: 'inv_1',
    profile: 'owner' as const,
    telegramUserId: '123456',
    telegramChatId: null,
    telegramUsername: 'fleet_owner',
    carrierId: '5758544',
    applicationId: 'APP-9',
    companyName: 'Acme Transport LLC',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    cardId: null,
    driverName: null,
    companyType: 'fleet-manager' as const,
    cardCount: 3,
    status: 'active' as const,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('carrier mini-app redeem flow', () => {
  it('restores a registered mini-app session from Telegram identity without an invite link', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/session',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        profile: 'owner',
        carrierId: '5758544',
        agentName: 'Rep Riley',
      },
    });
  });

  it('restores the sales agent from the original invite for older registrations with null agent fields', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ agentName: null, agentZohoUserId: null }),
    );
    inviteRepo.findById.mockResolvedValueOnce(inviteRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/session',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        agentName: 'Rep Riley',
      },
    });
  });

  it('rejects owner-operator access to fleet-owner driver management endpoints', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ companyType: 'owner-operator', cardCount: 1 }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'card_1', driverName: 'James Reyes' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'NOT_A_REGISTERED_OWNER' },
    });
  });

  it('rejects rebinding an already-registered Telegram account to another carrier', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_conflict', carrierId: '999000' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ carrierId: '5758544', applicationId: 'APP-9' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_conflict/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(409);
    expect(inviteRepo.markRedeemed).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      error: { code: 'TELEGRAM_ALREADY_REGISTERED' },
    });
  });

  it('returns alreadyRegistered for the same Telegram user reopening the same logical registration', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_reopen' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    inviteRepo.markRedeemed.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_reopen/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      alreadyRegistered: true,
      registration: {
        id: 'rma_1',
        profile: 'owner',
        carrierId: '5758544',
      },
    });
    expect(registrationRepo.upsert).not.toHaveBeenCalled();
  });

  it('returns alreadyRegistered for the same Telegram user reopening a redeemed invite after it expires', async () => {
    inviteRepo.findById.mockResolvedValueOnce(
      inviteRow({
        id: 'inv_redeemed_expired',
        status: 'redeemed',
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_redeemed_expired/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      alreadyRegistered: true,
      registration: {
        id: 'rma_1',
        profile: 'owner',
        carrierId: '5758544',
      },
    });
    expect(inviteRepo.markRedeemed).not.toHaveBeenCalled();
    expect(registrationRepo.upsert).not.toHaveBeenCalled();
  });

  it('persists and returns the company sales agent on a fresh redeem', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_agent' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(undefined);
    inviteRepo.markRedeemed.mockResolvedValueOnce(inviteRow({ id: 'inv_agent', status: 'redeemed' }));
    registrationRepo.upsert.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_agent/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(201);
    expect(registrationRepo.upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        invitationId: 'inv_agent',
        agentName: 'Rep Riley',
        agentZohoUserId: '777',
      }),
      expect.anything(),
    );
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        agentName: 'Rep Riley',
      },
    });
  });
});

describe('driver row scoping (own card only)', () => {
  // Same carrier, same last-4 (7593), different cards. A live DWH probe found one real carrier with
  // 11 active cards sharing a last-4, so this is the shape the old client-side last-4 filter got
  // wrong — it is the regression this suite exists to pin.
  const OWN_CARD = '7083050030880417593';
  const OTHER_CARD_SAME_LAST4 = '7083050030889467593';

  function driverRow(overrides: Record<string, unknown> = {}) {
    return registrationRow({
      profile: 'driver',
      companyType: null,
      cardId: 'card_1',
      driverName: 'James Reyes',
      ...overrides,
    });
  }

  /** The driver's registration resolves cardId 'card_1' -> OWN_CARD via the DWH card directory. */
  function withResolvableCard() {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverRow());
    dwhCards.mockResolvedValueOnce([
      { cardId: 'card_1', cardNumber: OWN_CARD, cardType: 'FUEL', status: 'Active', balance: '0' },
      { cardId: 'card_2', cardNumber: OTHER_CARD_SAME_LAST4, cardType: 'FUEL', status: 'Active', balance: '0' },
    ]);
  }

  const dwhResult = (rows: Array<Record<string, unknown>>) => ({
    data: rows,
    totals: { transactions: rows.length, line_items: rows.length, funded_total: 0, fuel_quantity: 0, total_fuel_quantity: 0, discount_amount: 0 },
    range: { preset: 'month', from: '2026-07-01', to: '2026-07-17' },
    pagination: { page: 1, limit: 5000, count: rows.length, more_records: false },
  });

  describe('fast phase (live=false — DWH only)', () => {
    it('scopes the driver at the SQL level rather than filtering after the fact', async () => {
      withResolvableCard();
      dwhTxns.mockResolvedValueOnce(dwhResult([{ transaction_id: 't1', card_number: OWN_CARD }]));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month' },
      });

      expect(res.statusCode).toBe(200);
      // The card goes INTO the query — other cards' rows never leave Postgres.
      expect(dwhTxns).toHaveBeenCalledWith(expect.objectContaining({ carrierId: '5758544', cardNumber: OWN_CARD }));
      // The EFS tail is still missing, and the client is told so it knows to fire phase 2.
      expect(res.json()).toMatchObject({ live: { pending: true } });
      expect(crm.getTransactions).not.toHaveBeenCalled();
    });

    it('does not pass a cardNumber for an owner — they see the whole carrier', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
      dwhTxns.mockResolvedValueOnce(dwhResult([{ transaction_id: 't1', card_number: OWN_CARD }]));

      await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month' },
      });

      expect(dwhTxns).toHaveBeenCalledWith(expect.not.objectContaining({ cardNumber: expect.anything() }));
      expect(dwhCards).not.toHaveBeenCalled();
    });

    it('fails closed with 503 rather than querying at all when the driver card cannot be resolved', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverRow());
      dwhCards.mockResolvedValueOnce([]); // card gone / DWH degraded

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month' },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'DRIVER_CARD_UNRESOLVED' } });
      expect(dwhTxns).not.toHaveBeenCalled();
    });
  });

  describe('live phase (live=true — servercrm DWH+EFS merge)', () => {
    it('drops another card that shares the driver last-4 and recomputes totals from the scoped rows', async () => {
      withResolvableCard();
      crm.getTransactions.mockResolvedValueOnce({
        data: [
          { transaction_id: 't1', card_number: OWN_CARD, line_item_amount: 100, line_item_fuel_quantity: 20, line_item_discount_amount: 5 },
          { transaction_id: 't2', card_number: OTHER_CARD_SAME_LAST4, line_item_amount: 900, line_item_fuel_quantity: 180, line_item_discount_amount: 45 },
        ],
        totals: { transactions: 2, line_items: 2, funded_total: 1000, fuel_quantity: 200, total_fuel_quantity: 200, discount_amount: 50 },
        pagination: { page: 1, limit: 5000, count: 2, more_records: false },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', live: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].transaction_id).toBe('t1');
      // The fleet's $1000 must not survive anywhere in the payload — rows OR totals. Key names
      // mirror servercrm's countDwhTransactions return value.
      expect(body.totals).toMatchObject({ transactions: 1, line_items: 1, funded_total: 100, fuel_quantity: 20, total_fuel_quantity: 20, discount_amount: 5 });
      expect(JSON.stringify(body)).not.toContain(OTHER_CARD_SAME_LAST4);
    });

    it('requests the full window so page 1 of a busy fleet cannot hide the driver rows', async () => {
      withResolvableCard();
      crm.getTransactions.mockResolvedValueOnce({ data: [], totals: {}, pagination: {} });

      await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', live: true },
      });

      expect(crm.getTransactions).toHaveBeenCalledWith('5758544', expect.objectContaining({ limit: 5000 }));
    });

    it('flags scope_truncated when the fleet fetch hit the upstream row ceiling', async () => {
      withResolvableCard();
      crm.getTransactions.mockResolvedValueOnce({
        data: [{ transaction_id: 't1', card_number: OWN_CARD, line_item_amount: 10 }],
        totals: {},
        pagination: { page: 1, limit: 5000, count: 5000, more_records: true },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'all_time', live: true },
      });

      expect(res.json()).toMatchObject({ scope_truncated: true });
    });

    it('asks for the same window as the fast phase so an owner list cannot shrink on refresh', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
      crm.getTransactions.mockResolvedValueOnce({ data: [], totals: {}, pagination: {} });

      await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'year', live: true },
      });

      // Letting this default to servercrm's 100 made a measured owner year view drop from 318 rows
      // to 100 the moment phase 2 landed — the exact row-jump the two phases exist to avoid.
      expect(crm.getTransactions).toHaveBeenCalledWith('5758544', expect.objectContaining({ limit: 5000 }));
    });

    it('leaves an owner carrier-wide — scoping is driver-only', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
      crm.getTransactions.mockResolvedValueOnce({
        data: [
          { transaction_id: 't1', card_number: OWN_CARD, line_item_amount: 100 },
          { transaction_id: 't2', card_number: OTHER_CARD_SAME_LAST4, line_item_amount: 900 },
        ],
        totals: { funded_total: 1000 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', live: true },
      });

      expect(res.json().data).toHaveLength(2);
      expect(res.json().totals).toMatchObject({ funded_total: 1000 });
      expect(dwhCards).not.toHaveBeenCalled();
    });
  });

  it('scopes last-used to the driver own card', async () => {
    withResolvableCard();
    crm.getLastUsed.mockResolvedValueOnce({
      count: 2,
      data: [
        { card_number: OWN_CARD, last_used_date: '2026-07-01' },
        { card_number: OTHER_CARD_SAME_LAST4, last_used_date: '2026-07-02' },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/last-used',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.json()).toMatchObject({ count: 1, data: [{ card_number: OWN_CARD }] });
  });

  it('scopes the status card list to the driver own card', async () => {
    withResolvableCard();
    crm.getCards.mockResolvedValueOnce({
      count: 2,
      active_count: 2,
      data: [
        { card_number: OWN_CARD, status: 'Active' },
        { card_number: OTHER_CARD_SAME_LAST4, status: 'Active' },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/status',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.json().cards).toMatchObject({ count: 1, active_count: 1, data: [{ card_number: OWN_CARD }] });
  });

  describe('report export via the Telegram bot', () => {
    const reportRows = [
      { transaction_id: 't1', card_number: OWN_CARD, transaction_date: '2026-07-10T10:00:00', location_name: 'LOVES #711', line_item_amount: 100, line_item_fuel_quantity: 20, line_item_discount_amount: 5 },
    ];

    it('builds from the driver-scoped rows and sends the document to their Telegram chat', async () => {
      withResolvableCard();
      dwhTxns.mockResolvedValueOnce(dwhResult(reportRows));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions/export',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', format: 'csv' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ sent: true, rows: 1 });
      expect(dwhTxns).toHaveBeenCalledWith(expect.objectContaining({ cardNumber: OWN_CARD }));

      const sent = botSendDocument.mock.calls[0]![0];
      // A private chat's id IS the user id — telegramChatId is null on this registration.
      expect(sent.chatId).toBe('123456');
      expect(sent.fileName).toMatch(/^Octane_Transactions_7593_.*\.csv$/);
      expect(String(sent.bytes)).toContain('LOVES #711');
      // Masked in the file, exactly as the sheet shows it.
      expect(String(sent.bytes)).not.toContain(OWN_CARD);
    });

    it('prefers a stored telegramChatId when the registration captured one', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverRow({ telegramChatId: '999888' }));
      dwhCards.mockResolvedValueOnce([{ cardId: 'card_1', cardNumber: OWN_CARD, cardType: 'FUEL', status: 'Active', balance: '0' }]);
      dwhTxns.mockResolvedValueOnce(dwhResult(reportRows));

      await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions/export',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', format: 'pdf' },
      });

      expect(botSendDocument.mock.calls[0]![0].chatId).toBe('999888');
    });

    it('explains how to fix it when the user has never opened the bot chat', async () => {
      withResolvableCard();
      dwhTxns.mockResolvedValueOnce(dwhResult(reportRows));
      botSendDocument.mockRejectedValueOnce(new TelegramChatUnreachableError("bot can't initiate conversation with a user"));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions/export',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', format: 'csv' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'TELEGRAM_CHAT_UNREACHABLE' } });
    });

    it('renders a pg Date as YYYY-MM-DD, not the String(Date) form that drops the year', async () => {
      withResolvableCard();
      // pg hands back `timestamp without time zone` as a Date object, NOT an ISO string — String()
      // -ing that yields "Thu Jul 16 2026 …", whose first 10 chars have no year in them at all.
      dwhTxns.mockResolvedValueOnce(dwhResult([
        { ...reportRows[0]!, transaction_date: new Date(2026, 6, 16, 21, 59) },
      ]));

      await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions/export',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', format: 'csv' },
      });

      const csv = String(botSendDocument.mock.calls[0]![0].bytes);
      expect(csv).toContain('2026-07-16');
      expect(csv).not.toContain('Thu Jul 16');
    });

    it('404s an empty window instead of sending an empty file', async () => {
      withResolvableCard();
      dwhTxns.mockResolvedValueOnce(dwhResult([]));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions/export',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'day', format: 'xlsx' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'TXN_EXPORT_EMPTY' } });
      expect(botSendDocument).not.toHaveBeenCalled();
    });
  });
});
