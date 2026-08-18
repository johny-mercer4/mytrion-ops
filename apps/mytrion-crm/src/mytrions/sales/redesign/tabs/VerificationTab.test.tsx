/**
 * Sales Verification tab — the agent's own credit applications.
 *
 * Rewritten (2026-08-15) alongside the component: the previous suite covered the credit_platform
 * pipeline cards, a surface that no longer exists. What matters now is that the RED state is legible
 * without relying on colour, and that the outstanding count shown is the SERVER's, never re-derived
 * in the browser.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationCaseRow } from '@/api/verificationFlow';
import { VerificationTab } from './VerificationTab';

const state = vi.hoisted(() => ({
  current: {
    data: null as { items: VerificationCaseRow[]; total: number } | null,
    loading: true,
    revalidating: false,
    error: null as string | null,
    reload: vi.fn(),
  },
}));

vi.mock('../dcCache', () => ({ useCachedLoad: () => state.current }));
vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
/** The signed-in agent, so a card can tell "mine" from "reached me via the Deal". */
vi.mock('@/api/session', () => ({
  getSession: () => ({ worker: { zohoUserId: 'agent-self' } }),
}));
vi.mock('@/context/UserContextProvider', () => ({
  useUserContext: () => ({ userId: 'u1', role: 'CEO', userName: 'Admin', allDepartmentAccess: true }),
  useRealUserContext: () => ({ userId: 'u1', role: 'CEO', userName: 'Admin', allDepartmentAccess: true }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../applicationIntake', () => ({
  ApplicationIntake: ({ applicationId }: { applicationId?: string }) => (
    <div data-testid="intake">{applicationId ?? 'new'}</div>
  ),
}));

function row(over: Partial<VerificationCaseRow> = {}): VerificationCaseRow {
  return {
    id: 'vc_1',
    companyName: 'Kaiser Freight LLC',
    firstName: null,
    lastName: null,
    email: 'ops@kaiser.test',
    phone: '6145550110',
    applicantType: 'carrier',
    ein: null,
    mc: null,
    dot: null,
    underwritingRoute: 'octane_internal',
    verificationProcess: false,
    phaseCode: 'p1_intake',
    statusCode: 'intake_incomplete',
    statusLabel: 'Incomplete application',
    boardColumn: 'draft',
    trucksCount: 14,
    fuelCardsRequested: 12,
    requestedLimit: '38000.00',
    approvedLimitAmount: null,
    intakeMissing: ['ein', 'businessAddress', 'bankStatements'],
    submittedAt: null,
    ownerName: 'Test Agent',
    ownerZohoUserId: 'agent-self',
    zohoOwnerId: 'agent-self',
    zohoOwnerName: 'Test Agent',
    closedAt: null,
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  state.current = {
    data: null,
    loading: true,
    revalidating: false,
    error: null,
    reload: vi.fn(),
  };
});

function ready(items: VerificationCaseRow[]): void {
  state.current = { data: { items, total: items.length }, loading: false, revalidating: false, error: null, reload: vi.fn() };
}

describe('loading and empty', () => {
  it('shows one loader while there is nothing to show', () => {
    render(<VerificationTab />);
    expect(screen.queryByTestId('application-card')).not.toBeInTheDocument();
  });

  /**
   * The empty state has to say where applications COME FROM. An agent who reads "no applications
   * yet" and has no way to make one will go looking for a button that does not exist.
   */
  it('says applications arrive from Zoho rather than being started here', () => {
    ready([]);
    render(<VerificationTab />);
    expect(screen.getByText(/No applications yet/i)).toBeInTheDocument();
    expect(screen.getByText(/created automatically from your Deals in Zoho/i)).toBeInTheDocument();
    expect(screen.getByText(/you do not start one here/i)).toBeInTheDocument();
    expect(screen.queryByText(/Create → Application/i)).not.toBeInTheDocument();
  });
});

describe('the red state', () => {
  it('names how many items are outstanding rather than only colouring the card', () => {
    ready([row()]);
    render(<VerificationTab />);
    expect(screen.getByText('3 items still needed from you')).toBeInTheDocument();
  });

  it('uses the singular for exactly one outstanding item', () => {
    ready([row({ intakeMissing: ['ein'] })]);
    render(<VerificationTab />);
    expect(screen.getByText('1 item still needed from you')).toBeInTheDocument();
  });

  it('reports the server list verbatim — completeness is never re-derived here', () => {
    // The row has every visible field populated but the server still says three things are missing;
    // the card must trust the server, because the server is what the gate actually uses.
    ready([row({ intakeMissing: ['a', 'b', 'c'] })]);
    render(<VerificationTab />);
    expect(screen.getByText('3 items still needed from you')).toBeInTheDocument();
  });

  it('falls back to a plain statement when the missing list is empty but unsubmitted', () => {
    ready([row({ intakeMissing: [] })]);
    render(<VerificationTab />);
    expect(screen.getByText('Not submitted yet')).toBeInTheDocument();
  });
});

/**
 * A case reaches an agent three ways — they submitted it, they were ASSIGNED it, or they own the Zoho
 * Deal — so a card in this list can belong to another Sales agent. The name is what tells the agent
 * whether they are the one who has to fill it in, and it must be the DEAL's owner: the assignee is
 * the Verification desk's own credit agent on any case whose Deal arrived unowned.
 */
describe('whose case it is', () => {
  it("names the other agent's Deal, not the row's assignee", () => {
    ready([
      row({
        zohoOwnerId: 'other-agent',
        zohoOwnerName: 'Robert Toms',
        ownerZohoUserId: 'verification-desk',
        ownerName: 'Sarvar Asqarov',
      }),
    ]);
    render(<VerificationTab />);
    expect(screen.getByText('Sales owner')).toBeInTheDocument();
    expect(screen.getByText('Robert Toms')).toBeInTheDocument();
    // The credit agent must never be presented as the Sales owner.
    expect(screen.queryByText('Sarvar Asqarov')).not.toBeInTheDocument();
  });

  it('stays quiet on your own Deals rather than naming you on every card', () => {
    ready([row()]);
    render(<VerificationTab />);
    expect(screen.queryByText('Sales owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Test Agent')).not.toBeInTheDocument();
  });

  it('says nothing when Zoho has nobody on the Deal — there is no Sales owner to name', () => {
    ready([row({ zohoOwnerId: null, zohoOwnerName: null, ownerName: 'Sarvar Asqarov' })]);
    render(<VerificationTab />);
    expect(screen.queryByText('Sales owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Sarvar Asqarov')).not.toBeInTheDocument();
  });
});

describe('the green state', () => {
  it('shows how far along the application is, not the status a second time', () => {
    ready([
      row({
        verificationProcess: true,
        statusCode: 'in_review',
        statusLabel: 'In review',
        boardColumn: 'in_review',
        phaseCode: 'p6_credit_banking',
        intakeMissing: [],
        submittedAt: '2026-08-14T12:00:00.000Z',
      }),
    ]);
    render(<VerificationTab />);
    // The chip already says "In review"; the stage line earns its place by saying WHERE it is.
    expect(screen.getByText(/Stage/)).toBeInTheDocument();
    expect(screen.getByText(/of 10 · Credit & banking/)).toBeInTheDocument();
    // And the ask line says there is nothing for Sales to do, rather than leaving them guessing.
    expect(screen.getByText(/nothing needed from you/i)).toBeInTheDocument();
  });

  it('calls out a document request as the agent’s action', () => {
    ready([
      row({
        verificationProcess: true,
        statusCode: 'pending_docs',
        boardColumn: 'needs_you',
        intakeMissing: [],
      }),
    ]);
    render(<VerificationTab />);
    expect(screen.getByText(/asked you for documents/i)).toBeInTheDocument();
  });

  it('shows the approved limit when there is one', () => {
    ready([
      row({
        verificationProcess: true,
        statusCode: 'approved',
        // The list endpoint stitches the label from the status; a fixture that leaves the two
        // disagreeing is not a shape the server can produce.
        statusLabel: 'Approved',
        boardColumn: 'approved',
        approvedLimitAmount: '4560.00',
        closedAt: '2026-08-15T09:00:00.000Z',
      }),
    ]);
    render(<VerificationTab />);
    // The DECISION is the headline for a closed case — the limit rides on it, not in a chip the
    // agent has to hunt for.
    expect(screen.getByText(/Approved — \$4560\.00/)).toBeInTheDocument();
  });
});

/**
 * Sales sees three things and no more: where the case is, what Verification wants from them, and
 * the decision. Anything else on this card is the desk's business.
 */
describe('what the roster tells Sales', () => {
  it('draws the stage as ten segments, the way the Verification queue does', () => {
    const { container } = render(<VerificationTab />);
    ready([row({ verificationProcess: true, phaseCode: 'p3_screening', intakeMissing: [] })]);
    container.remove();
    const view = render(<VerificationTab />);
    expect(view.container.querySelectorAll('.ss-vf-seg')).toHaveLength(10);
    expect(view.container.querySelectorAll('.ss-vf-seg[data-on="true"]')).toHaveLength(3);
  });

  it('names the applicant type in the two words both desks use', () => {
    ready([row({ applicantType: 'owner_operator' })]);
    render(<VerificationTab />);
    expect(screen.getByText('Owner-Operator / Individual')).toBeInTheDocument();
  });

  it('still names a legacy `company` row rather than showing a dash', () => {
    // The Zoho poller used to assign a third type on its own. Those rows are still in the table.
    ready([row({ applicantType: 'company' })]);
    render(<VerificationTab />);
    expect(screen.getByText('Carrier (Company)')).toBeInTheDocument();
  });

  it('never shows the underwriting detail — no findings, no phase verdicts', () => {
    ready([row({ verificationProcess: true, phaseCode: 'p7_hard_stops', intakeMissing: [] })]);
    render(<VerificationTab />);
    expect(screen.queryByText(/hard stop/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
  });

  it('renders the loading state as roster cards, not the generic grid', () => {
    // The shared `variant="grid"` skeleton drew a different card in a different column width, so
    // the page re-laid-out when the data landed.
    const view = render(<VerificationTab />);
    expect(view.container.querySelector('[aria-label="Loading your applications"]')).toBeTruthy();
    expect(view.container.querySelectorAll('.ss-verification-card').length).toBeGreaterThan(0);
  });
});

describe('routing surfaced on the card', () => {
  it('flags a WEX-routed application', () => {
    ready([row({ underwritingRoute: 'wex', fuelCardsRequested: 25 })]);
    render(<VerificationTab />);
    expect(screen.getByText('WEX')).toBeInTheDocument();
  });

  it('does not label an internally-underwritten application with a route', () => {
    ready([row({ underwritingRoute: 'octane_internal' })]);
    render(<VerificationTab />);
    expect(screen.queryByText('WEX')).not.toBeInTheDocument();
  });
});

describe('filters', () => {
  it('separates incomplete from those with Verification', () => {
    ready([
      row({ id: 'vc_red' }),
      row({
        id: 'vc_green',
        companyName: 'Ramirez Trucking',
        verificationProcess: true,
        statusCode: 'in_review',
        boardColumn: 'in_review',
        intakeMissing: [],
      }),
    ]);
    render(<VerificationTab />);
    expect(screen.getAllByTestId('application-card')).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: /Incomplete/ }));
    expect(screen.getAllByTestId('application-card')).toHaveLength(1);
    expect(screen.getByText('Kaiser Freight LLC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /With Verification/ }));
    expect(screen.getByText('Ramirez Trucking')).toBeInTheDocument();
  });

  it('puts a pending-docs case under "Needs you", not "With Verification"', () => {
    ready([row({ verificationProcess: true, statusCode: 'pending_docs', boardColumn: 'needs_you', intakeMissing: [] })]);
    render(<VerificationTab />);
    fireEvent.click(screen.getByRole('tab', { name: /With Verification/ }));
    expect(screen.queryByTestId('application-card')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Needs you/ }));
    expect(screen.getByTestId('application-card')).toBeInTheDocument();
  });
});

describe('opening an application', () => {
  it('opens the intake form for the card that was clicked', () => {
    ready([row({ id: 'vc_open' })]);
    render(<VerificationTab />);
    fireEvent.click(screen.getByTestId('application-card'));
    expect(screen.getByTestId('intake')).toHaveTextContent('vc_open');
  });

  it('names the applicant in the card’s accessible label', () => {
    ready([row()]);
    render(<VerificationTab />);
    expect(
      screen.getByRole('button', { name: /Open application for Kaiser Freight LLC/i }),
    ).toBeInTheDocument();
  });

  it('falls back to a person’s name when there is no company', () => {
    ready([row({ companyName: null, firstName: 'Marisol', lastName: 'Otero', applicantType: 'owner_operator' })]);
    render(<VerificationTab />);
    expect(screen.getByText('Marisol Otero')).toBeInTheDocument();
  });
});
