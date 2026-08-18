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
  // Card lookups by id are EXACT queries, not a scan of listDwhCards — that scan capped at 100 and
  // silently broke every driver on a carrier with more cards than that.
  findDwhCardById: vi.fn(async () => null),
  // Read scoping uses AnyStatus (inactive cards still resolve); writes stay on active-only above.
  findDwhCardByIdAnyStatus: vi.fn(async () => null),
  isActiveCardOfCarrier: vi.fn(async () => false),
  getCardEfsIdentity: vi.fn(async () => ({ unit: null, driverName: null })),
}));

vi.mock('../../src/integrations/dwhClientRoster.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/integrations/dwhClientRoster.js')>();
  return { ...original, fetchAgentClients: vi.fn(async () => []) };
});

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
    getMoneyCodePreview: vi.fn(),
    drawMoneyCode: vi.fn(),
  },
}));

vi.mock('../../src/wrappers/efsWrapper.js', () => ({
  efsWrapper: {
    getCards: vi.fn(),
    listCards: vi.fn(),
    getCardEfsInfo: vi.fn(),
    overrideCard: vi.fn(),
    // Fraud-only override gate — resolves (= card is fraud-held) by default so the RBAC/pinning
    // tests keep exercising their own concern; the gate's REJECT path has its own test below.
    assertCardFraudHeld: vi.fn(),
    setCardStatus: vi.fn(),
    setCardLimits: vi.fn(),
    updateCardInfo: vi.fn(),
    fraudHoldRelease: vi.fn(),
  },
}));

vi.mock('../../src/integrations/zohoFunctions.js', () => ({
  executeZohoFunctionWithFallback: vi.fn(),
}));

vi.mock('../../src/integrations/zohoDesk.js', () => ({
  createDeskTicket: vi.fn(async () => '1057080000099887766'),
  DESK_DEPARTMENTS: { cs: '1057080000000323033', billing: '1057080000000329409', verification: '1057080000010223377', maintenance: '1057080000006966104' },
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
    findPendingManagerByLogin: vi.fn(async () => undefined),
    cancelPendingManagersByLogin: vi.fn(async () => 0),
    cancel: vi.fn(),
    listPendingDriverInvitesByCarrier: vi.fn(async () => []),
    markRedeemed: vi.fn(),
    renameDriverByCard: vi.fn(),
  },
}));

vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findByTelegramUserId: vi.fn(),
    findActiveOwnerByCarrier: vi.fn(),
    findActiveManagerByLogin: vi.fn(async () => undefined),
    findDtoById: vi.fn(),
    list: vi.fn(async () => []),
    listDriversByCarrier: vi.fn(async () => []),
    listManagersByCarrier: vi.fn(async () => []),
    revokeManagerByCarrier: vi.fn(),
    renameDriverByCard: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../../src/repos/carrierUserRepo.js', () => ({
  carrierUserRepo: {
    findByLogin: vi.fn(),
    findByTelegramUserId: vi.fn(async () => undefined),
    findById: vi.fn(),
    findByRegistrationId: vi.fn(),
    loginTaken: vi.fn(async () => false),
    upsertForTelegram: vi.fn(),
    updatePasswordHash: vi.fn(),
    touchLastLogin: vi.fn(),
    disable: vi.fn(),
    disableByRegistrationId: vi.fn(),
  },
}));

vi.mock('../../src/repos/miniAppPasswordResetRepo.js', () => ({
  miniAppPasswordResetRepo: {
    create: vi.fn(),
    findPendingByCarrierUser: vi.fn(),
    listPendingForAgent: vi.fn(async () => []),
    listPendingForCarrier: vi.fn(async () => []),
    findById: vi.fn(),
    resolve: vi.fn(),
  },
}));

