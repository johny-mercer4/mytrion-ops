/**
 * DeskEscalationActions — the escalation ladder in the conversation header.
 *
 * Pins the load-bearing behaviour: a pending escalation offers the four moves, each transition
 * carries the version it saw (so a stale decision 409s rather than overwriting), a resolved one
 * collapses to a status chip, and a hand-off refuses to submit without a target department.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DepartmentOptionDto, EscalationDto, TicketDto } from '@/api/comms';

const api = vi.hoisted(() => ({
  getEscalation: vi.fn(),
  actOnEscalation: vi.fn(),
}));
vi.mock('@/api/comms', () => api);

import { DeskEscalationActions } from './DeskEscalationActions';

const DEPARTMENTS: DepartmentOptionDto[] = [
  { department: 'customer-service', label: 'Customer Service', acceptsTickets: true, acceptsEscalations: true },
  { department: 'billing', label: 'Billing & Accounting', acceptsTickets: true, acceptsEscalations: true },
];

function escalationTicket(): TicketDto {
  return {
    id: 'mtk_esc',
    threadId: 'mth_esc',
    number: 'E-000007',
    kind: 'escalation',
    subject: 'Client unreachable',
    status: 'escalated',
    substatus: null,
    priority: 'high',
    tags: [],
    typeCode: null,
    typeLabel: null,
    targetDepartment: 'customer-service',
    sourceDepartment: 'sales',
    sourceMytrion: 'desk',
    requester: { zohoUserId: '42', carrierId: null, name: 'Ali' },
    assignee: null,
    client: null,
    sla: { hours: null, dueAt: null, firstResponseDueAt: null, firstResponseAt: null, breachedAt: null, overdue: false },
    escalation: { id: 'mesc_1', level: 2, levelLabel: 'Agent' },
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
  };
}

function escalation(over: Partial<EscalationDto> = {}): EscalationDto {
  return {
    id: 'mesc_1',
    threadId: 'mth_esc',
    ticketId: 'mtk_esc',
    reasonCode: 'ESC-CLIENT',
    reasonLabel: 'Problem with the client',
    requester: { zohoUserId: '42', name: 'Ali', department: 'sales' },
    status: 'pending',
    level: 2,
    hopIndex: 1,
    department: 'customer-service',
    assignee: null,
    hopDueAt: null,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    version: 3,
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-19T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getEscalation.mockResolvedValue({ escalation: escalation(), hops: [], thread: null });
  api.actOnEscalation.mockResolvedValue({ escalation: escalation({ status: 'resolved', version: 4 }) });
});

describe('DeskEscalationActions', () => {
  it('offers the four ladder moves while the escalation is pending', async () => {
    render(<DeskEscalationActions ticket={escalationTicket()} departments={DEPARTMENTS} />);
    for (const name of ['Escalate up', 'Hand off', 'Resolve', 'Reject']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('resolves carrying the version it saw, then collapses to a status chip', async () => {
    const user = userEvent.setup();
    render(<DeskEscalationActions ticket={escalationTicket()} departments={DEPARTMENTS} />);

    await user.click(await screen.findByRole('button', { name: 'Resolve' }));
    // The confirm lives in the dialog; the header still holds a "Resolve" button behind it.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(api.actOnEscalation).toHaveBeenCalledWith(
        'mesc_1',
        'resolve',
        expect.objectContaining({ expectedVersion: 3 }),
      ),
    );
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
  });

  it('shows only a status chip once the escalation is no longer pending', async () => {
    api.getEscalation.mockResolvedValue({
      escalation: escalation({ status: 'resolved' }),
      hops: [],
      thread: null,
    });
    render(<DeskEscalationActions ticket={escalationTicket()} departments={DEPARTMENTS} />);
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escalate up' })).toBeNull();
  });

  it('refuses a hand-off with no target department', async () => {
    const user = userEvent.setup();
    render(<DeskEscalationActions ticket={escalationTicket()} departments={DEPARTMENTS} />);

    await user.click(await screen.findByRole('button', { name: 'Hand off' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Hand off' }));

    expect(await screen.findByText(/Choose a department to hand off to/i)).toBeInTheDocument();
    expect(api.actOnEscalation).not.toHaveBeenCalled();
  });
});
