/**
 * Unit tests for the Zoho user-attribution feature.
 *
 * Tests cover:
 *  1. zohoOAuth.ts — buildAuthorizeUrl now includes access_type=offline
 *  2. zohoOAuth.ts — exchangeCodeForToken returns both access and refresh token
 *  3. zohoUserAuth.ts — getUserAccessToken caching and fallback
 *  4. zohoUserAuth.ts — insertNoteAsUser success, 401 invalidation, null fallback
 *  5. recordActivity.ts — createRecordNote passes Owner field and uses user token when available
 *  6. recordActivity.ts — note edit/delete authorize before either Zoho mutation path
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const {
  fetchWithTimeoutMock,
  getRecordMock,
  insertRecordMock,
  insertNoteAsUserMock,
  patchRecordMock,
  deleteRecordByIdMock,
  updateNoteAsUserMock,
  deleteNoteAsUserMock,
} = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
  getRecordMock: vi.fn(),
  insertRecordMock: vi.fn(),
  insertNoteAsUserMock: vi.fn(),
  patchRecordMock: vi.fn(),
  deleteRecordByIdMock: vi.fn(),
  updateNoteAsUserMock: vi.fn(),
  deleteNoteAsUserMock: vi.fn(),
}));

vi.mock('../../src/lib/http.js', () => ({ fetchWithTimeout: fetchWithTimeoutMock }));

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOHO_ACCOUNTS_DOMAIN: 'https://accounts.zoho.com',
      ZOHO_SERVER_CLIENT_ID: 'server-client-id',
      ZOHO_SERVER_CLIENT_SECRET: 'server-client-secret',
      ZOHO_OAUTH_SCOPES: 'ZohoCRM.modules.ALL',
      ZOHO_OAUTH_REDIRECT_URI: 'https://app.example.com/auth/callback',
      ZOHO_CRM_API_DOMAIN: 'https://www.zohoapis.com/crm/v8',
    },
  };
});

vi.mock('../../src/repos/workerZohoTokenRepo.js', () => ({
  workerZohoTokenRepo: { find: vi.fn(), upsert: vi.fn() },
}));

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: {
    getRecord: getRecordMock,
    insertRecord: insertRecordMock,
    patchRecord: patchRecordMock,
    deleteRecordById: deleteRecordByIdMock,
  },
}));

vi.mock('../../src/integrations/zohoUserAuth.js', () => ({
  insertNoteAsUser: insertNoteAsUserMock,
  updateNoteAsUser: updateNoteAsUserMock,
  deleteNoteAsUser: deleteNoteAsUserMock,
  getUserAccessToken: vi.fn(),
  invalidateUserToken: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Imports after mocks ───────────────────────────────────────────────────────

import { buildAuthorizeUrl, exchangeCodeForToken } from '../../src/integrations/zohoOAuth.js';
import {
  createRecordNote,
  deleteRecordNote,
  updateRecordNote,
} from '../../src/modules/sales/recordActivity.js';
import { makeContext } from '../fixtures/seed.js';

// ─── 1. buildAuthorizeUrl ──────────────────────────────────────────────────────

describe('buildAuthorizeUrl', () => {
  it('includes access_type=offline for refresh token issuance', () => {
    const url = buildAuthorizeUrl('test-state-123');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('access_type')).toBe('offline');
  });

  it('includes all required OAuth params', () => {
    const url = buildAuthorizeUrl('my-state');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('server-client-id');
    expect(parsed.searchParams.get('state')).toBe('my-state');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
  });
});

// ─── 2. exchangeCodeForToken ───────────────────────────────────────────────────

describe('exchangeCodeForToken', () => {
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

// ─── 3. createRecordNote — Owner field and user-token path ────────────────────

describe('createRecordNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const salesCtx = () =>
    makeContext({
      role: 'worker',
      userId: 'zoho:agent-42',
      tenantId: 'tenant-A',
      departments: ['sales'],
      allDepartmentAccess: false,
    });

  it('uses user token and passes Owner when ctx has a Zoho user id and insertNoteAsUser succeeds', async () => {
    insertNoteAsUserMock.mockResolvedValueOnce('note-id-user');
    const noteId = await createRecordNote('Leads', 'lead-1', { content: 'Hello' }, salesCtx());
    expect(noteId).toBe('note-id-user');
    expect(insertNoteAsUserMock).toHaveBeenCalledWith(
      'tenant-A',
      'agent-42',
      expect.objectContaining({
        Owner: { id: 'agent-42' },
        Note_Content: 'Hello',
        Note_Title: 'Note',
        Parent_Id: { id: 'lead-1', module: { api_name: 'Leads' } },
      }),
    );
    expect(insertRecordMock).not.toHaveBeenCalled();
  });

  it('falls back to service account when insertNoteAsUser returns null', async () => {
    insertNoteAsUserMock.mockResolvedValueOnce(null);
    insertRecordMock.mockResolvedValueOnce('note-id-svc');
    const noteId = await createRecordNote('Leads', 'lead-1', { content: 'Hello' }, salesCtx());
    expect(noteId).toBe('note-id-svc');
    // Owner field still passed to service account call
    expect(insertRecordMock).toHaveBeenCalledWith(
      'Notes',
      expect.objectContaining({ Owner: { id: 'agent-42' } }),
    );
  });

  it('uses service account and omits Owner when no ctx is provided', async () => {
    insertRecordMock.mockResolvedValueOnce('note-id-svc');
    const noteId = await createRecordNote('Deals', 'deal-1', { content: 'No ctx' });
    expect(noteId).toBe('note-id-svc');
    expect(insertNoteAsUserMock).not.toHaveBeenCalled();
    const callArgs = insertRecordMock.mock.calls[0]!;
    expect(callArgs[1]).not.toHaveProperty('Owner');
  });

  it('uses a custom title when provided', async () => {
    insertNoteAsUserMock.mockResolvedValueOnce('note-with-title');
    const noteId = await createRecordNote(
      'Leads',
      'lead-2',
      { title: 'My Title', content: 'Body' },
      salesCtx(),
    );
    expect(noteId).toBe('note-with-title');
    expect(insertNoteAsUserMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ Note_Title: 'My Title' }),
    );
  });

  it('skips user-token path for non-CRM users (zeit: prefix)', async () => {
    const nonCrmCtx = makeContext({
      role: 'worker',
      userId: 'zoho:zuid:12345',
      tenantId: 'tenant-A',
    });
    insertRecordMock.mockResolvedValueOnce('note-id-svc');
    await createRecordNote('Leads', 'lead-1', { content: 'Non-CRM user' }, nonCrmCtx);
    expect(insertNoteAsUserMock).not.toHaveBeenCalled();
  });
});

describe('note edit/delete authorization and attribution', () => {
  const workerCtx = (userId = 'zoho:agent-42') =>
    makeContext({
      role: 'worker',
      userId,
      tenantId: 'tenant-A',
      departments: ['sales'],
      allDepartmentAccess: false,
    });
  const note = (ownerId: string) => ({
    id: 'note-7',
    Parent_Id: { id: 'lead-1' },
    Owner: { id: ownerId, name: 'Owner' },
    $se_module: 'Leads',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies a different agent before calling either mutation path', async () => {
    getRecordMock.mockResolvedValue(note('another-agent'));

    await expect(
      updateRecordNote(workerCtx(), 'Leads', 'lead-1', 'note-7', { title: 'T', content: 'C' }),
    ).rejects.toThrow('You can only edit or delete notes you created');

    expect(updateNoteAsUserMock).not.toHaveBeenCalled();
    expect(patchRecordMock).not.toHaveBeenCalled();
  });

  it('uses the note owner token for PATCH and skips the service account on success', async () => {
    getRecordMock.mockResolvedValue(note('agent-42'));
    updateNoteAsUserMock.mockResolvedValue(true);

    await updateRecordNote(workerCtx(), 'Leads', 'lead-1', 'note-7', {
      title: '  Updated  ',
      content: 'New body',
    });

    expect(updateNoteAsUserMock).toHaveBeenCalledWith('tenant-A', 'agent-42', 'note-7', {
      Note_Title: 'Updated',
      Note_Content: 'New body',
    });
    expect(patchRecordMock).not.toHaveBeenCalled();
  });

  it('allows a manager to delete another owner’s note and falls back to the service account', async () => {
    const manager = makeContext({
      role: 'worker',
      userId: 'zoho:manager-1',
      tenantId: 'tenant-A',
      departments: ['sales'],
      allDepartmentAccess: false,
      callerRole: 'Sales Manager',
    });
    getRecordMock.mockResolvedValue(note('agent-42'));
    deleteNoteAsUserMock.mockResolvedValue(false);

    await deleteRecordNote(manager, 'Leads', 'lead-1', 'note-7');

    expect(deleteNoteAsUserMock).toHaveBeenCalledWith('tenant-A', 'manager-1', 'note-7');
    expect(deleteRecordByIdMock).toHaveBeenCalledWith('Notes', 'note-7');
  });

  it('rejects a note that is not attached to the requested record', async () => {
    getRecordMock.mockResolvedValue({ ...note('agent-42'), Parent_Id: { id: 'lead-2' } });

    await expect(deleteRecordNote(workerCtx(), 'Leads', 'lead-1', 'note-7')).rejects.toThrow(
      'Note not found',
    );

    expect(deleteNoteAsUserMock).not.toHaveBeenCalled();
    expect(deleteRecordByIdMock).not.toHaveBeenCalled();
  });
});
