/**
 * Desk routes (/v1/desk) — authorization regressions plus the restored create path.
 *
 * Three things must stay closed / true:
 *  1. Header elevation: a verified session asserting x-department-access / x-all-departments
 *     must NOT gain sales access or the admin ?zoho_user_id override (session-authoritative).
 *  2. Per-ticket IDOR: comments / attachment-download on a guessable ticket id must verify the
 *     ticket's cf_crm_created_by_id against the caller (assertTicketOwned).
 *  3. Create (restored 2026-08-03): a non-admin may only file against a deal they OWN, a dealId is
 *     rejected before it can reach COQL, and an attachment lands on Desk with the CRM record as the
 *     documented fallback — the agent is never told "attached" when nothing was.
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
    pageTicketsByCreator: vi.fn(async () => ({ tickets: [], hasMore: false })),
    getTicket: vi.fn(async () => ({})),
    getTicketThreads: vi.fn(async () => []),
    getTicketThread: vi.fn(async () => ({})),
    getTicketComments: vi.fn(async () => []),
    getTicketAttachments: vi.fn(async () => []),
    postTicketComment: vi.fn(async () => ({ id: 'c_1' })),
    uploadTicketAttachment: vi.fn(async () => ({ id: 'att_1' })),
    getTicketAttachmentContent: vi.fn(async () => ({
      buffer: Buffer.from('x'),
      contentType: 'text/plain',
    })),
    createDeskTicket: vi.fn(async () => 'tk_new'),
  };
});
vi.mock('../../src/integrations/salesDataCenter.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/salesDataCenter.js')>();
  return { ...mod, fetchDealOwnerId: vi.fn(async () => null) };
});
vi.mock('../../src/integrations/zohoCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoCrm.js')>();
  // The route calls `zohoCrm.attachFileToRecord` — the module-level facade is deprecated, so stubbing
  // only that export would leave the real (network) method reachable through the instance.
  return {
    ...mod,
    zohoCrm: Object.assign(Object.create(Object.getPrototypeOf(mod.zohoCrm) as object), mod.zohoCrm, {
      attachFileToRecord: vi.fn(async () => 'crm_att_1'),
    }),
    attachFileToRecord: vi.fn(async () => 'crm_att_1'),
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
import { fetchDealOwnerId } from '../../src/integrations/salesDataCenter.js';
import { zohoCrm } from '../../src/integrations/zohoCrm.js';
import {
  createDeskTicket,
  getTicket,
  getTicketAttachmentContent,
  getTicketAttachments,
  searchTicketsByCreator,
  uploadTicketAttachment,
} from '../../src/integrations/zohoDesk.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { dispatchTouchpoint } from '../../src/modules/touchpoints/dispatcher.js';
import { clearTicketOwnerCache } from '../../src/modules/tools/deskScope.js';

const searchMock = vi.mocked(searchTicketsByCreator);
const getTicketMock = vi.mocked(getTicket);
const attachmentMock = vi.mocked(getTicketAttachmentContent);
const getAttachmentsMock = vi.mocked(getTicketAttachments);
const createTicketMock = vi.mocked(createDeskTicket);
const uploadAttachmentMock = vi.mocked(uploadTicketAttachment);
const dealOwnerMock = vi.mocked(fetchDealOwnerId);
const dispatchMock = vi.mocked(dispatchTouchpoint);
const crmAttachMock = vi.mocked(zohoCrm.attachFileToRecord);

/** Build a multipart body (fields + one optional file) the way the browser does. */
function multipart(
  fields: Record<string, string>,
  file?: { name: string; content: string; mime?: string },
): { payload: string; contentType: string } {
  const boundary = '----vitestboundary';
  let body = Object.entries(fields)
    .map(([k, v]) => `--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    .join('');
  if (file) {
    body +=
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${file.name}"\r\n` +
      `content-type: ${file.mime ?? 'text/plain'}\r\n\r\n${file.content}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { payload: body, contentType: `multipart/form-data; boundary=${boundary}` };
}

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
  createTicketMock.mockResolvedValue('tk_new');
  uploadAttachmentMock.mockResolvedValue({ id: 'att_1' } as never);
  crmAttachMock.mockResolvedValue('crm_att_1');
  dealOwnerMock.mockResolvedValue(null);
  dispatchMock.mockResolvedValue({ ok: true, data: {} } as never);
  getTicketMock.mockResolvedValue({});
});

/** Verified worker session; role/departments derive from the profile at verify. */
async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'CI Test Admin', profile },
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
    expect(res.json()).toEqual({ threads: [], comments: [], attachments: [] });
  });

  it("comments: merges in the ticket's Attachments-tab entries, flagged `mine` by creator", async () => {
    getTicketMock.mockResolvedValue(mine);
    getAttachmentsMock.mockResolvedValueOnce([
      { id: 'att_1', name: 'from-agent.pdf', creatorId: '1057080000010543217' }, // the shared Desk agent id
      { id: 'att_2', name: 'from-desk.pdf', creatorId: '999' },
    ]);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/desk/tickets/tk_777/comments',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      threads: [],
      comments: [],
      attachments: [
        { id: 'att_1', name: 'from-agent.pdf', creatorId: '1057080000010543217', mine: true },
        { id: 'att_2', name: 'from-desk.pdf', creatorId: '999', mine: false },
      ],
    });
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

describe('ticket create — deal ownership (restored Desk write path)', () => {
  const FIELDS = {
    department: 'cs',
    ticketType: 'Card Issue',
    dealId: '5550001',
    subject: 'Card not working',
    description: 'Pump declines the card.',
  };

  const post = async (
    profile: string,
    fields: Record<string, string> = FIELDS,
    file?: { name: string; content: string; mime?: string },
  ) => {
    const token = await workerToken(profile);
    const { payload, contentType } = multipart(fields, file);
    return app.inject({
      method: 'POST',
      url: '/v1/desk/tickets',
      headers: { ...bearer(token), 'content-type': contentType },
      payload,
    });
  };

  it("filing on someone else's deal → 403 and no ticket is created", async () => {
    dealOwnerMock.mockResolvedValue('999');
    const res = await post('Sales Rep');
    expect(res.statusCode).toBe(403);
    expect(createTicketMock).not.toHaveBeenCalled();
  });

  it('filing on your own deal → ticket created and mirrored into CRM', async () => {
    dealOwnerMock.mockResolvedValue('42');
    const res = await post('Sales Rep');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ticketId: 'tk_new', attached: false });
    expect(createTicketMock).toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      'tickets.create_in_crm',
      expect.objectContaining({ dealId: '5550001', deskTicketId: 'tk_new' }),
    );
  });

  it('admin skips the deal ownership lookup', async () => {
    const res = await post('Administrator');
    expect(res.statusCode).toBe(200);
    expect(dealOwnerMock).not.toHaveBeenCalled();
  });

  it('a non-numeric dealId is rejected before any CRM call', async () => {
    const res = await post('Sales Rep', { ...FIELDS, dealId: "5' or '1'='1" });
    expect(res.statusCode).toBe(400);
    expect(dealOwnerMock).not.toHaveBeenCalled();
    expect(createTicketMock).not.toHaveBeenCalled();
  });

  it('a file rides the SAME request and lands on the Desk ticket', async () => {
    dealOwnerMock.mockResolvedValue('42');
    const res = await post('Sales Rep', FIELDS, { name: 'photo.png', content: 'png-bytes', mime: 'image/png' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ attached: true });
    expect(uploadAttachmentMock).toHaveBeenCalled();
    expect(crmAttachMock).not.toHaveBeenCalled();
  });

  it('falls back to the CRM Deal when the Desk token lacks attachment scope', async () => {
    dealOwnerMock.mockResolvedValue('42');
    uploadAttachmentMock.mockRejectedValue(new Error('403 no attachment scope'));
    const res = await post('Sales Rep', FIELDS, { name: 'photo.png', content: 'png-bytes' });
    expect(res.statusCode).toBe(200);
    // Still `attached: true` — the file IS retrievable, just on the Deal. The warning says where.
    expect(res.json()).toMatchObject({ attached: true });
    expect(crmAttachMock).toHaveBeenCalledWith('Deals', '5550001', 'photo.png', expect.anything(), expect.anything());
    expect((res.json() as { warnings: string[] }).warnings.join(' ')).toContain('CRM Deals');
  });

  it('reports attached:false when BOTH Desk and CRM refuse the file', async () => {
    dealOwnerMock.mockResolvedValue('42');
    uploadAttachmentMock.mockRejectedValue(new Error('desk down'));
    crmAttachMock.mockRejectedValue(new Error('crm down'));
    const res = await post('Sales Rep', FIELDS, { name: 'photo.png', content: 'png-bytes' });
    // The TICKET still exists, so this is a 200 with attached:false — not a failed create. The wizard
    // tells the agent the file did not attach rather than that the ticket did not file.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ticketId: 'tk_new', attached: false });
  });
});

describe('escalation create — Deluge + attachment', () => {
  const FIELDS = { subject: 'Client dispute', description: 'Needs a manager.', reason: 'Question' };

  const post = async (file?: { name: string; content: string; mime?: string }) => {
    const token = await workerToken('Sales Rep');
    const { payload, contentType } = multipart(FIELDS, file);
    return app.inject({
      method: 'POST',
      url: '/v1/desk/escalations',
      headers: { ...bearer(token), 'content-type': contentType },
      payload,
    });
  };

  it('creates via the Deluge and returns both ids', async () => {
    dispatchMock.mockResolvedValue({ ok: true, data: { ticketId: 'tk_e1', escalationId: 'esc_1' } } as never);
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ticketId: 'tk_e1', escalationId: 'esc_1', attached: false });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      'tickets.create_escalation',
      expect.objectContaining({ escalationReason: 'Question', questionSubject: 'Client dispute' }),
    );
  });

  it('attaches on Desk when a file is sent', async () => {
    dispatchMock.mockResolvedValue({ ok: true, data: { ticketId: 'tk_e1', escalationId: 'esc_1' } } as never);
    const res = await post({ name: 'proof.pdf', content: 'pdf', mime: 'application/pdf' });
    expect(res.json()).toMatchObject({ attached: true });
    expect(uploadAttachmentMock).toHaveBeenCalled();
  });

  it('falls back to the CRM Escalation_Request record', async () => {
    dispatchMock.mockResolvedValue({ ok: true, data: { ticketId: 'tk_e1', escalationId: 'esc_1' } } as never);
    uploadAttachmentMock.mockRejectedValue(new Error('403 no attachment scope'));
    const res = await post({ name: 'proof.pdf', content: 'pdf' });
    expect(res.json()).toMatchObject({ attached: true });
    expect(crmAttachMock).toHaveBeenCalledWith(
      'Escalation_Request',
      'esc_1',
      'proof.pdf',
      expect.anything(),
      expect.anything(),
    );
  });

  it('502s rather than reporting success when the Deluge returns no ids', async () => {
    dispatchMock.mockResolvedValue({ ok: true, data: { message: 'Reason not recognised' } } as never);
    const res = await post();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'ZOHO_ESCALATION_ERROR' } });
  });
});