vi.mock('../../src/repos/salesAgentMiniAppRepo.js', () => ({
  salesAgentMiniAppRepo: {
    createInvitation: vi.fn(),
    findInvitation: vi.fn(),
    findPrincipalByTelegramUserId: vi.fn(),
    findPrincipalByZohoUserId: vi.fn(),
    redeemInvitation: vi.fn(),
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

vi.mock('../../src/modules/carrier/cardLookupReport.js', () => ({
  buildCardLookupReport: vi.fn(async (_carrierId: string, _companyName: string, format: 'pdf' | 'xlsx') => ({
    bytes: Buffer.from('report-bytes'),
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `Octane_Card_Lookup_2026-08-03.${format}`,
    rows: 1,
  })),
}));

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
import { AppError } from '../../src/lib/errors.js';
import { carrierInvitationRepo } from '../../src/repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo, type RegisteredMiniAppCompanyDto } from '../../src/repos/registeredMiniAppCompanyRepo.js';
import { listDwhCards, findDwhCardById, findDwhCardByIdAnyStatus, findDwhCardByNumber, getCardEfsIdentity, isActiveCardOfCarrier } from '../../src/integrations/dwhCards.js';
import { listDwhTransactions, resolveDwhTxnRange } from '../../src/integrations/dwhTransactions.js';
import { sendDocument, TelegramChatUnreachableError, parseInitDataUser, signTelegramInitData, verifyTelegramInitData } from '../../src/integrations/telegramCarrierBot.js';
import { executeZohoFunctionWithFallback } from '../../src/integrations/zohoFunctions.js';
import { createDeskTicket } from '../../src/integrations/zohoDesk.js';
import { serverCrmWrapper } from '../../src/wrappers/serverCrmWrapper.js';
import { efsWrapper } from '../../src/wrappers/efsWrapper.js';
import { env } from '../../src/config/env.js';
import { resetRateBucketsForTests } from '../../src/modules/security/rateBucket.js';
import { buildCardLookupReport } from '../../src/modules/carrier/cardLookupReport.js';
import { fetchAgentClients, type AgentClientRow } from '../../src/integrations/dwhClientRoster.js';
import { salesAgentMiniAppRepo } from '../../src/repos/salesAgentMiniAppRepo.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';

const inviteRepo = vi.mocked(carrierInvitationRepo);
const registrationRepo = vi.mocked(registeredMiniAppCompanyRepo);
const dwhCards = vi.mocked(listDwhCards);
const dwhTxns = vi.mocked(listDwhTransactions);
const dwhRange = vi.mocked(resolveDwhTxnRange);
const botSendDocument = vi.mocked(sendDocument);
const crm = vi.mocked(serverCrmWrapper);
const efs = vi.mocked(efsWrapper);
const cardLookupReport = vi.mocked(buildCardLookupReport);
const agentClients = vi.mocked(fetchAgentClients);
const agentMiniAppRepo = vi.mocked(salesAgentMiniAppRepo);
const auditLog = vi.mocked(auditFromContext);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  /**
   * resetAllMocks, not clearAllMocks — clearAllMocks wipes call history but does NOT drain the
   * mockResolvedValueOnce queue. A test that queues a value its path never reaches (a schema or
   * role check rejecting first) leaves it there, and the next test calling that mock consumes the
   * stale value instead of its own. That silently swapped a 201 for a 409 twice while this suite
   * was being written, each time pointing the blame at production code that was fine.
   *
   * The cost is that resetAllMocks also wipes the vi.mock factories' default implementations, so
   * every default a test may rely on is re-applied here.
   */
  vi.resetAllMocks();
  dwhCards.mockResolvedValue([]);
  vi.mocked(findDwhCardByNumber).mockResolvedValue(null);
  vi.mocked(findDwhCardById).mockResolvedValue(null);
  // Driver read scoping calls findDwhCardByIdAnyStatus; keep it wired to the same mock queue the
  // suite already primes via findDwhCardById so existing withResolvableCard() helpers keep working.
  vi.mocked(findDwhCardByIdAnyStatus).mockImplementation((carrier, cardId) =>
    vi.mocked(findDwhCardById)(carrier, cardId),
  );
  vi.mocked(isActiveCardOfCarrier).mockResolvedValue(false);
  vi.mocked(getCardEfsIdentity).mockResolvedValue({
    unit: null,
    driverName: null,
  });
  crm.getCarrierOverview.mockResolvedValue({ company_name: 'Acme Transport LLC', is_active: true });
  registrationRepo.list.mockResolvedValue([]);
  registrationRepo.listDriversByCarrier.mockResolvedValue([]);
  agentClients.mockResolvedValue([]);
  agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValue(undefined);
  // Driver invites nest under an active owner (inviteService.createCarrierInvite). Default to an
  // owner present so driver-invite paths reach the card checks; a test wanting DRIVER_NEEDS_OWNER
  // overrides this with a single undefined. createCarrierInvite only reads truthiness, so the exact
  // shape is immaterial — cast the Date-carrying row to the Dto (string dates) the repo declares.
  registrationRepo.findActiveOwnerByCarrier.mockResolvedValue(
    registrationRow({ profile: 'owner' }) as unknown as Awaited<
      ReturnType<typeof registrationRepo.findActiveOwnerByCarrier>
    >,
  );
  inviteRepo.listPendingDriverInvitesByCarrier.mockResolvedValue([]);
  vi.mocked(verifyTelegramInitData).mockReturnValue({ ok: true, fields: {} });
  vi.mocked(parseInitDataUser).mockReturnValue({ id: 123456, username: 'fleet_owner' });
  vi.mocked(signTelegramInitData).mockReturnValue('signed-init-data');
  vi.mocked(sendDocument).mockResolvedValue(undefined);
  vi.mocked(createDeskTicket).mockResolvedValue('1057080000099887766');
  // Write-action defaults: flags OFF (each write test opts in explicitly), a fresh rate bucket so
  // the per-carrier window from a prior test can't leak a spurious 429, and benign wrapper stubs.
  env.FF_MINIAPP_CARD_WRITES_ENABLED = false;
  env.FF_MINIAPP_MONEY_CODE_ENABLED = false;
  env.FF_MINIAPP_MANAGER_INVITES_ENABLED = false;
  resetRateBucketsForTests();
  efs.getCardEfsInfo.mockResolvedValue({ ok: true } as never);
  efs.listCards.mockResolvedValue({ data: [] });
  cardLookupReport.mockImplementation(async (_carrierId, _companyName, format) => ({
    bytes: Buffer.from('report-bytes'),
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `Octane_Card_Lookup_2026-08-03.${format}`,
    rows: 1,
  }));
  efs.overrideCard.mockResolvedValue({ ok: true } as never);
  efs.setCardStatus.mockResolvedValue({ ok: true } as never);
  efs.setCardLimits.mockResolvedValue({ ok: true } as never);
  efs.updateCardInfo.mockResolvedValue({ ok: true } as never);
  efs.fraudHoldRelease.mockResolvedValue({ ok: true } as never);
  crm.getMoneyCodePreview.mockResolvedValue({ drawable: 500 } as never);
  crm.drawMoneyCode.mockResolvedValue({ ok: true } as never);
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
    agentName: 'CI Test Admin',
    agentZohoUserId: '777',
    cardId: null,
    driverName: null,
    companyType: 'fleet-manager' as const,
    cardCount: 3,
    authMode: 'password' as const,
    status: 'pending' as const,
    redeemedCarrierUserId: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function registrationRow(overrides: Record<string, unknown> = {}) {
  // Default shape is the DOMAIN row (Date fields) — what findByTelegramUserId resolves. The
  // manager-list/revoke mocks resolve DTOs (ISO-string dates); those call sites override the
  // date fields (see dtoDates) rather than this helper guessing per consumer.
  const now = new Date();
  return {
    id: 'rma_1',
    tenantId: DEFAULT_TENANT_ID,
    invitationId: 'inv_1',
    profile: 'owner' as const,
    telegramUserId: '123456',
    telegramChatId: null,
    telegramUsername: 'fleet_owner',
    languageCode: null,
    carrierId: '5758544',
    applicationId: 'APP-9',
    companyName: 'Acme Transport LLC',
    agentName: 'CI Test Admin',
    agentZohoUserId: '777',
    cardId: null,
    driverName: null,
    companyType: 'fleet-manager' as const,
    cardCount: 3,
    authMode: 'telegram' as const,
    status: 'active' as const,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function salesAgentPrincipal(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'sap_1',
    tenantId: DEFAULT_TENANT_ID,
    zohoUserId: '777',
    agentName: 'CI Test Admin',
    telegramUserId: '123456',
    telegramUsername: 'fleet_owner',
    languageCode: 'en',
    status: 'active' as const,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function salesAgentClient(overrides: Partial<AgentClientRow> = {}): AgentClientRow {
  return {
    carrierId: '5758544',
    companyName: 'Acme Transport LLC',
    contact: 'Jane Doe',
    agentName: 'CI Test Admin',
    phone: '555-0100',
    producedCards: 3,
    activeCards: 3,
    lastTierName: 'Silver',
    moneyCode: 'MC-1',
    dot: '12345',
    trucks: 3,
    isLocSuspended: false,
    computedIsActive: true,
    computedDebt: 0,
    computedDebtDays: 0,
    cycleGallons: 1200,
    gallonsThisMonth: 500,
    inNetworkGallonsThisMonth: 480,
    activeCardsThisMonth: 3,
    transactionsThisMonth: 40,
    gallonsPrevMonth: 450,
    inNetworkGallonsPrevMonth: 425,
    activeCardsPrevMonth: 3,
    ...overrides,
  };
}

function managerInviteDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_mgr',
    profile: 'manager' as const,
    carrierId: '5758544',
    applicationId: 'APP-9',
    companyName: 'Acme Transport LLC',
    cardId: null,
    driverName: 'Ops Manager',
    companyType: 'fleet-manager' as const,
    cardCount: null,
    agentName: 'CI Test Admin',
    agentZohoUserId: '777',
    status: 'pending' as const,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** DTO-shaped registration (repo toDto stringifies dates) — for mocks whose method returns a
 *  RegisteredMiniAppCompanyDto rather than the domain row registrationRow models. */
function registrationDto(
  overrides: Partial<RegisteredMiniAppCompanyDto> = {},
): RegisteredMiniAppCompanyDto {
  const { createdAt, updatedAt: _updatedAt, ...rest } = registrationRow();
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
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
        agentName: 'CI Test Admin',
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
        agentName: 'CI Test Admin',
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

  it('lets a REVOKED account register somewhere else — revoke frees the Telegram binding', async () => {
    // findByTelegramUserId returns revoked rows too, so this guard used to fire on them: a revoked
    // user could neither use their access (403 MINI_APP_REVOKED) nor be re-registered anywhere.
    // Revoke was a dead end that bricked the account.
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_new', carrierId: '5765985' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ carrierId: '5758544', status: 'revoked', revokedAt: new Date() }),
    );
    // The invite has to actually burn, or the route reports alreadyRegistered against the OLD row.
    inviteRepo.markRedeemed.mockResolvedValueOnce(inviteRow({ id: 'inv_new', carrierId: '5765985', status: 'redeemed' }));
    registrationRepo.upsert.mockResolvedValueOnce(registrationRow({ carrierId: '5765985' }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_new/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(201);
    expect(registrationRepo.upsert).toHaveBeenCalled();
  });

  it('still blocks an ACTIVE account from being rebound — that guard is the point', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_new', carrierId: '5765985' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ carrierId: '5758544', status: 'active' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_new/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'TELEGRAM_ALREADY_REGISTERED' } });
    expect(registrationRepo.upsert).not.toHaveBeenCalled();
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
        agentName: 'CI Test Admin',
        agentZohoUserId: '777',
      }),
      expect.anything(),
    );
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        agentName: 'CI Test Admin',
      },
    });
  });
});

