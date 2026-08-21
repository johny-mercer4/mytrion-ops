/**
 * Unit tests for the Zoho user-attribution feature.
 *
 * Tests cover:
 *  1. zohoOAuth.ts — buildAuthorizeUrl now includes access_type=offline
 *  2. zohoOAuth.ts — exchangeCodeForToken returns both access and refresh token
 *  3. recordActivity.ts — createRecordNote always uses the real actor and never falls back
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const {
  fetchWithTimeoutMock,
  insertNoteAsUserMock,
  zohoActorIdMock,
  getRelatedRecordsMock,
  getRecordMock,
  patchRecordAsUserMock,
  deleteRecordAsUserMock,
} =
  vi.hoisted(() => ({
    fetchWithTimeoutMock: vi.fn(),
    insertNoteAsUserMock: vi.fn(),
    zohoActorIdMock: vi.fn(),
    getRelatedRecordsMock: vi.fn(),
    getRecordMock: vi.fn(),
    patchRecordAsUserMock: vi.fn(),
    deleteRecordAsUserMock: vi.fn(),
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
      ZOHO_OAUTH_SCOPES:
        'ZohoCRM.users.READ,AaaServer.profile.READ,ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.UPDATE,ZohoCRM.modules.deals.UPDATE,ZohoCRM.modules.notes.READ,ZohoCRM.modules.notes.CREATE,ZohoCRM.modules.notes.UPDATE,ZohoCRM.modules.notes.DELETE,ZohoCRM.modules.attachments.CREATE',
      ZOHO_OAUTH_REDIRECT_URI: 'https://app.example.com/auth/callback',
      ZOHO_CRM_API_DOMAIN: 'https://www.zohoapis.com/crm/v8',
    },
  };
});

vi.mock('../../src/repos/workerZohoTokenRepo.js', () => ({
  workerZohoTokenRepo: { find: vi.fn(), upsert: vi.fn() },
}));

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: { getRelatedRecords: getRelatedRecordsMock, getRecord: getRecordMock },
}));

vi.mock('../../src/integrations/zohoUserAuth.js', () => ({
  insertNoteAsUser: insertNoteAsUserMock,
  patchRecordAsUser: patchRecordAsUserMock,
  deleteRecordAsUser: deleteRecordAsUserMock,
  zohoActorId: zohoActorIdMock,
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Imports after mocks ───────────────────────────────────────────────────────

import { buildAuthorizeUrl, exchangeCodeForToken } from '../../src/integrations/zohoOAuth.js';
import { DEFAULT_ZOHO_OAUTH_SCOPES } from '../../src/config/zohoOAuthScopes.js';
import {
  createRecordNote,
  deleteRecordNote,
  fetchRecordNotes,
  updateRecordNote,
} from '../../src/modules/sales/recordActivity.js';
import { makeContext } from '../fixtures/seed.js';

// ─── 1. buildAuthorizeUrl ──────────────────────────────────────────────────────

describe('DEFAULT_ZOHO_OAUTH_SCOPES', () => {
  it('covers Sales writes without granting modules.ALL', () => {
    const scopes = DEFAULT_ZOHO_OAUTH_SCOPES.split(',');
    expect(scopes).toEqual(
      expect.arrayContaining([
        'ZohoCRM.modules.leads.CREATE',
        'ZohoCRM.modules.leads.UPDATE',
        'ZohoCRM.modules.deals.UPDATE',
        'ZohoCRM.modules.notes.CREATE',
        'ZohoCRM.modules.notes.UPDATE',
        'ZohoCRM.modules.notes.DELETE',
        'ZohoCRM.modules.attachments.CREATE',
      ]),
    );
    expect(scopes).not.toContain('ZohoCRM.modules.ALL');
  });
});

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
    expect(parsed.searchParams.get('scope')).toContain('ZohoCRM.modules.notes.CREATE');
    expect(parsed.searchParams.get('scope')).toContain('ZohoCRM.modules.notes.UPDATE');
    expect(parsed.searchParams.get('scope')).toContain('ZohoCRM.modules.notes.DELETE');
    expect(parsed.searchParams.get('scope')).toContain('ZohoCRM.modules.leads.UPDATE');
    expect(parsed.searchParams.get('scope')).toContain('ZohoCRM.modules.attachments.CREATE');
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
    zohoActorIdMock.mockImplementation((ctx: { impersonatorUserId?: string; userId: string }) =>
      String(ctx.impersonatorUserId ?? ctx.userId).replace(/^zoho:/, ''),
    );
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
  });

  it('propagates user-token failures instead of writing through the service account', async () => {
    insertNoteAsUserMock.mockRejectedValueOnce(new Error('reconnect required'));
    await expect(
      createRecordNote('Leads', 'lead-1', { content: 'Hello' }, salesCtx()),
    ).rejects.toThrow('reconnect required');
    expect(insertNoteAsUserMock).toHaveBeenCalledOnce();
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

  it('uses the real admin token behind an act-as session', async () => {
    insertNoteAsUserMock.mockResolvedValueOnce('admin-note');
    const ctx = makeContext({
      role: 'worker',
      userId: 'zoho:target-agent',
      tenantId: 'tenant-A',
    });
    ctx.impersonatorUserId = 'zoho:real-admin';
    await createRecordNote('Deals', 'deal-1', { content: 'Admin edit' }, ctx);
    expect(insertNoteAsUserMock).toHaveBeenCalledWith(
      'tenant-A',
      'real-admin',
      expect.objectContaining({ Owner: { id: 'real-admin' } }),
    );
  });

  it('shows Created_By before mutable Owner in the note activity response', async () => {
    getRelatedRecordsMock.mockResolvedValueOnce([
      {
        id: 'note-1',
        Note_Content: 'Hello',
        Created_By: { name: 'Real Agent' },
        Owner: { name: 'John Mercer' },
      },
    ]);
    const notes = await fetchRecordNotes('Leads', 'lead-1', salesCtx());
    expect(notes[0]?.owner).toBe('Real Agent');
  });

  it('allows the creator to manage a note and uses the creator identity for the UI flag', async () => {
    getRelatedRecordsMock.mockResolvedValueOnce([
      {
        id: 'note-1',
        Created_By: { id: 'agent-42', name: 'Agent 42' },
        Owner: { id: 'john-mercer', name: 'John Mercer' },
      },
    ]);
    const notes = await fetchRecordNotes('Leads', 'lead-1', salesCtx());
    expect(notes[0]).toMatchObject({ owner: 'Agent 42', canManage: true });
  });

  it('rejects editing another agent note before any Zoho mutation', async () => {
    getRecordMock.mockResolvedValueOnce({
      id: 'note-1',
      Parent_Id: { id: 'lead-1' },
      $se_module: 'Leads',
      Created_By: { id: 'other-agent' },
    });
    await expect(
      updateRecordNote(salesCtx(), 'Leads', 'lead-1', 'note-1', {
        title: 'No',
        content: 'Denied',
      }),
    ).rejects.toThrow('You can only edit or delete notes you created');
    expect(patchRecordAsUserMock).not.toHaveBeenCalled();
  });

  it('uses the real admin token to delete during an authorized act-as session', async () => {
    const ctx = salesCtx();
    ctx.impersonatorUserId = 'zoho:real-admin';
    getRecordMock.mockResolvedValueOnce({
      id: 'note-1',
      Parent_Id: { id: 'deal-1' },
      $se_module: 'Deals',
      Created_By: { id: 'agent-42' },
    });
    await deleteRecordNote(ctx, 'Deals', 'deal-1', 'note-1');
    expect(deleteRecordAsUserMock).toHaveBeenCalledWith(
      'tenant-A',
      'real-admin',
      'Notes',
      'note-1',
    );
  });
});
