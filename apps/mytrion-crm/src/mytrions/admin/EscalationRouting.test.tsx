/**
 * Escalation Routing screen — the readiness summary and the level-2 save.
 *
 * The two things this screen can get wrong that a backend test cannot catch: showing a routing gap as
 * fine (an admin then never fixes it, and agents keep getting refused), and rendering ONE loader while a
 * second spinner sits underneath it. Both are asserted here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoutingSnapshot } from '../../api/commsAdmin';

const api = vi.hoisted(() => ({
  getCommsRouting: vi.fn(),
  listRoutingCandidates: vi.fn(),
  patchEscalationReason: vi.fn(),
  patchDepartmentRouting: vi.fn(),
  upsertPoolSeat: vi.fn(),
  removePoolSeat: vi.fn(),
}));
vi.mock('../../api/commsAdmin', () => api);

const toast = vi.hoisted(() => ({
  adminToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('./toast', () => toast);

import { EscalationRouting } from './EscalationRouting';

// Call counts are the assertion in the save tests ("refetched exactly once"), so they must not carry
// over between tests in this file.
beforeEach(() => {
  vi.clearAllMocks();
});

function snapshot(over: Partial<RoutingSnapshot> = {}): RoutingSnapshot {
  return {
    departments: [
      {
        department: 'customer-service',
        managerZohoUserId: '88',
        managerName: 'Bekzod',
        defaultAssigneeZohoUserId: null,
        ticketAssignmentStrategy: 'round_robin',
        requireOnline: true,
        acceptsTickets: true,
        acceptsEscalations: true,
        slaHoursOverride: null,
        pool: [],
      },
      {
        department: 'billing',
        managerZohoUserId: null,
        managerName: null,
        defaultAssigneeZohoUserId: null,
        ticketAssignmentStrategy: 'manual',
        requireOnline: false,
        acceptsTickets: true,
        acceptsEscalations: true,
        slaHoursOverride: null,
        pool: [],
      },
    ],
    escalationReasons: [
      {
        code: 'ESC-01',
        label: 'Problem with the client',
        defaultAssigneeZohoUserId: '77',
        defaultPriority: null,
        active: true,
        sortOrder: 1,
        routed: true,
      },
      {
        code: 'ESC-02',
        label: 'Question',
        defaultAssigneeZohoUserId: null,
        defaultPriority: null,
        active: true,
        sortOrder: 2,
        routed: false,
      },
    ],
    cLevel: [],
    readiness: {
      unroutedReasons: ['ESC-02'],
      departmentsMissingManager: ['billing'],
      cLevelConfigured: false,
    },
    knownDepartments: ['sales', 'customer-service', 'billing', 'c-level'],
    ...over,
  };
}

const candidates = [
  {
    zohoUserId: '77',
    name: 'Dilnoza Karimova',
    email: 'd@x.com',
    designation: 'CS Agent',
    department: 'Customer Service',
    status: 'Active',
    leadOfDepartments: [],
  },
  {
    zohoUserId: '88',
    name: 'Bekzod Tashkentov',
    email: 'b@x.com',
    designation: 'Head of CS',
    department: 'Customer Service',
    status: 'Active',
    leadOfDepartments: ['hrd_cs'],
  },
];

function arrange(snap = snapshot()) {
  api.getCommsRouting.mockResolvedValue(snap);
  api.listRoutingCandidates.mockResolvedValue({ candidates, total: 2, truncated: false });
  return render(<EscalationRouting />);
}

describe('EscalationRouting — readiness', () => {
  it('shows exactly one loading state, not a stacked pair', async () => {
    let resolve: (v: RoutingSnapshot) => void = () => {};
    api.getCommsRouting.mockReturnValue(new Promise<RoutingSnapshot>((r) => (resolve = r)));
    api.listRoutingCandidates.mockResolvedValue({ candidates: [], total: 0, truncated: false });
    const { container } = render(<EscalationRouting />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading escalation routing/i);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);

    resolve(snapshot());
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('surfaces every gap by name so an admin knows what to fix', async () => {
    arrange();
    // The unrouted reason, the manager-less department and the empty C-Level pool must all be named —
    // a count alone ("2 gaps") leaves the admin hunting.
    expect(await screen.findByText(/Unrouted: ESC-02/)).toBeInTheDocument();
    expect(screen.getByText(/Missing: billing/)).toBeInTheDocument();
    expect(screen.getByText(/Level 4 is unreachable/i)).toBeInTheDocument();
  });

  it('counts only ACTIVE reasons in the routed tally', async () => {
    arrange(
      snapshot({
        escalationReasons: [
          ...snapshot().escalationReasons,
          {
            code: 'ESC-09',
            label: 'Retired',
            defaultAssigneeZohoUserId: null,
            defaultPriority: null,
            active: false,
            sortOrder: 9,
            routed: false,
          },
        ],
        readiness: { unroutedReasons: ['ESC-02'], departmentsMissingManager: [], cLevelConfigured: true },
      }),
    );
    // 1 routed of 2 ACTIVE — the retired third row must not inflate the denominator. Scoped to the
    // reasons tile because the departments tile legitimately reads 1/2 as well.
    const tile = (await screen.findByText('Escalation reasons routed')).closest('div')?.parentElement;
    expect(tile).toHaveTextContent('1/2');
  });

  it('reports all-clear when nothing is missing', async () => {
    arrange(
      snapshot({
        readiness: { unroutedReasons: [], departmentsMissingManager: [], cLevelConfigured: true },
        cLevel: [
          {
            zohoUserId: '111',
            displayName: 'Sardor',
            roleTitle: 'CEO',
            active: true,
            acceptsNew: true,
            maxOpen: null,
            sortOrder: 0,
            lastAssignedAt: null,
            assignedCount: 0,
          },
        ],
      }),
    );
    expect(await screen.findByText(/Every active reason has a level-2 assignee/i)).toBeInTheDocument();
    expect(screen.getByText(/Level 3 resolves for every department/i)).toBeInTheDocument();
  });

  it('renders an error state with a retry rather than an empty screen', async () => {
    api.getCommsRouting.mockRejectedValue(new Error('backend down'));
    api.listRoutingCandidates.mockResolvedValue({ candidates: [], total: 0, truncated: false });
    render(<EscalationRouting />);
    expect(await screen.findByRole('alert')).toHaveTextContent('backend down');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('EscalationRouting — level 2 save', () => {
  it('picks a person for an unrouted reason and refreshes from the server', async () => {
    const user = userEvent.setup();
    api.patchEscalationReason.mockResolvedValue({ reason: { code: 'ESC-02', routed: true } });
    arrange();

    await screen.findByText('Problem with the client');
    // The unrouted row's picker, addressed by its accessible label rather than by DOM position.
    await user.click(screen.getByRole('button', { name: /Level 2 assignee for Question/i }));
    await user.click(await screen.findByRole('option', { name: /Dilnoza Karimova/ }));

    await waitFor(() =>
      expect(api.patchEscalationReason).toHaveBeenCalledWith('ESC-02', {
        defaultAssigneeZohoUserId: '77',
      }),
    );
    // Refetched, not locally patched: `readiness` is derived server-side and a local edit would drift
    // from the numbers the agents' refusal messages use.
    await waitFor(() => expect(api.getCommsRouting).toHaveBeenCalledTimes(2));
    expect(toast.adminToast.success).toHaveBeenCalled();
  });

  it('a failed save surfaces an error toast and does NOT refetch', async () => {
    const user = userEvent.setup();
    api.patchEscalationReason.mockRejectedValue(new Error('nope'));
    arrange();

    await screen.findByText('Question');
    await user.click(screen.getByRole('button', { name: /Level 2 assignee for Question/i }));
    await user.click(await screen.findByRole('option', { name: /Dilnoza Karimova/ }));

    await waitFor(() => expect(toast.adminToast.error).toHaveBeenCalled());
    expect(api.getCommsRouting).toHaveBeenCalledTimes(1);
  });

  it('clearing a routed reason sends an explicit null — unrouting must be possible', async () => {
    const user = userEvent.setup();
    api.patchEscalationReason.mockResolvedValue({ reason: { code: 'ESC-01', routed: false } });
    arrange();

    await screen.findByText('Problem with the client');
    await user.click(
      screen.getByRole('button', { name: /Clear Level 2 assignee for Problem with the client/i }),
    );

    await waitFor(() =>
      expect(api.patchEscalationReason).toHaveBeenCalledWith('ESC-01', {
        defaultAssigneeZohoUserId: null,
      }),
    );
  });

  it('marks HR department leads in the picker as a suggestion, not a selection', async () => {
    const user = userEvent.setup();
    arrange();
    await screen.findByText('billing');
    await user.click(screen.getByRole('button', { name: /Level 3 manager for billing/i }));

    expect(await screen.findByText('Dept lead')).toBeInTheDocument();
    // Nothing was saved by merely opening the picker — HR suggests, the admin decides.
    expect(api.patchDepartmentRouting).not.toHaveBeenCalled();
  });
});