describe('Sales-agent mini-app portfolio and selected-company scope', () => {
  it('restores a distinct Sales-agent session with active non-debtor companies only', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([
      salesAgentClient({ computedDebt: 500, computedDebtDays: 3 }),
      salesAgentClient({ carrierId: '5760000', companyName: 'Eligible Co' }),
      salesAgentClient({ carrierId: '999', companyName: 'Inactive Co', computedIsActive: false }),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/session',
      payload: { initData: 'signed' },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      kind: 'sales_agent',
      salesAgent: { id: 'sap_1', zohoUserId: '777', agentName: 'CI Test Admin' },
      companies: [{ carrierId: '5760000', companyName: 'Eligible Co', status: 'active' }],
    });
    expect(agentClients).toHaveBeenCalledWith('777', 'CI Test Admin', {
      force: true,
      allowStaleOnError: false,
    });
  });

  it('re-authorizes the selected active company and allows read-only company data', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([salesAgentClient()]);
    crm.getCarrierBalance.mockResolvedValueOnce({ efs_balance: 2500 } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/balance',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(crm.getCarrierBalance).toHaveBeenCalledWith('5758544');
  });

  it('creates a manager link for an assigned fleet before its owner registers', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([salesAgentClient()]);
    registrationRepo.findActiveOwnerByCarrier.mockResolvedValueOnce(undefined);
    inviteRepo.create.mockResolvedValueOnce(managerInviteDto());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ invite: { id: 'inv_mgr' } });
    expect(inviteRepo.create.mock.calls[0]?.[1]).toMatchObject({
      profile: 'manager',
      carrierId: '5758544',
      companyName: 'Acme Transport LLC',
      driverName: 'Ops Manager',
      agentName: 'CI Test Admin',
      agentZohoUserId: '777',
    });
    expect(registrationRepo.findActiveOwnerByCarrier).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'sales_agent' }),
      expect.objectContaining({
        action: 'mini_app.manager_invite.create',
        detail: expect.objectContaining({
          carrierId: '5758544',
          invitedBy: 'sales_agent',
        }),
      }),
    );
  });

  it('regenerates a manager link for the same name by superseding the pending invite', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([salesAgentClient()]);
    inviteRepo.cancelPendingManagersByLogin.mockResolvedValueOnce(1);
    inviteRepo.create.mockResolvedValueOnce(managerInviteDto({ id: 'inv_mgr_regen' }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ invite: { id: 'inv_mgr_regen' } });
    expect(inviteRepo.cancelPendingManagersByLogin).toHaveBeenCalledWith(
      expect.anything(),
      'ops manager',
      expect.anything(),
    );
    expect(inviteRepo.create).toHaveBeenCalled();
  });

  it('still blocks a manager name that is already registered', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([salesAgentClient()]);
    registrationRepo.findActiveManagerByLogin.mockResolvedValueOnce(
      registrationRow({ profile: 'manager', driverName: 'Ops Manager', id: 'reg_mgr_live' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: expect.objectContaining({ message: expect.stringMatching(/already registered/i) }),
    });
    expect(inviteRepo.create).not.toHaveBeenCalled();
    expect(inviteRepo.cancelPendingManagersByLogin).not.toHaveBeenCalled();
  });

  it('does not create a manager link for a company outside the Sales live portfolio', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([
      salesAgentClient({ carrierId: '5760000', companyName: 'Assigned Co' }),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'SALES_AGENT_COMPANY_DENIED' } });
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });

  it('denies a selected company when it is a debtor even if it remains active in Sales', async () => {
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([
      salesAgentClient({ computedDebt: 500, computedDebtDays: 3 }),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/balance',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'SALES_AGENT_COMPANY_DENIED' } });
    expect(crm.getCarrierBalance).not.toHaveBeenCalled();
  });

  it('keeps Sales-agent company preview read-only at the backend', async () => {
    env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    agentMiniAppRepo.findPrincipalByTelegramUserId.mockResolvedValueOnce(salesAgentPrincipal());
    agentClients.mockResolvedValueOnce([salesAgentClient()]);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/card/set-status',
      headers: { 'x-mini-app-carrier-id': '5758544' },
      payload: { initData: 'signed', cardId: 'card_1', action: 'deactivate' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'MINI_APP_CAPABILITY_DENIED' } });
    expect(efs.setCardStatus).not.toHaveBeenCalled();
  });
});

