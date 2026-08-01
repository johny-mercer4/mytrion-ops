/**
 * TicketConsole — the list/chat shell.
 *
 * The focus path is the one worth pinning: "Create → opening it now" navigates with a ticket id, and before
 * this was wired the agent landed on the list with nothing selected, having to hunt for the ticket they had
 * just filed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { TicketDto } from '@/api/comms';

const api = vi.hoisted(() => ({
  listTickets: vi.fn(),
  getTicket: vi.fn(),
  listThreadMessages: vi.fn(),
  listThreadAttachments: vi.fn(),
  postThreadMessage: vi.fn(),
  uploadThreadAttachment: vi.fn(),
  markThreadRead: vi.fn(),
  getAttachmentLink: vi.fn(),
}));
vi.mock('@/api/comms', () => api);

// The socket is a live connection; the console's own behaviour is what is under test here.
vi.mock('./useCommsSocket', () => ({
  useCommsSocket: () => ({ status: 'live', commsTopic: 'comms:user:42' }),
}));

import { TicketConsole } from './TicketConsole';

function ticket(over: Partial<TicketDto> = {}): TicketDto {
  return {
    id: 'mtk_1',
    threadId: 'mth_1',
    number: 'T-000001',
    kind: 'ticket',
    subject: 'Card activation',
    status: 'open',
    substatus: null,
    priority: 'medium',
    typeCode: 'C-1',
    typeLabel: 'Card Activation',
    targetDepartment: 'customer-service',
    sourceDepartment: 'sales',
    sourceMytrion: 'sales',
    requester: { zohoUserId: '42', carrierId: null, name: 'Ali' },
    assignee: null,
    client: {
      carrierId: '5001',
      companyName: 'ACME Trucking',
      applicationId: null,
      crmDealId: '123',
      cardLast4: null,
    },
    sla: {
      hours: 24,
      dueAt: null,
      firstResponseDueAt: null,
      firstResponseAt: null,
      breachedAt: null,
      overdue: false,
    },
    escalation: null,
    channel: 'web',
    messageCount: 1,
    lastMessageAt: '2026-08-02T10:00:00.000Z',
    lastMessageSeq: 1,
    lastMessagePreview: 'Please activate',
    unread: 0,
    version: 1,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listTickets.mockResolvedValue({ tickets: [ticket()], hasMore: false, nextCursor: null });
  api.listThreadMessages.mockResolvedValue({
    thread: {
      id: 'mth_1',
      kind: 'ticket',
      visibility: 'department',
      department: 'customer-service',
      subject: 'Card activation',
      state: 'open',
      messageCount: 1,
      lastMessageSeq: 1,
    },
    messages: [],
    participants: [],
  });
  api.listThreadAttachments.mockResolvedValue([]);
  api.markThreadRead.mockResolvedValue({ seq: 1 });
});

describe('TicketConsole — focus after Create', () => {
  it('auto-opens the ticket it was pointed at, without a fetch when it is already listed', async () => {
    const consumed = vi.fn();
    render(<TicketConsole mode="requester" focusTicketId="mtk_1" onFocusConsumed={consumed} />);

    // The chat pane renders the subject in its header once something is selected.
    await waitFor(() => expect(api.listThreadMessages).toHaveBeenCalledWith('mth_1', expect.anything()));
    expect(api.getTicket).not.toHaveBeenCalled();
    await waitFor(() => expect(consumed).toHaveBeenCalled());
  });

  it('FETCHES the ticket when the current filter does not contain it', async () => {
    // A just-created ticket normally lands in the default "Open" list — but a resolved one reached from a
    // link would not, and landing on an empty pane is the bug this closes.
    api.listTickets.mockResolvedValue({ tickets: [], hasMore: false, nextCursor: null });
    api.getTicket.mockResolvedValue(ticket({ id: 'mtk_9', threadId: 'mth_9', number: 'T-000009' }));

    render(<TicketConsole mode="requester" focusTicketId="mtk_9" />);

    await waitFor(() => expect(api.getTicket).toHaveBeenCalledWith('mtk_9'));
    // Prepended to the list AND opened, so the number renders twice: once in the row, once in the chat
    // header. Both are wanted — the agent sees it in context, not only in the pane.
    const shown = await screen.findAllByText('T-000009');
    expect(shown.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(api.listThreadMessages).toHaveBeenCalledWith('mth_9', expect.anything()));
  });

  it('does not blow up when the focused ticket is gone', async () => {
    api.listTickets.mockResolvedValue({ tickets: [], hasMore: false, nextCursor: null });
    api.getTicket.mockRejectedValue(new Error('404'));
    const consumed = vi.fn();

    render(<TicketConsole mode="requester" focusTicketId="mtk_gone" onFocusConsumed={consumed} />);

    // Consumed regardless, so a failed focus cannot loop forever retrying.
    await waitFor(() => expect(consumed).toHaveBeenCalled());
    expect(screen.getByText(/Pick a ticket/i)).toBeInTheDocument();
  });

  it('selects nothing when no focus is given', async () => {
    render(<TicketConsole mode="requester" />);
    expect(await screen.findByText('Card activation')).toBeInTheDocument();
    expect(screen.getByText(/Pick a ticket/i)).toBeInTheDocument();
    expect(api.listThreadMessages).not.toHaveBeenCalled();
  });
});

describe('TicketConsole — queue vs requester', () => {
  it('a queue console scopes the list to its own department', async () => {
    render(<TicketConsole mode="queue" department="billing" />);
    await waitFor(() =>
      expect(api.listTickets).toHaveBeenCalledWith(expect.objectContaining({ department: 'billing' })),
    );
  });

  it('a requester console does NOT filter by department — it is "what I raised"', async () => {
    render(<TicketConsole mode="requester" />);
    await waitFor(() => expect(api.listTickets).toHaveBeenCalled());
    const params = api.listTickets.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.department).toBeUndefined();
  });

  it('defaults to the open statuses rather than the whole history', async () => {
    render(<TicketConsole mode="queue" department="billing" />);
    await waitFor(() => expect(api.listTickets).toHaveBeenCalled());
    const params = api.listTickets.mock.calls[0]?.[0] as { status?: string };
    expect(params.status).toContain('open');
    expect(params.status).not.toContain('closed');
  });
});
