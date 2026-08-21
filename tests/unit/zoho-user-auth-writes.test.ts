import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext } from '../fixtures/seed.js';

const { fetchWithTimeoutMock, findTokenMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
  findTokenMock: vi.fn(),
}));

vi.mock('../../src/lib/http.js', () => ({ fetchWithTimeout: fetchWithTimeoutMock }));
vi.mock('../../src/repos/workerZohoTokenRepo.js', () => ({
  workerZohoTokenRepo: { find: findTokenMock, upsert: vi.fn() },
}));
vi.mock('../../src/config/env.js', () => ({
  env: {
    ZOHO_ACCOUNTS_DOMAIN: 'https://accounts.zoho.test',
    ZOHO_SERVER_CLIENT_ID: 'client-id',
    ZOHO_SERVER_CLIENT_SECRET: 'client-secret',
    ZOHO_CRM_API_DOMAIN: 'https://crm.zoho.test/crm/v8',
    OUTBOUND_HTTP_TIMEOUT_MS: 30_000,
  },
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  attachFileAsUser,
  clearUserTokenCache,
  deleteRecordAsUser,
  insertNoteAsUser,
  insertRecordAsUserDetailed,
  patchRecordAsUser,
  updateRecordAsUser,
  zohoActorId,
} from '../../src/integrations/zohoUserAuth.js';

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function refreshed(accessToken = 'agent-access'): Response {
  return response(200, { access_token: accessToken, expires_in: 3600 });
}

function success(id: string): Response {
  return response(200, {
    data: [{ code: 'SUCCESS', status: 'success', details: { id }, message: 'record added' }],
  });
}

describe('per-user Zoho CRM writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserTokenCache();
    findTokenMock.mockResolvedValue('agent-refresh');
  });

  it('fails closed when the worker has no stored refresh token', async () => {
    findTokenMock.mockResolvedValueOnce(null);
    await expect(
      insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'hello' }),
    ).rejects.toMatchObject({
      code: 'ZOHO_REAUTH_REQUIRED',
      statusCode: 409,
    });
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
  });

  it('refreshes once, caches the access token, and inserts Notes as the agent', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(success('note-1'))
      .mockResolvedValueOnce(success('note-2'));

    await expect(insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'one' })).resolves.toBe(
      'note-1',
    );
    await expect(insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'two' })).resolves.toBe(
      'note-2',
    );

    expect(findTokenMock).toHaveBeenCalledOnce();
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchWithTimeoutMock.mock.calls[1]!;
    expect(url).toBe('https://crm.zoho.test/crm/v8/Notes');
    expect(init.headers.Authorization).toBe('Zoho-oauthtoken agent-access');
    expect(JSON.parse(String(init.body))).toEqual({ data: [{ Note_Content: 'one' }] });
  });

  it('rejects a successful note response attributed to a different CRM user', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(refreshed()).mockResolvedValueOnce(
      response(201, {
        data: [
          {
            code: 'SUCCESS',
            status: 'success',
            details: { id: 'note-wrong', Created_By: { id: 'john-mercer' } },
          },
        ],
      }),
    );
    await expect(
      insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'hello' }),
    ).rejects.toMatchObject({ code: 'ZOHO_USER_ATTRIBUTION_MISMATCH' });
  });

  it('invalidates a rejected access token and requires reconnect instead of retrying as John Mercer', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(refreshed('stale-access'))
      .mockResolvedValueOnce(response(401, { code: 'OAUTH_SCOPE_MISMATCH' }))
      .mockResolvedValueOnce(refreshed('fresh-access'))
      .mockResolvedValueOnce(success('note-2'));

    await expect(
      insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'one' }),
    ).rejects.toMatchObject({
      code: 'ZOHO_REAUTH_REQUIRED',
    });
    await expect(insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'two' })).resolves.toBe(
      'note-2',
    );
    expect(findTokenMock).toHaveBeenCalledTimes(2);
  });

  it('turns a row-level scope mismatch into reconnect-required, even on HTTP 200', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(
        response(200, {
          data: [{ code: 'OAUTH_SCOPE_MISMATCH', status: 'error', message: 'invalid oauth scope' }],
        }),
      );
    await expect(
      insertNoteAsUser('tenant-a', 'agent-1', { Note_Content: 'hello' }),
    ).rejects.toMatchObject({ code: 'ZOHO_REAUTH_REQUIRED' });
  });

  it('updates a record through the acting user token', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(success('lead-9'));
    await updateRecordAsUser('tenant-a', 'agent-1', 'Leads', 'lead-9', { Phone: '555' });
    const [url, init] = fetchWithTimeoutMock.mock.calls[1]!;
    expect(url).toBe('https://crm.zoho.test/crm/v8/Leads/lead-9');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ data: [{ Phone: '555', id: 'lead-9' }] });
  });

  it('patches a note through the acting user token', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(success('note-9'));
    await patchRecordAsUser('tenant-a', 'agent-1', 'Notes', 'note-9', {
      Note_Content: 'updated',
    });
    const [url, init] = fetchWithTimeoutMock.mock.calls[1]!;
    expect(url).toBe('https://crm.zoho.test/crm/v8/Notes/note-9');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      data: [{ Note_Content: 'updated', id: 'note-9' }],
    });
  });

  it('deletes a note through the acting user token without a service fallback', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(refreshed()).mockResolvedValueOnce(
      new Response(null, {
        status: 204,
      }),
    );
    await expect(
      deleteRecordAsUser('tenant-a', 'agent-1', 'Notes', 'note-9'),
    ).resolves.toBeUndefined();
    const [url, init] = fetchWithTimeoutMock.mock.calls[1]!;
    expect(url).toBe('https://crm.zoho.test/crm/v8/Notes/note-9');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('preserves DUPLICATE_DATA details for the Create Lead UI', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(refreshed()).mockResolvedValueOnce(
      response(400, {
        data: [
          {
            code: 'DUPLICATE_DATA',
            status: 'error',
            details: { id: 'existing-1' },
            message: 'duplicate',
          },
        ],
      }),
    );
    await expect(
      insertRecordAsUserDetailed('tenant-a', 'agent-1', 'Leads', { Last_Name: 'Agent' }, [
        'workflow',
      ]),
    ).resolves.toMatchObject({ code: 'DUPLICATE_DATA', id: 'existing-1' });
  });

  it('uploads note attachments with the same agent token', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(success('attachment-1'));
    await expect(
      attachFileAsUser(
        'tenant-a',
        'agent-1',
        'Notes',
        'note-1',
        'proof.txt',
        Buffer.from('proof'),
        'text/plain',
      ),
    ).resolves.toBe('attachment-1');
    const [url, init, timeout] = fetchWithTimeoutMock.mock.calls[1]!;
    expect(url).toBe('https://crm.zoho.test/crm/v8/Notes/note-1/Attachments');
    expect(init.body).toBeInstanceOf(FormData);
    expect(timeout).toBe(60_000);
  });

  it('attributes act-as changes to the real admin, not the viewed agent', () => {
    const ctx = makeContext({ userId: 'zoho:viewed-agent' });
    ctx.impersonatorUserId = 'zoho:real-admin';
    expect(zohoActorId(ctx)).toBe('real-admin');
  });
});