describe('owner-only money views', () => {
  function driverReg() {
    return registrationRow({ profile: 'driver', companyType: null, cardId: 'card_1', driverName: 'James Reyes' });
  }

  // Both the docx (invoices/payment sit under Fleet Owners; the driver list has neither) and
  // OCTANE_MINIAPP_SERVICES_SPEC §2 ("no carrier balance, invoices, payment info, account status")
  // put these out of a driver's reach. The catalog never offers them the button — but the button was
  // the only thing stopping them: their own initData fetched the whole carrier's invoices.
  // Tracking is here for a different reason than the money views. It is not that a driver shouldn't
  // see shipments — it is that the upstream CANNOT tell us which shipment is theirs: the response is
  // { trackingNumber, startDate, cardsOrdered } with no card identity, so scopeRowsToCard has nothing
  // to filter on and every other driver read's scoping has no equivalent here. The route accepted a
  // driver's initData and returned the whole fleet's shipments; no catalog entry pointed at it, so
  // the leak was reachable only by a direct call — and nothing in this suite would have caught it.
  for (const [url, payload] of [
    ['/v1/carrier/mini-app/invoices', { range: 'last_30' }],
    ['/v1/carrier/mini-app/payment-info', {}],
    ['/v1/carrier/mini-app/invoices/signed-url', { invoiceId: '71800' }],
    ['/v1/carrier/mini-app/tracking', {}],
    // The only balance is the carrier's EFS pool — company money. No per-card figure exists
    // (stg_cmp_card.balance is 0.00 for every card), so a driver here could only ever read the
    // company's finances. The card and catalog no longer offer it; this gate makes that real.
    ['/v1/carrier/mini-app/balance', {}],
  ] as const) {
    it(`refuses a driver at ${url}`, async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverReg());

      const res = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', ...payload },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_A_REGISTERED_OWNER_USER' } });
      expect(crm.getInvoices).not.toHaveBeenCalled();
      expect(crm.getPaymentInfo).not.toHaveBeenCalled();
      // The 403 must land BEFORE the upstream call, not filter its result afterwards.
      expect(executeZohoFunctionWithFallback).not.toHaveBeenCalled();
    });
  }

  it('allows an owner-operator — "Fleet Owners" in the docx covers a one-truck owner', async () => {
    // Not requireRegisteredOwner: that demands fleet-manager because it guards driver management.
    // An owner-operator has no fleet to manage but is still the owner of the account.
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ companyType: 'owner-operator', cardCount: 1 }),
    );
    crm.getInvoices.mockResolvedValueOnce({ data: [{ id: '71800' }], count: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/invoices',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', range: 'last_30' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ count: 1 });
  });

  it('still lets a driver read the views the catalog does give them', async () => {
    // Status stays driver-readable (scoped to their card). Balance used to be here too, until it
    // turned out the only balance is the carrier's EFS pool — company money — so it moved into the
    // owner-only list above along with its catalog entry.
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverReg());
    vi.mocked(findDwhCardById).mockResolvedValueOnce({ cardId: 'card_1', cardNumber: '7083050030880417593', cardType: 'FUEL', status: 'Active', balance: '0' });
    crm.getCards.mockResolvedValueOnce({ data: [{ card_number: '7083050030880417593', status: 'Active' }], count: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/status',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('manager access — owner-equivalent, plus manager invites', () => {
  function managerReg(overrides: Record<string, unknown> = {}) {
    // A manager carries fleet-manager companyType (inviteService pins it) — owner-equivalent everywhere.
    return registrationRow({ profile: 'manager', telegramUsername: 'ops_manager', ...overrides });
  }

  it('grants a manager the owner-only money views (invoices) — owner-equivalent', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(managerReg());
    crm.getInvoices.mockResolvedValueOnce({ data: [{ id: '71800' }], count: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/invoices',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', range: 'last_30' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ count: 1 });
  });

  it('fails closed with 503 when manager self-serve invites are flagged off', async () => {
    // Default is OFF (owner decision 2026-07-22) — do not queue a registration; the flag gate
    // rejects before auth, and a leftover once-mock would leak into the next test.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'MANAGER_INVITES_DISABLED' } });
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });

  it('lets a manager mint a manager registration link (managers can grow the team)', async () => {
    env.FF_MINIAPP_MANAGER_INVITES_ENABLED = true;
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(managerReg());
    inviteRepo.findById.mockResolvedValueOnce(inviteRow()); // resolveRegistrationAgent lookup
    inviteRepo.create.mockResolvedValueOnce(managerInviteDto());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ invite: { id: 'inv_mgr' } });
    // Bound to the CALLER's own carrier, profile manager, name stored as driverName — never the body carrier.
    expect(inviteRepo.create.mock.calls[0]?.[1]).toMatchObject({ profile: 'manager', carrierId: '5758544', driverName: 'Ops Manager' });
  });

  it('lets an owner mint a manager link too', async () => {
    env.FF_MINIAPP_MANAGER_INVITES_ENABLED = true;
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow()); // owner, fleet-manager
    inviteRepo.findById.mockResolvedValueOnce(inviteRow());
    inviteRepo.create.mockResolvedValueOnce(managerInviteDto({ id: 'inv_mgr2' }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', name: 'Dana Ops' },
    });

    expect(res.statusCode).toBe(201);
    expect(inviteRepo.create.mock.calls[0]?.[1]).toMatchObject({ profile: 'manager', driverName: 'Dana Ops' });
  });

  it('rejects a manager invite with no name (a manager must be labeled)', async () => {
    env.FF_MINIAPP_MANAGER_INVITES_ENABLED = true;
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(managerReg());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(400);
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a driver at /manager-invites before minting anything', async () => {
    env.FF_MINIAPP_MANAGER_INVITES_ENABLED = true;
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ profile: 'driver', companyType: null, cardId: 'card_1' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/manager-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', name: 'Ops Manager' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_REGISTERED_OWNER' } });
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });

  it('lists the carrier managers for an owner/manager', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(managerReg());
    registrationRepo.listManagersByCarrier.mockResolvedValueOnce([
      registrationDto({ id: 'rma_m1', profile: 'manager', driverName: 'Dana Ops', telegramUsername: 'dana' }),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/managers',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ managers: [{ id: 'rma_m1', name: 'Dana Ops', telegramUsername: 'dana' }] });
    // Scoped to the CALLER's own carrier, from their verified registration.
    expect(registrationRepo.listManagersByCarrier.mock.calls[0]?.[1]).toBe('5758544');
  });

  it('revokes a manager scoped to the caller\'s own carrier', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(managerReg());
    registrationRepo.revokeManagerByCarrier.mockResolvedValueOnce(
      registrationDto({ id: 'rma_m1', profile: 'manager', status: 'revoked' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/managers/revoke',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', id: 'rma_m1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'rma_m1', status: 'revoked' });
    // Repo is called with (carrier, id) — the carrier is the authorization, never the body.
    expect(registrationRepo.revokeManagerByCarrier.mock.calls[0]?.[1]).toBe('5758544');
    expect(registrationRepo.revokeManagerByCarrier.mock.calls[0]?.[2]).toBe('rma_m1');
  });

  it('404s revoking an id that is not a manager of the caller\'s carrier', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(managerReg());
    registrationRepo.revokeManagerByCarrier.mockResolvedValueOnce(undefined); // scoped where-clause matched nothing

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/managers/revoke',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', id: 'rma_foreign' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('refuses a driver at the managers list + revoke', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValue(
      registrationRow({ profile: 'driver', companyType: null, cardId: 'card_1' }),
    );

    const list = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/managers',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });
    expect(list.statusCode).toBe(403);

    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/managers/revoke',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', id: 'rma_m1' },
    });
    expect(revoke.statusCode).toBe(403);
    expect(registrationRepo.revokeManagerByCarrier).not.toHaveBeenCalled();
  });
});

