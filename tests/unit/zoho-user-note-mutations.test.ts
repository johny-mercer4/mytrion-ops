import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithTimeoutMock, findTokenMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
  findTokenMock: vi.fn(),
}));

vi.mock('../../src/lib/http.js', () => ({ fetchWithTimeout: fetchWithTimeoutMock }));
vi.mock('../../src/repos/workerZohoTokenRepo.js', () => ({
  workerZohoTokenRepo: { find: findTokenMock },
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOHO_ACCOUNTS_DOMAIN: 'https://accounts.zoho.com',
      ZOHO_SERVER_CLIENT_ID: 'client-id',
      ZOHO_SERVER_CLIENT_SECRET: 'client-secret',
      ZOHO_CRM_API_DOMAIN: 'https://www.zohoapis.com/crm/v8',
    },
  };
});

import { deleteNoteAsUser, updateNoteAsUser } from '../../src/integrations/zohoUserAuth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Zoho user-attributed note mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findTokenMock.mockResolvedValue('refresh-token');
    fetchWithTimeoutMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'worker-access-token', expires_in: 3600 }),
    );
  });

  it('PATCHes /Notes/{id} with the worker token', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ status: 'success', code: 'SUCCESS', details: { id: '7001' } }] }),
    );

    await expect(
      updateNoteAsUser('tenant-patch', 'agent-patch', '7001', {
        Note_Title: 'Title',
        Note_Content: 'Body',
      }),
    ).resolves.toBe(true);

    expect(fetchWithTimeoutMock).toHaveBeenNthCalledWith(
      2,
      'https://www.zohoapis.com/crm/v8/Notes/7001',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Zoho-oauthtoken worker-access-token' }),
        body: JSON.stringify({ data: [{ Note_Title: 'Title', Note_Content: 'Body' }] }),
      }),
    );
  });

  it('DELETEs /Notes/{id} with the worker token', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ status: 'success', code: 'SUCCESS', details: { id: '7002' } }] }),
    );

    await expect(deleteNoteAsUser('tenant-delete', 'agent-delete', '7002')).resolves.toBe(true);

    expect(fetchWithTimeoutMock).toHaveBeenNthCalledWith(
      2,
      'https://www.zohoapis.com/crm/v8/Notes/7002',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Zoho-oauthtoken worker-access-token' }),
      }),
    );
  });
});
