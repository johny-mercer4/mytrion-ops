/**
 * QA 2026-08-07: the Tickets/Calls Analytics leaderboards showed agents from other departments
 * (Billing, Verification, Maintenance) because the underlying DWH queries are org-wide — nothing
 * in this repo passes them a department filter. The fix joins the manager leaderboard against the
 * CS-only Desk roster (see csAnalyticsScope.ts's `zohoDesk.listAgents(DESK_DEPARTMENTS.cs)`) and
 * drops any row that roster doesn't recognize. This guards the frontend half of that join.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/cs', () => ({
  getTicketsAnalytics: vi.fn(),
  getCallsAnalytics: vi.fn(),
  getMaintenanceAnalytics: vi.fn(),
  getDeskRoster: vi.fn(),
}));

import { getCallsAnalytics, getDeskRoster, getMaintenanceAnalytics, getTicketsAnalytics } from '@/api/cs';
import { loadAnalytics } from './live';

const CS_ROSTER = [
  { id: 'agent-1', name: 'CS One', email: 'cs.one@example.com' },
  { id: 'agent-2', name: 'CS Two', email: 'cs.two@example.com' },
];

const EMPTY_MAINTENANCE = {
  success: true,
  data: {
    totals: { current: 0, previous: 0, open: 0, closed: 0, halfComplete: 0, fullComplete: 0 },
    byStatus: [],
    byCaseType: [],
    daily: [],
    byOwner: [],
  },
};

function mockUnscopedDwhResponses() {
  vi.mocked(getTicketsAnalytics).mockResolvedValue({
    data: {
      agents: [
        { assignee_id: 'agent-1', total: 10, closed_count: 8, open_count: 2, avg_resolution_secs: 3600 },
        // Not on the CS roster — a Billing/Verification/Maintenance agent leaking through the
        // org-wide DWH query, exactly the QA-reported symptom.
        { assignee_id: 'other-9', total: 99, closed_count: 90, open_count: 9, avg_resolution_secs: 1200 },
      ],
      totals: { current: 109, previous: 50 },
      daily: [],
      byStatus: [],
    },
  });
  vi.mocked(getCallsAnalytics).mockResolvedValue({
    data: {
      agents: [
        { email: 'cs.two@example.com', name: 'CS Two', total: 4, prev_total: 2 },
        { email: 'other@example.com', name: 'Not CS', total: 40, prev_total: 20 },
      ],
      totals: { current: 44, previous: 22 },
      daily: [],
      byStatus: [],
    },
  });
  vi.mocked(getMaintenanceAnalytics).mockResolvedValue(EMPTY_MAINTENANCE);
}

describe('loadAnalytics — leaderboard department scoping', () => {
  beforeEach(() => {
    vi.mocked(getTicketsAnalytics).mockReset();
    vi.mocked(getCallsAnalytics).mockReset();
    vi.mocked(getMaintenanceAnalytics).mockReset();
    vi.mocked(getDeskRoster).mockReset();
  });

  it('drops agents absent from the CS Desk roster from both leaderboards (manager view)', async () => {
    mockUnscopedDwhResponses();
    vi.mocked(getDeskRoster).mockResolvedValue({ agents: CS_ROSTER });

    const data = await loadAnalytics(
      'this_month',
      { isManager: true, deskAgentId: null, email: null, unmatched: false },
      null,
    );

    expect(data.tickets.leaderboard.map((r) => r.agent)).toEqual(['CS One']);
    expect(data.calls.leaderboard.map((r) => r.agent)).toEqual(['CS Two']);
  });

  it('does not filter a non-manager’s own already-scoped row (roster is never fetched for them)', async () => {
    mockUnscopedDwhResponses();

    const data = await loadAnalytics(
      'this_month',
      { isManager: false, deskAgentId: 'agent-1', email: 'cs.one@example.com', unmatched: false },
      null,
    );

    // getDeskRoster must not even be called off the manager path.
    expect(getDeskRoster).not.toHaveBeenCalled();
    // The backend already scoped these to the caller; the frontend must not blank them just
    // because the (unfetched, empty) roster map doesn't contain the row.
    expect(data.tickets.leaderboard.length).toBeGreaterThan(0);
    expect(data.calls.leaderboard.length).toBeGreaterThan(0);
  });
});
