/**
 * Unit tests for Zoho user-attribution (per-user Notes create).
 *
 * Pins:
 *  1. Default worker OAuth scopes include Notes.CREATE (not modules.ALL)
 *  2. buildAuthorizeUrl / exchangeCodeForToken contract
 *  3. insertNoteAsUser — success, 401 retry-once, fail-closed errors (no null)
 *  4. createRecordNote — user path required when Zoho user present; no service fallback
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithTimeoutMock, insertRecordMock, findTokenMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
  insertRecordMock: vi.fn(),
  findTokenMock: vi.fn(),
}));

vi.mock('../../src/lib/http.js', () => ({ fetchWithTimeout: fetchWithTimeoutMock }));

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  const { DEFAULT_ZOHO_OAUTH_SCOPES } = await import('../../src/config/zohoOAuthScopes.js');
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOHO_ACCOUNTS_DOMAIN: 'https://accounts.zoho.com',
      ZOHO_SERVER_CLIENT_ID: 'server-client-id',
      ZOHO_SERVER_CLIENT_SECRET: 'server-client-secret',
      // Use the real default — never ZohoCRM.modules.ALL (that hid the Notes.CREATE gap).
      ZOHO_OAUTH_SCOPES: DEFAULT_ZOHO_OAUTH_SCOPES,
      ZOHO_OAUTH_REDIRECT_URI: 'https://app.example.com/auth/callback',
      ZOHO_CRM_API_DOMAIN: 'https://www.zohoapis.com/crm/v8',
    },
  };
});

vi.mock('../../src/repos/workerZohoTokenRepo.js', () => ({
  workerZohoTokenRepo: { find: findTokenMock, upsert: vi.fn() },
}));

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: { insertRecord: insertRecordMock },
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DEFAULT_ZOHO_OAUTH_SCOPES } from '../../src/config/zohoOAuthScopes.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../../src/integrations/zohoOAuth.js';
import {
  getUserAccessToken,
  insertNoteAsUser,
  invalidateUserToken,
} from '../../src/integrations/zohoUserAuth.js';
import { createRecordNote } from '../../src/modules/sales/recordActivity.js';
import { AppError } from '../../src/lib/errors.js';
import { makeContext } from '../fixtures/seed.js';

describe('DEFAULT_ZOHO_OAUTH_SCOPES', () => {
  it('includes Notes.CREATE and excludes modules.ALL (regression for silent John Mercer notes)', () => {
    const scopes = DEFAULT_ZOHO_OAUTH_SCOPES.split(',').map((s) => s.trim());
    expect(scopes).toContain('ZohoCRM.modules.notes.CREATE');
    expect(scopes).toContain('ZohoCRM.users.READ');
    expect(scopes).toContain('AaaServer.profile.READ');
    expect(scopes).not.toContain('ZohoCRM.modules.ALL');
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes access_type=offline and prompt=consent for refresh token issuance', () => {
    const url = buildAuthorizeUrl('test-state-123');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('requests the real default scopes including Notes.CREATE', () => {
    const url = buildAuthorizeUrl('my-state');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe(DEFAULT_ZOHO_OAUTH_SCOPES);
    expect(parsed.searchParams.get('scope')).toContain('ZohoCRM.modules.notes.CREATE');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('server-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
  });
});

describe('exchangeCodeForToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns both access_token and refresh_token when Zoho provides them', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'acc-123', refresh_token: 'ref-456' }),
    });
    const result = await exchangeCodeForToken('auth-code');
    expect(result.accessToken).toBe('acc-123');
    expect(result.refreshToken).toBe('ref-456');
  });

  it('returns null refreshToken when Zoho omits it (pre-existing grant)', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'acc-only' }),
    });
    const result = await exchangeCodeForToken('auth-code');
    expect(result.accessToken).toBe('acc-only');
    expect(result.refreshToken).toBeNull();
  });

  it('throws AuthError when Zoho returns an error', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_code' }),
    });
    await expect(exchangeCodeForToken('bad-code')).rejects.toThrow('invalid_code');
  });
});

describe('insertNoteAsUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateUserToken('tenant-A', 'agent-42');
  });

  function refreshOk() {
    findTokenMock.mockResolvedValue('refresh-tok');
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'user-acc', expires_in: 3600 }),
    });
  }

  it('returns the note id when Zoho reports success attributed to the worker', async () => {
    refreshOk();
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        data: [
          {
            status: 'success',
            details: {
              id: 'note-99',
              Created_By: { id: 'agent-42', name: 'Agent' },
            },
          },
        ],
      }),
    });
    await expect(
      insertNoteAsUser('tenant-A', 'agent-42', { Note_Content: 'Hi' }),
    ).resolves.toBe('note-99');
  });

  it('throws ZOHO_USER_REAUTH_REQUIRED when no refresh token is stored', async () => {
    findTokenMock.mockResolvedValue(null);
    await expect(insertNoteAsUser('tenant-A', 'agent-42', { Note_Content: 'Hi' })).rejects.toMatchObject(
      {
        code: 'ZOHO_USER_REAUTH_REQUIRED',
        statusCode: 401,
      },
    );
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
  });

  it('retries once on 401 then succeeds with a fresh token', async () => {
    findTokenMock.mockResolvedValue('refresh-tok');
    // 1) initial refresh  2) Notes POST 401  3) second refresh  4) Notes POST success
    fetchWithTimeoutMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'stale-acc', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ code: 'INVALID_TOKEN' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fresh-acc', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          data: [{ status: 'success', details: { id: 'note-retry', Created_By: { id: 'agent-42' } } }],
        }),
      });

    await expect(
      insertNoteAsUser('tenant-A', 'agent-42', { Note_Content: 'Hi' }),
    ).resolves.toBe('note-retry');
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(4);
  });

  it('throws ZOHO_USER_SCOPE_MISMATCH after a 401 OAUTH_SCOPE_MISMATCH (no service fallback)', async () => {
    findTokenMock.mockResolvedValue('refresh-tok');
    fetchWithTimeoutMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'user-acc', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ code: 'OAUTH_SCOPE_MISMATCH', message: 'invalid oauth scope' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'user-acc-2', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ code: 'OAUTH_SCOPE_MISMATCH', message: 'invalid oauth scope' }),
      });

    await expect(insertNoteAsUser('tenant-A', 'agent-42', { Note_Content: 'Hi' })).rejects.toMatchObject(
      {
        code: 'ZOHO_USER_SCOPE_MISMATCH',
        statusCode: 403,
      },
    );
  });

  it('throws ZOHO_USER_NO_PERMISSION on Notes NO_PERMISSION without falling back', async () => {
    refreshOk();
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: 'error', code: 'NO_PERMISSION', message: 'permission denied' }],
      }),
    });
    await expect(insertNoteAsUser('tenant-A', 'agent-42', { Note_Content: 'Hi' })).rejects.toMatchObject(
      {
        code: 'ZOHO_USER_NO_PERMISSION',
        statusCode: 403,
      },
    );
  });

  it('throws ZOHO_USER_ATTRIBUTION_MISMATCH when Created_By is not the worker', async () => {
    refreshOk();
    fetchWithTimeoutMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        data: [
          {
            status: 'success',
            details: {
              id: 'note-wrong',
              Created_By: { id: 'john-mercer', name: 'John Mercer' },
            },
          },
        ],
      }),
    });
    await expect(insertNoteAsUser('tenant-A', 'agent-42', { Note_Content: 'Hi' })).rejects.toMatchObject(
      {
        code: 'ZOHO_USER_ATTRIBUTION_MISMATCH',
      },
    );
  });
});

describe('createRecordNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateUserToken('tenant-A', 'agent-42');
  });

  const salesCtx = () =>
    makeContext({
      role: 'worker',
      userId: 'zoho:agent-42',
      tenantId: 'tenant-A',
      departments: ['sales'],
      allDepartmentAccess: false,
    });

  it('uses the user token path and does not call the service account on success', async () => {
    findTokenMock.mockResolvedValue('refresh-tok');
    fetchWithTimeoutMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'user-acc', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          data: [
            {
              status: 'success',
              details: { id: 'note-id-user', Created_By: { id: 'agent-42' } },
            },
          ],
        }),
      });

    const noteId = await createRecordNote('Leads', 'lead-1', { content: 'Hello' }, salesCtx());
    expect(noteId).toBe('note-id-user');
    expect(insertRecordMock).not.toHaveBeenCalled();
    const notePost = fetchWithTimeoutMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && String(c[0]).endsWith('/Notes'),
    );
    expect(notePost?.[1]?.body).toContain('"Owner":{"id":"agent-42"}');
  });

  it('does not fall back to the service account when the user token path fails', async () => {
    findTokenMock.mockResolvedValue(null);
    await expect(
      createRecordNote('Leads', 'lead-1', { content: 'Hello' }, salesCtx()),
    ).rejects.toBeInstanceOf(AppError);
    expect(insertRecordMock).not.toHaveBeenCalled();
  });

  it('uses the service account and omits Owner when no ctx is provided', async () => {
    insertRecordMock.mockResolvedValueOnce('note-id-svc');
    const noteId = await createRecordNote('Deals', 'deal-1', { content: 'No ctx' });
    expect(noteId).toBe('note-id-svc');
    expect(findTokenMock).not.toHaveBeenCalled();
    const callArgs = insertRecordMock.mock.calls[0]!;
    expect(callArgs[1]).not.toHaveProperty('Owner');
  });

  it('skips user-token path for non-CRM users (zuid: prefix)', async () => {
    const nonCrmCtx = makeContext({
      role: 'worker',
      userId: 'zoho:zuid:12345',
      tenantId: 'tenant-A',
    });
    insertRecordMock.mockResolvedValueOnce('note-id-svc');
    await createRecordNote('Leads', 'lead-1', { content: 'Non-CRM user' }, nonCrmCtx);
    expect(findTokenMock).not.toHaveBeenCalled();
  });

  it('getUserAccessToken returns null when no stored refresh token', async () => {
    findTokenMock.mockResolvedValue(null);
    await expect(getUserAccessToken('tenant-A', 'missing')).resolves.toBeNull();
  });
});
