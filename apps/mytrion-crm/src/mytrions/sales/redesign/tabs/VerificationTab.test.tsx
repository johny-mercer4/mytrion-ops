/**
 * Sales Verification tab — the agent's own credit applications.
 *
 * The surface is now the Verification desk's own queue (`ds/DataTable` over `applicants.css`) rather
 * than a card grid, so the queries are rows and cells. What is asserted has not changed: the RED
 * state stays legible without relying on colour, the outstanding count shown is the SERVER's and
 * never re-derived in the browser, and the desk's own vocabulary for what it is CHECKING stays off
 * this screen even though the desk's chrome is on it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
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

/**
 * Data rows only. `DataTable` resolves to table mode wherever `matchMedia` is absent, so this is a
 * real `<table>`; the head row and the loading / empty `TableMessageRow` are both excluded by asking
 * for the `rowheader` that the Applicant column renders as `<th scope="row">`.
 */
function dataRows(): HTMLElement[] {
  const table = screen.queryByRole('table');
  if (!table) return [];
  return within(table)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('rowheader').length > 0);
}

describe('loading and empty', () => {
  it('shows one loader while there is nothing to show', () => {
    const view = render(<VerificationTab />);
    expect(dataRows()).toHaveLength(0);
    // ONE aria-busy owner for the surface: the page. A second inside the table would announce
    // "busy" twice for one fetch.
    expect(view.container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });

  /**
   * A refused load must SAY so. Showing "No applications yet" for a 500 tells the agent their book is
   * empty when it is only unreachable — the empty state is gated on `!error` for exactly this.
   */
  it('reports a failed load instead of claiming there are no applications', () => {
    state.current = {
      data: null,
      loading: false,
      revalidating: false,
      error: 'Network request failed',
      reload: vi.fn(),
    };
    render(<VerificationTab />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load your applications/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/Network request failed/);
    expect(screen.queryByText(/No applications yet/i)).not.toBeInTheDocument();
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
    const view = render(<VerificationTab />);
    // The chip already says "In review"; the phase cell earns its place by saying WHERE it is.
    expect(view.container.querySelector('.va-phase-cell-label')?.textContent).toBe(
      '6/10 · Credit & banking',
    );
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
    // The desk's own `.va-seg`, from its own stylesheet — not a second meter that happens to have
    // ten of something.
    ready([row({ verificationProcess: true, phaseCode: 'p3_screening', intakeMissing: [] })]);
    const view = render(<VerificationTab />);
    expect(view.container.querySelectorAll('.va-seg')).toHaveLength(10);
    expect(view.container.querySelectorAll('.va-seg[data-on="true"]')).toHaveLength(3);
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

  /**
   * The chrome is the desk's; the VOCABULARY is not. `PHASE_SHORT` names the check ("Hard stops",
   * "Highway") and that is the credit desk's business — Sales gets `SALES_PHASE_LABEL`, which names
   * the stage. Reusing the desk's list is the easy mistake this pins.
   */
  it('never shows the underwriting detail — no findings, no phase verdicts', () => {
    ready([row({ verificationProcess: true, phaseCode: 'p7_hard_stops', intakeMissing: [] })]);
    const view = render(<VerificationTab />);
    expect(view.container.querySelector('.va-phase-cell-label')?.textContent).toBe(
      '7/10 · Financial checks',
    );
    expect(screen.queryByText(/hard stop/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
  });

  it('reserves a full page of height while loading, so the panel does not leap', () => {
    // `DataTable`'s table-mode loading state is a single message row, so without a reserved height
    // the panel stands ~90px tall and then jumps to a full page under the reader's cursor.
    const view = render(<VerificationTab />);
    const scroller = view.container.querySelector<HTMLElement>('.va-panel [style*="min-block-size"]');
    expect(scroller).toBeTruthy();
    expect(scroller!.style.minBlockSize).toBe('1027px');
  });
});

describe('routing surfaced on the card', () => {
  it('flags a WEX-routed application', () => {
    ready([row({ underwritingRoute: 'wex', fuelCardsRequested: 25 })]);
    render(<VerificationTab />);
    expect(screen.getByText(/WEX route/)).toBeInTheDocument();
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
    expect(dataRows()).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: /Incomplete/ }));
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText('Kaiser Freight LLC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /With Verification/ }));
    expect(screen.getByText('Ramirez Trucking')).toBeInTheDocument();
  });

  it('puts a pending-docs case under "Needs you", not "With Verification"', () => {
    ready([row({ verificationProcess: true, statusCode: 'pending_docs', boardColumn: 'needs_you', intakeMissing: [] })]);
    render(<VerificationTab />);
    fireEvent.click(screen.getByRole('tab', { name: /With Verification/ }));
    expect(dataRows()).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: /Needs you/ }));
    expect(dataRows()).toHaveLength(1);
  });
});

describe('opening an application', () => {
  it('opens the intake form for the row that was clicked', () => {
    ready([row({ id: 'vc_open' })]);
    render(<VerificationTab />);
    fireEvent.click(dataRows()[0]!);
    expect(screen.getByTestId('intake')).toHaveTextContent('vc_open');
  });

  /** The row is the control, so its accessible name has to carry the applicant. */
  it('names the applicant on the activatable row', () => {
    ready([row()]);
    render(<VerificationTab />);
    const rows = dataRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Kaiser Freight LLC');
  });

  it('falls back to a person’s name when there is no company', () => {
    ready([row({ companyName: null, firstName: 'Marisol', lastName: 'Otero', applicantType: 'owner_operator' })]);
    render(<VerificationTab />);
    expect(screen.getByText('Marisol Otero')).toBeInTheDocument();
  });
});
