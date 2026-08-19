/**
 * DeskTicketActions — the ticket lifecycle in the conversation header.
 *
 * Pins the status moves offered per state, that a transition carries the ticket's version (so a stale
 * decision would 409), and that History loads the append-only activity trail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TicketDto, TicketEventDto } from '@/api/comms';

const api = vi.hoisted(() => ({
  setTicketStatus: vi.fn(),
  listTicketEvents: vi.fn(),
}));
vi.mock('@/api/comms', () => api);

import { DeskTicketActions } from './DeskTicketActions';

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
    sourceMytrion: 'desk',
    requester: { zohoUserId: '42', carrierId: null, name: 'Ali' },
    assignee: null,
    client: null,
    sla: { hours: 24, dueAt: null, firstResponseDueAt: null, firstResponseAt: null, breachedAt: null, overdue: false },
    escalation: null,
    channel: 'web',
    messageCount: 1,
    lastMessageAt: '2026-08-19T10:00:00.000Z',
    lastMessageSeq: 1,
    lastMessagePreview: null,
    unread: 0,
    version: 1,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-19T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.setTicketStatus.mockResolvedValue({ ticket: ticket({ status: 'resolved', version: 2 }) });
  api.listTicketEvents.mockResolvedValue([]);
});

describe('DeskTicketActions', () => {
  it('offers In progress / Resolve / Close on an open ticket', () => {
    render(<DeskTicketActions ticket={ticket({ status: 'open' })} />);
    for (const name of ['In progress', 'Resolve', 'Close', 'History']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('offers Reopen / Close on a resolved ticket', () => {
    render(<DeskTicketActions ticket={ticket({ status: 'resolved' })} />);
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('resolving carries the ticket version', async () => {
    const user = userEvent.setup();
    render(<DeskTicketActions ticket={ticket({ status: 'open', version: 5 })} />);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(api.setTicketStatus).toHaveBeenCalledWith('mtk_1', 'resolved', 5));
  });

  it('History opens the activity trail', async () => {
    const user = userEvent.setup();
    const events: TicketEventDto[] = [
      {
        id: 'mtke_1',
        eventType: 'status_changed',
        actor: { zohoUserId: '42', name: 'Ali' },
        fromStatus: 'open',
        toStatus: 'resolved',
        detail: null,
        occurredAt: '2026-08-19T11:00:00.000Z',
      },
    ];
    api.listTicketEvents.mockResolvedValue(events);
    render(<DeskTicketActions ticket={ticket()} />);

    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(api.listTicketEvents).toHaveBeenCalledWith('mtk_1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Status: open → resolved/)).toBeInTheDocument();
  });

  it('surfaces a server error (e.g. a version conflict)', async () => {
    const user = userEvent.setup();
    api.setTicketStatus.mockRejectedValue(new Error('This ticket changed since you loaded it'));
    render(<DeskTicketActions ticket={ticket({ status: 'open' })} />);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText(/This ticket changed since you loaded it/)).toBeInTheDocument();
  });
});
