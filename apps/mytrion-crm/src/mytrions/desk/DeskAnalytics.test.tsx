/**
 * DeskAnalytics — the Analytics & SLA dashboard tab.
 *
 * Verifies it fetches with the default 30-day window, renders the SLA tiles (including the derived
 * first-response-met percentage and humanised average durations), and draws the breakdown + workload
 * sections from the server payload. The figures are server-computed; this pins the presentation only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CommsAnalyticsDto, DepartmentOptionDto } from '@/api/comms';

const api = vi.hoisted(() => ({ getCommsAnalytics: vi.fn() }));
vi.mock('@/api/comms', () => api);

import { DeskAnalytics } from './DeskAnalytics';

const departments: DepartmentOptionDto[] = [
  { department: 'customer-service', label: 'Customer Service', acceptsTickets: true, acceptsEscalations: true },
];

const analytics: CommsAnalyticsDto = {
  window: { sinceDays: 30, since: '2026-07-20T00:00:00.000Z' },
  totals: { all: 10, open: 6, resolved: 3, closed: 1, overdue: 2, breached: 1 },
  sla: {
    firstResponseMet: 4,
    firstResponseMissed: 1,
    firstResponsePending: 1,
    avgResolutionHours: 5.5,
    avgFirstResponseHours: 0.5,
  },
  byStatus: [
    { key: 'open', count: 6 },
    { key: 'resolved', count: 3 },
    { key: 'closed', count: 1 },
  ],
  byPriority: [
    { key: 'high', count: 4 },
    { key: 'medium', count: 6 },
  ],
  byDepartment: [{ key: 'customer-service', count: 10 }],
  volume: [
    { date: '2026-08-01', created: 2, resolved: 1 },
    { date: '2026-08-02', created: 3, resolved: 2 },
  ],
  topAssignees: [{ zohoUserId: '7', name: 'Nodira', open: 4 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getCommsAnalytics.mockResolvedValue(analytics);
});

describe('DeskAnalytics', () => {
  it('loads the default 30-day window on mount', async () => {
    render(<DeskAnalytics departments={departments} />);
    await waitFor(() =>
      expect(api.getCommsAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ sinceDays: 30 }),
        expect.anything(),
      ),
    );
  });

  it('renders the SLA tiles, including the derived first-response-met % and humanised averages', async () => {
    render(<DeskAnalytics departments={departments} />);
    // 4 met / (4 met + 1 missed) = 80%.
    expect(await screen.findByText('80%')).toBeInTheDocument();
    expect(screen.getByText('5.5h')).toBeInTheDocument(); // avg resolution
    expect(screen.getByText('30m')).toBeInTheDocument(); // avg first response (0.5h)
    // Labels unique to the stat tiles ('Open' is deliberately excluded — it is also the By-status bar).
    for (const label of ['Overdue', 'SLA breached', 'First-response met', 'Avg resolution']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('draws the breakdown and workload sections from the payload', async () => {
    render(<DeskAnalytics departments={departments} />);
    expect(await screen.findByText('By status')).toBeInTheDocument();
    expect(screen.getByText('By priority')).toBeInTheDocument();
    expect(screen.getByText('Open by agent')).toBeInTheDocument();
    expect(screen.getByText('Nodira')).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    api.getCommsAnalytics.mockRejectedValue(new Error('Analytics unavailable'));
    render(<DeskAnalytics departments={departments} />);
    expect(await screen.findByText(/Analytics unavailable/)).toBeInTheDocument();
  });
});