describe('Card Lookup report delivery', () => {
  const liveCards = {
    data: [
      {
        cardNumber: '708305000000007378',
        unitNumber: '995',
        driverId: '995',
        driverName: 'GIYOSBAKHRIDDIN',
        status: 'Inactive',
        override: 0,
      },
    ],
  };

  it.each(['owner', 'manager'] as const)(
    'sends an XLSX report to a verified %s private chat',
    async (profile) => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
        registrationRow({ profile }),
      );
      dwhCards.mockResolvedValueOnce([
        {
          cardId: '1000079491580',
          cardNumber: '708305000000007378',
          cardType: 'FLEET',
          status: 'Inactive',
          balance: null,
        },
      ]);
      efs.listCards.mockResolvedValueOnce(liveCards);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card-lookup-report',
        payload: { initData: 'signed', format: 'xlsx' },
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ sent: true, rows: 1 });
      expect(botSendDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '123456',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileName: expect.stringMatching(/Card_Lookup.*\.xlsx$/),
        }),
      );
    },
  );

  it('refuses a driver before reading fleet cards', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ profile: 'driver', cardId: 'card_driver' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/card-lookup-report',
      payload: { initData: 'signed', format: 'pdf' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'NOT_A_REGISTERED_OWNER_USER' },
    });
    expect(efs.listCards).not.toHaveBeenCalled();
    expect(cardLookupReport).not.toHaveBeenCalled();
    expect(botSendDocument).not.toHaveBeenCalled();
  });
});

describe('invoice delivery', () => {
  it('refuses an invoice that is not this carrier\'s — the ids are enumerable integers', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    // The upstream signed-url endpoint takes an invoiceId and nothing else, so this ownership join
    // is the only thing between one carrier and another's invoice.
    crm.getInvoices.mockResolvedValueOnce({ data: [{ id: '71800' }], count: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/invoices/send',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', invoiceId: '1' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'INVOICE_NOT_OWNED' } });
    expect(botSendDocument).not.toHaveBeenCalled();
    expect(crm.getInvoiceSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a driver outright — invoices are owner-only', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ profile: 'driver', companyType: null, cardId: 'card_1' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/invoices/send',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', invoiceId: '71800' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_REGISTERED_OWNER_USER' } });
    expect(botSendDocument).not.toHaveBeenCalled();
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
    // Exact lookup by (carrier, card) — the old scan of listDwhCards capped at 100.
    vi.mocked(findDwhCardById).mockResolvedValueOnce({ cardId: 'card_1', cardNumber: OWN_CARD, cardType: 'FUEL', status: 'Active', balance: '0' });
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
      vi.mocked(findDwhCardById).mockResolvedValueOnce(null); // card gone / DWH degraded

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

    it('drops merged rows that fall outside the asked-for period, and re-totals from what is left', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
      // servercrm's EFS gap-fill reaches past the window: asked for "today" it returned two rows
      // dated the 16th — already in the mart, and only un-deduped because an empty window meant an
      // empty id set. Its totals are DWH-only, so the sheet showed $0.00 above two live rows.
      // Note the shapes differ: EFS carries an offset, the mart is naive.
      crm.getTransactions.mockResolvedValueOnce({
        data: [
          { transaction_id: 'efs1', card_number: OWN_CARD, transaction_date: '2026-07-16T22:59:00.000-05:00', line_item_amount: 327.37 },
          { transaction_id: 'efs2', card_number: OWN_CARD, transaction_date: '2026-07-16T22:59:00.000-05:00', line_item_amount: 20.96 },
        ],
        totals: { funded_total: 0, line_items: 0, transactions: 0 },
        pagination: { more_records: false },
      });
      const today = '2026-07-17';
      dwhRange.mockReturnValueOnce({ preset: 'day', from: today, to: today });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'day', live: true },
      });

      const body = res.json();
      expect(body.data, `rows dated 2026-07-16 must not appear under ${today}`).toHaveLength(0);
      expect(body.totals).toMatchObject({ funded_total: 0, line_items: 0 });
    });

    it('keeps an in-window merged row and counts it toward the totals', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
      const today = '2026-07-17';
      dwhRange.mockReturnValueOnce({ preset: 'day', from: today, to: today });
      crm.getTransactions.mockResolvedValueOnce({
        data: [{ transaction_id: 'efs1', card_number: OWN_CARD, transaction_date: `${today}T08:00:00.000-05:00`, line_item_amount: 100 }],
        // DWH-only totals do not know about a row EFS has and the mart has not caught up on yet.
        totals: { funded_total: 0, line_items: 0, transactions: 0 },
        pagination: { more_records: false },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'day', live: true },
      });

      const body = res.json();
      expect(body.data).toHaveLength(1);
      // The summary must never contradict the list it sits above.
      expect(body.totals).toMatchObject({ funded_total: 100, line_items: 1 });
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
      expect(sent.fileName).toMatch(/^Octane_Transactions_417593_.*\.csv$/);
      expect(String(sent.bytes)).toContain('LOVES #711');
      // Masked in the file, exactly as the sheet shows it.
      expect(String(sent.bytes)).not.toContain(OWN_CARD);
    });

    it('prefers a stored telegramChatId when the registration captured one', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverRow({ telegramChatId: '999888' }));
      vi.mocked(findDwhCardById).mockResolvedValueOnce({ cardId: 'card_1', cardNumber: OWN_CARD, cardType: 'FUEL', status: 'Active', balance: '0' });
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

    it('footers and headers every page of a multi-page PDF, and keeps the totals on it', async () => {
      withResolvableCard();
      // Enough rows to force a second page — a one-page report cannot catch a missing footer on
      // page 1, because there the last page IS the first.
      const many = Array.from({ length: 60 }, (_, i) => ({
        ...reportRows[0]!,
        transaction_id: `t${i}`,
        line_item_amount: 10,
        line_item_fuel_quantity: 1,
        line_item_discount_amount: 0,
      }));
      dwhTxns.mockResolvedValueOnce(dwhResult(many));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/transactions/export',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', range: 'month', format: 'pdf' },
      });

      expect(res.statusCode).toBe(200);
      const bytes = botSendDocument.mock.calls[0]![0].bytes as Buffer;
      const { getDocumentProxy, extractText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      expect(totalPages).toBeGreaterThan(1);
      const pages = (text as string[]).map((t) => t.replace(/\s+/g, ' '));
      pages.forEach((page, i) => {
        expect(page, `page ${i + 1} footer`).toMatch(/Page \d+ of \d+/);
        expect(page, `page ${i + 1} table header`).toMatch(/Date.*Location.*City/);
      });
      expect(pages.join(' ')).toMatch(/TOTAL/);
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

describe('service requests file real Desk tickets', () => {
  const OWN_CARD = '7083050030880417593';
  const OTHER_CARD = '7083050030889467593';

  function driverReg(overrides: Record<string, unknown> = {}) {
    return registrationRow({
      profile: 'driver',
      companyType: null,
      cardId: 'card_1',
      driverName: 'James Reyes',
      ...overrides,
    });
  }

  function withResolvableCard(reg = driverReg()) {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(reg);
    vi.mocked(findDwhCardById).mockResolvedValueOnce({ cardId: 'card_1', cardNumber: OWN_CARD, cardType: 'FUEL', status: 'Active', balance: '0' });
  }

  it('creates a ticket for a driver and returns its real id', async () => {
    withResolvableCard();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'override-card' },
    });

    expect(res.statusCode).toBe(200);
    // The id comes from Desk. The UI shows "Request sent" off THIS value, so a fabricated or
    // optimistic success is exactly what must not be possible.
    expect(res.json()).toMatchObject({ ticketId: '1057080000099887766' });
    expect(createDeskTicket).toHaveBeenCalledTimes(1);
  });

  it("stamps the driver's OWN card, ignoring anything the payload claims", async () => {
    withResolvableCard();

    await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      // A driver trying to file an override against a colleague's card. The field is not in the
      // schema, so it is stripped — the card must come from their registration, never the body.
      payload: { initData: 'signed', service: 'override-card', cardNumber: OTHER_CARD },
    });

    const arg = vi.mocked(createDeskTicket).mock.calls[0]?.[0];
    expect(arg?.cf?.cf_card_number).toBe(OWN_CARD);
    expect(JSON.stringify(arg)).not.toContain(OTHER_CARD);
  });

  it('routes to Customer Service — the same queue servercrm maps "override card" to', async () => {
    withResolvableCard();

    await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'override-card' },
    });

    expect(vi.mocked(createDeskTicket).mock.calls[0]?.[0]?.departmentId).toBe('1057080000000323033');
  });

  it('rejects an unknown service rather than filing it somewhere', async () => {
    // Deliberately queues NO registration: the schema rejects before auth runs, so a queued
    // mockResolvedValueOnce would go unconsumed — and vi.clearAllMocks() does not drain the once
    // queue, so it would surface in whichever test called findByTelegramUserId next.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'close-account' },
    });

    expect(res.statusCode).toBe(400);
    expect(createDeskTicket).not.toHaveBeenCalled();
  });

  // The driver catalog offers only the two card-in-hand requests. The map is what enforces that —
  // not the absence of a button — so a driver's own initData must be refused at every owner-side key.
  // Owner-only catalog keys (ref-guides retired; account-reactivate is the CS reactivation path).
  for (const key of ['card-activate', 'card-limit', 'card-replace', 'card-fraud', 'billing-form', 'account-reactivate'] as const) {
    it(`refuses a driver at the owner-only request "${key}"`, async () => {
      // No card mock: the role check refuses before requireDriverCardNumber runs, so a queued
      // dwhCards value would go unconsumed and leak into the next test that resolves a card.
      registrationRepo.findByTelegramUserId.mockResolvedValueOnce(driverReg());

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/service-request',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', service: key },
      });

      expect(res.statusCode).toBe(403);
      expect(createDeskTicket).not.toHaveBeenCalled();
    });
  }

  for (const key of ['override-card', 'money-code', 'maintenance-roadside', 'callback', 'general-support'] as const) {
    it(`allows a driver at "${key}" — the card in their hand`, async () => {
      withResolvableCard();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/service-request',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', service: key },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(createDeskTicket).mock.calls[0]?.[0]?.cf?.cf_card_number).toBe(OWN_CARD);
    });
  }

  it('routes a general handoff to Customer Service', async () => {
    withResolvableCard();

    await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: {
        initData: 'signed',
        service: 'general-support',
        comment: 'Need a human to review an unsupported operational question',
      },
    });

    const ticket = vi.mocked(createDeskTicket).mock.calls[0]?.[0];
    expect(ticket?.departmentId).toBe('1057080000000323033');
    expect(ticket?.cf?.cf_ticket_type).toBe('Customer Service');
  });

  it('routes maintenance and roadside requests to the Maintenance department', async () => {
    withResolvableCard();

    await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: {
        initData: 'signed',
        service: 'maintenance-roadside',
        comment: 'Unit 504, tire failure near Dallas, shop quote $780',
      },
    });

    const ticket = vi.mocked(createDeskTicket).mock.calls[0]?.[0];
    expect(ticket?.departmentId).toBe('1057080000006966104');
    expect(ticket?.description).toContain('Unit 504');
    expect(ticket?.cf?.cf_ticket_type).toBe('Maintenance');
  });

  it('routes the billing form to Billing, not Customer Service', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'billing-form' },
    });

    expect(vi.mocked(createDeskTicket).mock.calls[0]?.[0]?.departmentId).toBe('1057080000000329409');
  });

  it("carries the requester's comment into the ticket body", async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'card-replace', comment: 'Card ending 7593, driver James, stolen at a truck stop' },
    });

    expect(vi.mocked(createDeskTicket).mock.calls[0]?.[0]?.description).toContain('stolen at a truck stop');
  });

  it('files an owner request with no card — an owner has a fleet, not one card', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'card-fraud' },
    });

    expect(res.statusCode).toBe(200);
    // No card resolution is attempted for an owner, so the field is simply absent rather than a
    // wrong card picked from the fleet.
    expect(vi.mocked(createDeskTicket).mock.calls[0]?.[0]?.cf?.cf_card_number).toBeUndefined();
  });

  it('fails loudly when Desk rejects the ticket — never reports a send that did not happen', async () => {
    withResolvableCard();
    vi.mocked(createDeskTicket).mockRejectedValueOnce(new Error('[zoho-desk] POST /tickets HTTP 422'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/service-request',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', service: 'override-card' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'SERVICE_REQUEST_FAILED' } });
  });
});

