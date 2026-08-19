/**
 * DeskCompose — the "New ticket / escalation" modal.
 *
 * Pins the wiring that is easy to ship broken: only ROUTED escalation reasons are offered, the deal
 * picker drops rows with no numeric CRM id (createTicket rejects those), and a successful create
 * hands the parent the id to open — an escalation reports its backing ticketId, a ticket its own id.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommsCatalog } from '@/api/comms';

const api = vi.hoisted(() => ({
  getCommsCatalog: vi.fn(),
  createTicket: vi.fn(),
  createEscalation: vi.fn(),
}));
vi.mock('@/api/comms', () => api);

const dc = vi.hoisted(() => ({ listDeals: vi.fn() }));
vi.mock('@/api/dataCenter', () => dc);

import { DeskCompose } from './DeskCompose';

const CATALOG: CommsCatalog = {
  ticketTypes: [
    {
      code: 'C-1',
      label: 'Card Activation',
      group: null,
      targetDepartment: 'customer-service',
      defaultPriority: 'medium',
      slaHours: 24,
      requiresCarrier: false,
      requiresCard: false,
      automationKey: null,
      requestable: true,
      sortOrder: 1,
    },
  ],
  escalationReasons: [
    { code: 'ESC-CLIENT', label: 'Problem with the client', sortOrder: 1, routed: true },
    { code: 'ESC-UNROUTED', label: 'Nobody configured', sortOrder: 2, routed: false },
  ],
  departments: [
    { department: 'customer-service', label: 'Customer Service', acceptsTickets: true, acceptsEscalations: true },
    { department: 'sales', label: 'Sales', acceptsTickets: true, acceptsEscalations: false },
  ],
  sla: {
    resolutionHoursByPriority: { critical: 4, high: 4, medium: 24, low: 72 },
    firstResponseHoursByPriority: { critical: 1, high: 2, medium: 8, low: 24 },
  },
};

beforeAll(() => {
  // The submit path mints an idempotency key; jsdom's crypto may lack randomUUID.
  if (typeof globalThis.crypto.randomUUID !== 'function') {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => '00000000-0000-4000-8000-000000000000',
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getCommsCatalog.mockResolvedValue(CATALOG);
  api.createEscalation.mockResolvedValue({
    escalation: { id: 'mesc_1', ticketId: 'mtk_esc1', threadId: 'mth_esc1' },
    number: 'E-000001',
    threadId: 'mth_esc1',
  });
  api.createTicket.mockResolvedValue({ ticket: { id: 'mtk_1', threadId: 'mth_1', number: 'T-000001' } });
  dc.listDeals.mockResolvedValue([
    { id: '123', Deal_Name: 'Acme Trucking', Carrier_ID: '5001' },
    { id: 'not-a-number', Deal_Name: 'Bad row' },
  ]);
});

describe('DeskCompose', () => {
  it('loads the catalog and deals when opened, and starts on the Escalation tab', async () => {
    render(<DeskCompose open onClose={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect(api.getCommsCatalog).toHaveBeenCalled());
    expect(dc.listDeals).toHaveBeenCalled();
    // Both tabs exist; escalation submit is the default and is disabled until the form is valid.
    expect(screen.getByRole('tab', { name: 'Escalation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ticket' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise escalation' })).toBeDisabled();
  });

  it('offers only ROUTED escalation reasons', async () => {
    const user = userEvent.setup();
    render(<DeskCompose open onClose={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect(api.getCommsCatalog).toHaveBeenCalled());

    await user.click(await screen.findByRole('combobox', { name: 'Reason' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /Problem with the client/ })).toBeInTheDocument();
    expect(within(list).queryByRole('option', { name: /Nobody configured/ })).toBeNull();
  });

  it('raises an escalation and reports its backing ticketId', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<DeskCompose open onClose={vi.fn()} onCreated={onCreated} />);
    await waitFor(() => expect(api.getCommsCatalog).toHaveBeenCalled());

    await user.click(await screen.findByRole('combobox', { name: 'Reason' }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /Problem with the client/ }));

    await user.type(screen.getByPlaceholderText(/Brief summary of the issue/i), 'Cannot reach the client');
    await user.type(screen.getByPlaceholderText(/what's the issue/i), 'Phone disconnected for two days');

    const submit = screen.getByRole('button', { name: 'Raise escalation' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(api.createEscalation).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode: 'ESC-CLIENT',
          subject: 'Cannot reach the client',
          description: 'Phone disconnected for two days',
          sourceMytrion: 'desk',
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(api.createTicket).not.toHaveBeenCalled();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ kind: 'escalation', ticketId: 'mtk_esc1' }));
  });

  it('drops deals with no numeric CRM id and files a ticket against a real one', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<DeskCompose open onClose={vi.fn()} onCreated={onCreated} />);
    await waitFor(() => expect(api.getCommsCatalog).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: 'Ticket' }));

    await user.click(await screen.findByRole('combobox', { name: 'Ticket type' }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /Card Activation/ }));

    await user.click(screen.getByRole('combobox', { name: 'Deal' }));
    const dealList = await screen.findByRole('listbox');
    // The non-numeric-id row is not a valid CRM deal and must not be offered.
    expect(within(dealList).queryByRole('option', { name: /Bad row/ })).toBeNull();
    await user.click(within(dealList).getByRole('option', { name: /Acme Trucking/ }));

    await user.type(screen.getByPlaceholderText(/Brief summary of the request/i), 'Card not working');
    await user.type(screen.getByPlaceholderText(/what's needed/i), 'Driver reports declines');

    const submit = screen.getByRole('button', { name: 'Create ticket' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(api.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          typeCode: 'C-1',
          dealId: '123',
          subject: 'Card not working',
          description: 'Driver reports declines',
          sourceMytrion: 'desk',
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ kind: 'ticket', ticketId: 'mtk_1' }));
  });

  it('surfaces a server error instead of reporting success', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createEscalation.mockRejectedValue(new Error('Escalation reason is not routed'));
    render(<DeskCompose open onClose={vi.fn()} onCreated={onCreated} />);
    await waitFor(() => expect(api.getCommsCatalog).toHaveBeenCalled());

    await user.click(await screen.findByRole('combobox', { name: 'Reason' }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /Problem with the client/ }));
    await user.type(screen.getByPlaceholderText(/Brief summary of the issue/i), 'x');
    await user.type(screen.getByPlaceholderText(/what's the issue/i), 'y');
    await user.click(screen.getByRole('button', { name: 'Raise escalation' }));

    expect(await screen.findByText('Escalation reason is not routed')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
