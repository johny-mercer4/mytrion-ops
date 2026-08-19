/**
 * DeskSettings — the read view of the desk's live routing/SLA config. It never edits (that is Mytrion
 * Admin → Escalation Routing); these pin that it renders the catalog and degrades to a clear error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CommsCatalog } from '@/api/comms';

const api = vi.hoisted(() => ({ getCommsCatalog: vi.fn() }));
vi.mock('@/api/comms', () => api);

import { DeskSettings } from './DeskSettings';

const CATALOG: CommsCatalog = {
  ticketTypes: [],
  escalationReasons: [],
  departments: [
    { department: 'customer-service', label: 'Customer Service', acceptsTickets: true, acceptsEscalations: true },
    { department: 'billing', label: 'Billing & Accounting', acceptsTickets: true, acceptsEscalations: false },
  ],
  sla: {
    resolutionHoursByPriority: { critical: 4, high: 4, medium: 24, low: 72 },
    firstResponseHoursByPriority: { critical: 1, high: 2, medium: 8, low: 24 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getCommsCatalog.mockResolvedValue(CATALOG);
});

describe('DeskSettings', () => {
  it('renders the SLA targets and department routing from the catalog', async () => {
    render(<DeskSettings />);
    expect(await screen.findByText('SLA targets')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();
    expect(screen.getByText('Customer Service')).toBeInTheDocument();
    expect(screen.getByText('Billing & Accounting')).toBeInTheDocument();
    // The panel points editors at Mytrion Admin rather than editing here.
    expect(screen.getByText(/Escalation Routing/)).toBeInTheDocument();
  });

  it('shows a clear error when the catalog cannot be read', async () => {
    api.getCommsCatalog.mockRejectedValue(new Error('backend unavailable'));
    render(<DeskSettings />);
    expect(await screen.findByText('backend unavailable')).toBeInTheDocument();
  });
});