describe('driver self-registration by card number (retired)', () => {
  it('returns 410 — card-number login removed; drivers use invite + password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-self-register',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardNumber: '7083050030880417593' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: { code: 'DRIVER_SELF_REGISTER_REMOVED' } });
  });
});

describe('owner renames a driver on the fleet screen', () => {
  const CARRIER = '5758544';

  it('renames the registered driver holding that card', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    registrationRepo.renameDriverByCard.mockResolvedValueOnce({ id: 'rma_9', driverName: 'James Reyes' } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-name',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'card_1', driverName: '  James Reyes  ' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ cardId: 'card_1', driverName: 'James Reyes' });
    // The carrier is taken from the caller's own registration, never the body — that where-clause
    // IS the authorization, so it has to be the caller's carrier that reaches the repo.
    expect(registrationRepo.renameDriverByCard).toHaveBeenCalledWith(expect.anything(), CARRIER, 'card_1', 'James Reyes');
    // A registered driver was found, so the pending-invite path must not also fire.
    expect(inviteRepo.renameDriverByCard).not.toHaveBeenCalled();
  });

  it('falls back to the pending invite when the driver has not signed in yet', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    registrationRepo.renameDriverByCard.mockResolvedValueOnce(undefined);
    inviteRepo.renameDriverByCard.mockResolvedValueOnce(inviteRow({ id: 'inv_9', driverName: 'James Reyes' }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-name',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'card_2', driverName: 'James Reyes' },
    });

    expect(res.statusCode).toBe(200);
    expect(inviteRepo.renameDriverByCard).toHaveBeenCalledWith(expect.anything(), CARRIER, 'card_2', 'James Reyes');
  });

  it("404s a card with no driver — including another carrier's card, which simply matches nothing", async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    registrationRepo.renameDriverByCard.mockResolvedValueOnce(undefined);
    inviteRepo.renameDriverByCard.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-name',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'someone-elses-card', driverName: 'Mallory' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('refuses a driver — renaming the roster is the owner\'s job', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ profile: 'driver', companyType: null, cardId: 'card_1', driverName: 'James Reyes' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-name',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'card_1', driverName: 'Fleet Manager' },
    });

    expect(res.statusCode).toBe(403);
    expect(registrationRepo.renameDriverByCard).not.toHaveBeenCalled();
  });

  it('rejects a blank name at the schema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-name',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'card_1', driverName: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(registrationRepo.renameDriverByCard).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Write-action endpoints (carrierMiniAppActions.routes.ts) — the security layer that guards the
// EFS / servercrm writes behind the mini-app. A write here moves real money and card state, so the
// gates must fire in a fixed order BEFORE any wrapper is called: feature flag → auth (role) → rate
// limit → card ownership. Each test asserts both the rejection code AND that the wrapper was never
// reached, so a reordering that leaks a write past a gate fails loudly.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('mini-app write actions — RBAC + gate order', () => {
  const CARRIER = '5758544';

  const ownerRow = (o: Record<string, unknown> = {}) =>
    registrationRow({ profile: 'owner', carrierId: CARRIER, ...o });
  const driverRow = (o: Record<string, unknown> = {}) =>
    registrationRow({ profile: 'driver', carrierId: CARRIER, cardId: 'card_own', companyType: null, ...o });

  /** The DWH confirms `cardId` is a card of CARRIER, resolving to `cardNumber` for EFS. */
  function ownsCard(cardId: string, cardNumber: string) {
    vi.mocked(findDwhCardById).mockResolvedValue({ cardId, cardNumber, cardType: 'FUEL', status: 'Active', balance: '0' });
  }

  describe('feature flags fail closed (503) before touching EFS', () => {
    it('blocks a card write with MINIAPP_WRITES_DISABLED while the flag is off', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow());

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/set-status',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', cardId: 'card_own', action: 'deactivate' },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'MINIAPP_WRITES_DISABLED' } });
      expect(efs.setCardStatus).not.toHaveBeenCalled();
    });

    it('blocks money code with MINIAPP_MONEY_CODE_DISABLED while the flag is off', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow());

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/money-code/preview',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed' },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'MINIAPP_MONEY_CODE_DISABLED' } });
      expect(crm.getMoneyCodePreview).not.toHaveBeenCalled();
    });
  });

  describe('role gate — a driver cannot reach an owner-only write', () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
      env.FF_MINIAPP_MONEY_CODE_ENABLED = true;
    });

    for (const [url, extra] of [
      ['/v1/carrier/mini-app/card/set-status', { cardId: 'card_own', action: 'deactivate' }],
      ['/v1/carrier/mini-app/card/limits', { cardId: 'card_own', limitId: 'ULSD', value: 10, action: 'increase' }],
      ['/v1/carrier/mini-app/card/fraud-request', { cardId: 'card_own', request: 'fraud_hold' }],
      ['/v1/carrier/mini-app/money-code/preview', {}],
      ['/v1/carrier/mini-app/money-code/draw', { amount: 100, unitNumber: '42', reason: 'fuel' }],
    ] as const) {
      it(`403s a driver on ${url}`, async () => {
        registrationRepo.findByTelegramUserId.mockResolvedValue(driverRow());
        ownsCard('card_own', '7083050030880417593'); // even with a resolvable card, role is checked first

        const res = await app.inject({
          method: 'POST',
          url,
          headers: { 'content-type': 'application/json' },
          payload: { initData: 'signed', ...extra },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: { code: 'NOT_A_REGISTERED_OWNER_USER' } });
        expect(efs.setCardStatus).not.toHaveBeenCalled();
        expect(efs.setCardLimits).not.toHaveBeenCalled();
        expect(crm.drawMoneyCode).not.toHaveBeenCalled();
      });
    }
  });

  describe('card/info — a driver edits unit/driverId on their OWN card, never the roster name', () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    });

    it('lets a driver set unitNumber + driverId with no cardId (pinned to their own card)', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(driverRow());
      vi.mocked(findDwhCardById).mockResolvedValue({ cardId: 'card_own', cardNumber: 'DRIVER_OWN_PAN', cardType: 'FUEL', status: 'Active', balance: '0' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/info',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', unitNumber: '4031', driverId: '2605' },
      });

      expect(res.statusCode).toBe(200);
      expect(efs.updateCardInfo).toHaveBeenCalledWith(CARRIER, 'DRIVER_OWN_PAN', { unitNumber: '4031', driverId: '2605' });
    });

    it('403s a driver trying to rename the roster driverName (owner-only field)', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(driverRow());

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/info',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', driverName: 'Someone Else' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'DRIVER_NAME_OWNER_ONLY' } });
      expect(efs.updateCardInfo).not.toHaveBeenCalled();
    });
  });

  describe('card ownership — an owner cannot aim a write at a foreign card', () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    });

    it("404s when the cardId is not a card of the caller's carrier", async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow());
      vi.mocked(findDwhCardById).mockResolvedValue(null); // DWH: this card is not on this carrier

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/set-status',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', cardId: 'card_from_another_fleet', action: 'deactivate' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(efs.setCardStatus).not.toHaveBeenCalled();
    });

    it("resolves the card against the OWNER's carrierId, never a body-supplied carrier", async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow());
      ownsCard('card_own', '7083050030880417593');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/set-status',
        headers: { 'content-type': 'application/json' },
        // A hostile body carrierId must be ignored — scoping comes from the verified registration.
        payload: { initData: 'signed', cardId: 'card_own', action: 'activate', carrierId: '9999999' },
      });

      expect(res.statusCode).toBe(200);
      expect(findDwhCardById).toHaveBeenCalledWith(CARRIER, 'card_own');
      expect(efs.setCardStatus).toHaveBeenCalledWith(CARRIER, '7083050030880417593', 'activate');
    });
  });

  describe('rate limit — the 6th write in a window is refused per carrier', () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    });

    it('allows 5 then 429s the 6th with MINIAPP_WRITE_RATE_LIMITED', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow());
      ownsCard('card_own', '7083050030880417593');
      const call = () =>
        app.inject({
          method: 'POST',
          url: '/v1/carrier/mini-app/card/set-status',
          headers: { 'content-type': 'application/json' },
          payload: { initData: 'signed', cardId: 'card_own', action: 'activate' },
        });

      for (let i = 0; i < 5; i++) expect((await call()).statusCode).toBe(200);
      const sixth = await call();

      expect(sixth.statusCode).toBe(429);
      expect(sixth.json()).toMatchObject({ error: { code: 'MINIAPP_WRITE_RATE_LIMITED' } });
      // The token is taken BEFORE the card resolve/EFS call, so the refused write never reached EFS.
      expect(efs.setCardStatus).toHaveBeenCalledTimes(5);
    });
  });

  describe("driver override — pinned to the driver's OWN card, body cardId ignored", () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
      // Force the REAL efs.overrideCard path: the route has a dev-mock short-circuit gated on
      // FF_DEV_MOCK_TELEGRAM_ENABLED that returns a canned result without calling EFS, so this
      // assertion (own card reaches EFS, colleague card never resolved) needs the mock off.
      env.FF_DEV_MOCK_TELEGRAM_ENABLED = false;
    });

    it("overrides the driver's registered card even when the payload names another", async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(driverRow({ cardId: 'card_own' }));
      // Only the driver's own (carrier, card_own) resolves; a stray body cardId is never looked up.
      vi.mocked(findDwhCardById).mockImplementation(async (carrier, cardId) =>
        carrier === CARRIER && cardId === 'card_own'
          ? { cardId: 'card_own', cardNumber: 'DRIVER_OWN_PAN', cardType: 'FUEL', status: 'Active', balance: '0' }
          : null,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/override',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', cardId: 'card_belonging_to_a_colleague' },
      });

      expect(res.statusCode).toBe(200);
      expect(efs.overrideCard).toHaveBeenCalledWith(CARRIER, 'DRIVER_OWN_PAN');
      // The colleague's card the driver tried to name is never resolved, let alone acted on.
      expect(findDwhCardById).not.toHaveBeenCalledWith(CARRIER, 'card_belonging_to_a_colleague');
    });

    it('refuses the override when the card is not fraud-held (409, EFS never touched)', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(driverRow({ cardId: 'card_own' }));
      vi.mocked(findDwhCardById).mockResolvedValue({
        cardId: 'card_own',
        cardNumber: 'DRIVER_OWN_PAN',
        cardType: 'FUEL',
        status: 'Active',
        balance: '0',
      });
      vi.mocked(efs.assertCardFraudHeld).mockRejectedValue(
        new AppError('Override is only available for fraud-held cards (current status: Active)', {
          statusCode: 409,
          code: 'OVERRIDE_NOT_FRAUD_HELD',
          expose: true,
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/override',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'OVERRIDE_NOT_FRAUD_HELD' } });
      expect(efs.overrideCard).not.toHaveBeenCalled();
    });
  });

  describe('unregistered / revoked identities are turned away at the write layer', () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    });

    it('404s an unregistered Telegram user (MINI_APP_NOT_REGISTERED)', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/set-status',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', cardId: 'card_own', action: 'activate' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'MINI_APP_NOT_REGISTERED' } });
      expect(efs.setCardStatus).not.toHaveBeenCalled();
    });

    it('403s a revoked registration (MINI_APP_REVOKED)', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow({ status: 'revoked' }));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/set-status',
        headers: { 'content-type': 'application/json' },
        payload: { initData: 'signed', cardId: 'card_own', action: 'activate' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'MINI_APP_REVOKED' } });
      expect(efs.setCardStatus).not.toHaveBeenCalled();
    });
  });

  describe('limit change is clamped server-side', () => {
    beforeEach(() => {
      env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    });

    it('422s a change above MINIAPP_LIMIT_CHANGE_MAX before any EFS call', async () => {
      registrationRepo.findByTelegramUserId.mockResolvedValue(ownerRow());
      ownsCard('card_own', '7083050030880417593');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/carrier/mini-app/card/limits',
        headers: { 'content-type': 'application/json' },
        payload: {
          initData: 'signed',
          cardId: 'card_own',
          limitId: 'ULSD',
          value: env.MINIAPP_LIMIT_CHANGE_MAX + 1,
          action: 'increase',
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'LIMIT_CHANGE_TOO_LARGE' } });
      expect(efs.setCardLimits).not.toHaveBeenCalled();
    });
  });
});

