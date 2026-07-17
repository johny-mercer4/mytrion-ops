import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../src/integrations/zohoAuth.js', () => ({
  authHeaders: async () => ({ Authorization: 'Zoho-oauthtoken test', orgId: '123' }),
  baseUrl: () => 'https://desk.zoho.com/api/v1',
  invalidateZohoToken: () => {},
}));
vi.stubGlobal('fetch', fetchMock);

import {
  getTicketAttachments,
  listDepartments,
  listTickets,
  uploadTicketAttachment,
} from '../../src/integrations/zohoDesk.js';
import { zohoDeskSearchTicketsTool } from '../../src/modules/tools/definitions/zoho_desk_search_tickets.js';
import { makeContext } from '../fixtures/seed.js';

function deskResponse(data: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('zohoDesk.listTickets', () => {
  it('lists recent tickets (newest first) and trims to a summary', async () => {
    fetchMock.mockResolvedValue(
      deskResponse([
        {
          id: '101',
          ticketNumber: '5',
          subject: 'Card declined',
          status: 'Open',
          priority: 'High',
          departmentId: '10',
          createdTime: '2026-06-01T10:00:00Z',
          extraNoiseField: 'dropped',
        },
      ]),
    );
    const out = await listTickets();

    expect(out).toEqual([
      {
        id: '101',
        ticketNumber: '5',
        subject: 'Card declined',
        status: 'Open',
        priority: 'High',
        departmentId: '10',
        createdTime: '2026-06-01T10:00:00Z',
      },
    ]);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/api/v1/tickets');
    expect(url.searchParams.get('from')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('sortBy')).toBe('-createdTime');
    expect(url.searchParams.get('status')).toBeNull();
  });

  it('passes status + departmentId filters and clamps the limit', async () => {
    fetchMock.mockResolvedValue(deskResponse([]));
    await listTickets({ status: 'Open', departmentId: '77', limit: 500, sortBy: 'dueDate' });
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get('status')).toBe('Open');
    expect(url.searchParams.get('departmentId')).toBe('77');
    expect(url.searchParams.get('limit')).toBe('99'); // clamped to Desk's ticket-list cap
    expect(url.searchParams.get('sortBy')).toBe('dueDate');
  });

  it('treats HTTP 204 as no tickets', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 204, text: async () => '' });
    expect(await listTickets()).toEqual([]);
  });

  it('throws on an HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'INVALID_OAUTH' });
    await expect(listTickets()).rejects.toThrow(/HTTP 401/);
  });
});

describe('zohoDesk.listDepartments', () => {
  it('returns id/name/isEnabled', async () => {
    fetchMock.mockResolvedValue(deskResponse([{ id: '10', name: 'Support', isEnabled: true, junk: 1 }]));
    expect(await listDepartments()).toEqual([{ id: '10', name: 'Support', isEnabled: true }]);
  });

  it('coerces id and drops wrongly-typed fields', async () => {
    // isEnabled as a string (not boolean) is dropped; numeric id is coerced to string.
    fetchMock.mockResolvedValue(deskResponse([{ id: 10, isEnabled: 'true' }]));
    expect(await listDepartments()).toEqual([{ id: '10' }]);
  });

  it('caps the departments limit at 200', async () => {
    fetchMock.mockResolvedValue(deskResponse([]));
    await listDepartments(999);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get('limit')).toBe('200');
  });
});

describe('zohoDesk.getTicketAttachments', () => {
  it("lists a ticket's Attachments-tab entries (not comment/thread attachments)", async () => {
    fetchMock.mockResolvedValue(
      deskResponse([
        { id: 'att_1', name: 'invoice.pdf', size: 2048, creatorId: '55', createdTime: '2026-07-01T00:00:00Z' },
      ]),
    );
    const out = await getTicketAttachments('tk_1');
    expect(out).toEqual([
      { id: 'att_1', name: 'invoice.pdf', size: 2048, creatorId: '55', createdTime: '2026-07-01T00:00:00Z' },
    ]);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/api/v1/tickets/tk_1/attachments');
  });
});

describe('zohoDesk.uploadTicketAttachment', () => {
  it('uploads straight to the ticket (POST /tickets/{id}/attachments), not a comment', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'att_9' }) });
    const out = await uploadTicketAttachment('tk_1', Buffer.from('hi'), 'note.txt', 'text/plain', true);
    expect(out).toEqual({ id: 'att_9' });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v1/tickets/tk_1/attachments');
    expect(url.searchParams.get('isPublic')).toBe('true');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe('zoho_desk.search_tickets tool', () => {
  it('returns { count, tickets } from the handler', async () => {
    fetchMock.mockResolvedValue(deskResponse([{ id: '1', subject: 'Hi' }]));
    const result = await zohoDeskSearchTicketsTool.handler({ limit: 5 }, makeContext({ role: 'admin' }));
    expect(result).toEqual({ count: 1, tickets: [{ id: '1', subject: 'Hi' }] });
  });
});
