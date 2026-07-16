/**
 * Desk routes (/v1/desk) — authorization regressions. Two attacks must stay closed:
 *  1. Header elevation: a verified session asserting x-department-access / x-all-departments
 *     must NOT gain sales access or the admin ?zoho_user_id override (session-authoritative).
 *  2. Per-ticket IDOR: comments / reply / attachment-download on a guessable ticket id must
 *     verify the ticket's cf_crm_created_by_id against the caller (assertTicketOwned).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/integrations/zohoDesk.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoDesk.js')>();
  return {
    ...mod,
    searchTicketsByCreator: vi.fn(async () => []),
    listTicketsByCreator: vi.fn(async () => []),
    getTicket: vi.fn(async () => ({})),
    getTicketThreads: vi.fn(async () => []),
    getTicketThread: vi.fn(async () => ({})),
    getTicketComments: vi.fn(async () => []),
    postTicketComment: vi.fn(async () => ({ id: 'c_1' })),
    uploadDeskFile: vi.fn(async () => 'up_1'),
    getTicketAttachmentContent: vi.fn(async () => ({
      buffer: Buffer.from('x'),
      contentType: 'text/plain',
    })),
    createDeskTicket: vi.fn(async () => 'tk_new'),
  };
});
vi.mock('../../src/modules/touchpoints/dispatcher.js', () => ({
  dispatchTouchpoint: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  getTicket,
  getTicketAttachmentContent,
  postTicketComment,
  searchTicketsByCreator,
} from '../../src/integrations/zohoDesk.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { clearTicketOwnerCache } from '../../src/modules/tools/deskScope.js';

const searchMock = vi.mocked(searchTicketsByCreator);
const getTicketMock = vi.mocked(getTicket);
const postCommentMock = vi.mocked(postTicketComment);
const attachmentMock = vi.mocked(getTicketAttachmentContent);

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
  clearTicketOwnerCache();
  searchMock.mockResolvedValue([]);
  getTicketMock.mockResolvedValue({});
});

/** Verified worker session; role/departments derive from the profile at verify. */
async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('ticket list — header elevation regression', () => {
  it('a non-sales worker asserting x-department-access: sales is refused', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
    });
    expect(res.statusCode).toBe(403);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('x-all-departments + ?zoho_user_id never reaches the search with the victim id', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets?zoho_user_id=999',
      headers: { ...bearer(token), 'x-all-departments': 'true' },
    });
    // The sales rep still lists (their profile grants sales) but scoped to THEMSELVES —
    // the header-forged all-department override of ?zoho_user_id is gone.
    expect(res.statusCode).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('42', expect.anything());
    expect(searchMock).not.toHaveBeenCalledWith('999', expect.anything());
  });

  it('a sales-profile worker lists with NO headers, scoped to their own id', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({ method: 'GET', url: '/v1/desk/tickets', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('42', expect.anything());
  });

  it('an admin may still target another agent via ?zoho_user_id', async () => {
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets?zoho_user_id=999',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('999', expect.anything());
  });
});

describe('per-ticket routes — IDOR regression', () => {
  const someoneElses = { cf: { cf_crm_created_by_id: '999' } };
  const mine = { cf: { cf_crm_created_by_id: '42' } };

  it("comments: someone else's ticket → 403", async () => {
    getTicketMock.mockResolvedValue(someoneElses);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_777/comments',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('comments: own ticket → 200', async () => {
    getTicketMock.mockResolvedValue(mine);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_777/comments',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ threads: [], comments: [] });
  });

  it("reply: someone else's ticket → 403 and NO comment is posted", async () => {
    getTicketMock.mockResolvedValue(someoneElses);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/desk/tickets/tk_777/reply',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: { content: 'hijacked reply' },
    });
    expect(res.statusCode).toBe(403);
    expect(postCommentMock).not.toHaveBeenCalled();
  });

  it('reply: own ticket → 200 and the comment posts', async () => {
    getTicketMock.mockResolvedValue(mine);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/desk/tickets/tk_777/reply',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: { content: 'legit reply' },
    });
    expect(res.statusCode).toBe(200);
    expect(postCommentMock).toHaveBeenCalledWith('tk_777', 'legit reply', true, []);
  });

  it("attachment download: someone else's ticket → 403, no Desk fetch", async () => {
    getTicketMock.mockResolvedValue(someoneElses);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_777/attachments/att_1/content',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
    expect(attachmentMock).not.toHaveBeenCalled();
  });

  it('admin bypasses the ownership check', async () => {
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_777/comments',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(getTicketMock).not.toHaveBeenCalled();
  });

  it('unknown ticket id → 404', async () => {
    getTicketMock.mockRejectedValue(new Error('[zoho-desk] GET /tickets/tk_nope HTTP 404: {}'));
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_nope/comments',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('a ticket with no creator stamp is denied to non-admins (fail closed)', async () => {
    getTicketMock.mockResolvedValue({ cf: {} });
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_old/comments',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('ownership result is cached — second read of the same ticket skips the Desk GET', async () => {
    getTicketMock.mockResolvedValue(mine);
    const token = await workerToken('Sales Rep');
    await app.inject({ method: 'GET', url: '/v1/desk/tickets/tk_777/comments', headers: bearer(token) });
    await app.inject({ method: 'GET', url: '/v1/desk/tickets/tk_777/comments', headers: bearer(token) });
    expect(getTicketMock).toHaveBeenCalledTimes(1);
  });
});