// A driver's transaction export must never carry the owner's discount terms — the report is forced
// to retail pricing regardless of what the client asks for. This lives on carrierMiniApp.routes but
// is a scoping/RBAC invariant, so it belongs with the mini-app security tests.
describe('driver transaction export is always retail-priced', () => {
  it('forces retail even when a driver asks for discount pricing', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValue(
      registrationRow({ profile: 'driver', carrierId: '5758544', cardId: 'card_1', companyType: null }),
    );
    vi.mocked(findDwhCardById).mockResolvedValue({ cardId: 'card_1', cardNumber: '7083050030880417593', cardType: 'FUEL', status: 'Active', balance: '0' });
    dwhTxns.mockResolvedValue({
      data: [{ transaction_id: 't1', card_number: '7083050030880417593', line_item_amount: 100, line_item_funded_amount: 90, line_item_discount_amount: 10 }],
      totals: { transactions: 1, line_items: 1, funded_total: 90, fuel_quantity: 20, total_fuel_quantity: 20, discount_amount: 10 },
      range: { preset: 'month', from: '2026-07-01', to: '2026-07-17' },
      pagination: { page: 1, limit: 5000, count: 1, more_records: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/transactions/export',
      headers: { 'content-type': 'application/json' },
      // Driver explicitly asks for 'discount' — the route must override it to 'retail'.
      payload: { initData: 'signed', range: 'month', format: 'csv', priceMode: 'discount' },
    });

    expect(res.statusCode).toBe(200);
    // The report is delivered to the bot chat; its caption reflects the price mode actually used.
    const caption = botSendDocument.mock.calls.at(-1)?.[0]?.caption ?? '';
    expect(caption).toMatch(/retail/i);
    // The "saved" (discount) summary line is the owner-only variant — it must never reach a driver.
    expect(caption).not.toMatch(/saved/i);
  });
});

// Owner feedback 2026-08-07 (#4): "Balance Check ... Couldn't load this. Pull down to try again."
// The route returned servercrm's /carrier-balance verbatim, so one failing upstream endpoint took
// the whole sheet down — while Account Status, which reads /carrier-overview, kept working on the
// same account. Same money, one call away.
describe('Balance Check survives a carrier-balance outage', () => {
  it('serves the overview figures when the dedicated balance endpoint fails', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    crm.getCarrierBalance.mockRejectedValueOnce(new AppError('servercrm request failed', { statusCode: 502 }));
    crm.getCarrierOverview.mockResolvedValueOnce({
      company_name: 'Acme Transport LLC',
      account_type: 'Prepay',
      efs_balance: 1875.25,
      is_active: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/balance',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ efs_balance: 1875.25, account_type: 'Prepay' });
  });

  it('still surfaces a real outage when both endpoints are down', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    crm.getCarrierBalance.mockRejectedValueOnce(new AppError('servercrm request failed', { statusCode: 502 }));
    crm.getCarrierOverview.mockRejectedValueOnce(new AppError('servercrm request failed', { statusCode: 502 }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/balance',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(502);
  });
});
