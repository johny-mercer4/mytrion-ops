/**
 * sendHorizonDocumentToLinkedWorker — tenant isolation + unlink codes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, RBACError } from '../../src/lib/errors.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const findByZohoUserId = vi.hoisted(() => vi.fn());
const sendHorizonDocument = vi.hoisted(() => vi.fn());

vi.mock('../../src/repos/horizonWorkerTelegramRepo.js', () => ({
  horizonWorkerTelegramRepo: {
    findByZohoUserId,
    findByTelegramUserId: vi.fn(),
    upsertWebAppBind: vi.fn(),
    refreshFromBotStart: vi.fn(),
  },
}));

vi.mock('../../src/integrations/telegramHorizonBot.js', () => ({
  sendHorizonDocument,
  HorizonTelegramChatUnreachableError: class HorizonTelegramChatUnreachableError extends Error {
    constructor(description: string) {
      super(description);
      this.name = 'HorizonTelegramChatUnreachableError';
    }
  },
}));

import { sendHorizonDocumentToLinkedWorker } from '../../src/modules/horizon/sendHorizonDocument.js';

const ctx = (tenantId: string, patch?: Partial<TenantContext>): TenantContext => ({
  tenantId,
  userId: 'zoho:42',
  role: 'worker',
  scopes: [],
  audience: 'internal',
  departments: [],
  allDepartmentAccess: false,
  requestId: 'test',
  sessionVerified: true,
  ...patch,
});

const LINK = {
  id: '11111111-1111-1111-1111-111111111111',
  tenantId: 'tenant_acme',
  zohoUserId: '42',
  telegramUserId: '99',
  telegramChatId: '99',
  telegramUsername: 'ada',
  status: 'active' as const,
};

beforeEach(() => {
  findByZohoUserId.mockReset();
  sendHorizonDocument.mockReset();
  sendHorizonDocument.mockResolvedValue(undefined);
});

describe('sendHorizonDocumentToLinkedWorker', () => {
  it('looks up the link with the session tenant + zoho id and sends on that chat', async () => {
    findByZohoUserId.mockResolvedValueOnce(LINK);
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await sendHorizonDocumentToLinkedWorker(ctx('tenant_acme'), {
      bytes,
      filename: 'invoices.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(findByZohoUserId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_acme', userId: 'zoho:42' }),
      '42',
    );
    expect(sendHorizonDocument).toHaveBeenCalledWith({
      chatId: '99',
      fileName: 'invoices.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes,
    });
    expect(result).toEqual({ chatId: '99', telegramUserId: '99', filename: 'invoices.xlsx' });
  });

  it('does not look up another tenant when the session is rival', async () => {
    findByZohoUserId.mockResolvedValueOnce({ ...LINK, tenantId: 'tenant_rival' });
    await sendHorizonDocumentToLinkedWorker(ctx('tenant_rival', { userId: 'zoho:99' }), {
      bytes: new Uint8Array([1]),
      filename: 'a.csv',
      mimeType: 'text/csv',
    });
    expect(findByZohoUserId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_rival' }),
      '99',
    );
    expect(findByZohoUserId).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_acme' }),
      expect.anything(),
    );
  });

  it('returns TELEGRAM_CHAT_UNLINKED when no active link exists', async () => {
    findByZohoUserId.mockResolvedValueOnce(undefined);
    await expect(
      sendHorizonDocumentToLinkedWorker(ctx('tenant_acme'), {
        bytes: new Uint8Array([1]),
        filename: 'a.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'TELEGRAM_CHAT_UNLINKED', statusCode: 409 });
    expect(sendHorizonDocument).not.toHaveBeenCalled();
  });

  it('treats a revoked link as unlinked', async () => {
    findByZohoUserId.mockResolvedValueOnce({ ...LINK, status: 'revoked' });
    await expect(
      sendHorizonDocumentToLinkedWorker(ctx('tenant_acme'), {
        bytes: new Uint8Array([1]),
        filename: 'a.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(sendHorizonDocument).not.toHaveBeenCalled();
  });

  it('rejects a customer-audience session', async () => {
    await expect(
      sendHorizonDocumentToLinkedWorker(ctx('tenant_acme', { audience: 'customer' }), {
        bytes: new Uint8Array([1]),
        filename: 'a.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(RBACError);
    expect(findByZohoUserId).not.toHaveBeenCalled();
    expect(sendHorizonDocument).not.toHaveBeenCalled();
  });
});
