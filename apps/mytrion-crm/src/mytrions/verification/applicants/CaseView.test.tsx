/**
 * The open case refetches on the same verification socket the inbox already uses.
 * Intake on this desk must expose Sales' fields, attach any file, and unlock Pass.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationDeskDetail, VerificationRailPhase } from '@/api/verificationFlow';

const getDeskCase = vi.fn();
const getPolicy = vi.fn();
const patchDeskIntake = vi.fn();
const uploadDeskDocuments = vi.fn();
const decidePhase = vi.fn();
const requestDocuments = vi.fn();
const reopenPhase = vi.fn();
vi.mock('@/api/verificationFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationFlow')>();
  return {
    ...actual,
    getDeskCase,
    getPolicy,
    patchDeskIntake,
    uploadDeskDocuments,
    decidePhase,
    requestDocuments,
    reopenPhase,
  };
});

const getDeskBrokerSnapshot = vi.fn();
vi.mock('@/api/verificationDeskWrites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationDeskWrites')>();
  return { ...actual, getDeskBrokerSnapshot };
});

let onInboxEvent: ((event: { tag: string | null; type: string; detail?: string | null }) => void) | undefined;
vi.mock('../../sales/redesign/useOctaneRealtime', () => ({
  useOctaneRealtime: (opts: { onInboxEvent?: typeof onInboxEvent }) => {
    onInboxEvent = opts.onInboxEvent;
  },
}));

const { CaseView } = await import('./CaseView');

function phase(over: Partial<VerificationRailPhase> = {}): VerificationRailPhase {
  return {
    code: 'p2_identity',
    label: 'Identity',
    order: 2,
    description: '',
    applies: true,
    skipReason: null,
    status: 'in_progress',
    outcome: null,
    findings: {},
    note: null,
    decidedAt: null,
    decidedBy: null,
    ...over,
  };
}

function desk(): VerificationDeskDetail {
  return {
    case: {
      id: 'vc_ridgevale01',
      companyName: 'Ridgevale Freight',
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      applicantType: 'carrier',
      ein: '12-3456789',
      mc: '123456',
      dot: '987654',
      underwritingRoute: 'octane_internal',
      verificationProcess: true,
      phaseCode: 'p2_identity',
      statusCode: 'in_review',
      trucksCount: 4,
      fuelCardsRequested: 4,
      requestedLimit: '5000',
      approvedLimitAmount: null,
      intakeMissing: [],
      submittedAt: '2026-08-18T10:00:00.000Z',
      ownerName: 'Credit Agent',
      ownerZohoUserId: 'credit-42',
      zohoOwnerId: 'sales-7',
      zohoOwnerName: 'Sales Agent',
      closedAt: null,
      createdAt: '2026-08-14T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    },
    rail: [phase()],
    principals: [],
    documents: [],
    events: [],
    screening: {
      hits: [],
      summary: { blacklistConfirmed: false, duplicateConfirmed: false, unresolved: 0, clear: true },
    },
    credit: null,
    banking: null,
    risk: null,
    hardStops: { passed: true, triggered: [], outcome: 'clear' },
    indicators: [],
    routing: {
      underwritingRoute: 'octane_internal',
      reviewOrder: 'banking_first',
      bankFirstTruckMin: 5,
      wexCardCutoff: 20,
    },
    policy: {
      strongFactor: null,
      moderateFactor: null,
      weakFactor: null,
      tierPriceable: { strong: true, moderate: true, weak: false },
    },
  };
}

beforeEach(() => {
  onInboxEvent = undefined;
  getDeskCase.mockReset();
  getPolicy.mockReset();
  patchDeskIntake.mockReset();
  uploadDeskDocuments.mockReset();
  decidePhase.mockReset();
  requestDocuments.mockReset();
  getDeskBrokerSnapshot.mockReset();
  getDeskBrokerSnapshot.mockResolvedValue({ match: null });
  getDeskCase.mockResolvedValue(desk());
  getPolicy.mockResolvedValue({
    nsfReviewThreshold: 3,
    wexCardCutoff: 20,
    verificationOwner: { name: 'Credit Agent' },
  });
});

describe('CaseView live refresh', () => {
  it('refetches on a verification socket event for this case, and ignores everyone else’s', async () => {
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    await waitFor(() => expect(getDeskCase).toHaveBeenCalledTimes(1));
    expect(onInboxEvent).toBeTypeOf('function');

    onInboxEvent?.({ tag: 'retention', type: 'retention.claim_request' });
    await new Promise((r) => setTimeout(r, 20));
    expect(getDeskCase).toHaveBeenCalledTimes(1);

    onInboxEvent?.({
      tag: 'verification',
      type: 'verification.application.documents_uploaded',
      detail: 'caseId=vc_other',
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(getDeskCase).toHaveBeenCalledTimes(1);

    onInboxEvent?.({
      tag: 'verification',
      type: 'verification.application.documents_uploaded',
      detail: 'caseId=vc_ridgevale01',
    });
    await waitFor(() => expect(getDeskCase).toHaveBeenCalledTimes(2));
  });
});

function intakeDesk(over: Partial<VerificationDeskDetail['case']> = {}): VerificationDeskDetail {
  const base = desk();
  return {
    ...base,
    case: {
      ...base.case,
      verificationProcess: false,
      statusCode: 'intake_incomplete',
      phaseCode: 'p1_intake',
      intakeMissing: ['dateOfBirth', 'residentialAddress', 'businessAddress', 'bankStatements'],
      dateOfBirth: null,
      residentialAddress: null,
      businessAddress: null,
      ...over,
    },
    rail: [
      phase({
        code: 'p1_intake',
        label: 'Intake',
        order: 1,
        status: 'in_progress',
        description: 'Applicant type, full application, documents.',
      }),
    ],
  };
}

describe('CaseView intake writes', () => {
  it('lets the desk edit a Sales intake field that used to be hidden', async () => {
    getDeskCase.mockResolvedValue(intakeDesk());
    const unlocked = intakeDesk({
      verificationProcess: true,
      statusCode: 'intake_submitted',
      intakeMissing: [],
      dateOfBirth: '1990-04-12',
    });
    patchDeskIntake.mockResolvedValue(unlocked);
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    const dob = await screen.findByLabelText('Date of birth');
    expect(screen.getByLabelText('Residential address')).toBeInTheDocument();
    expect(screen.getByLabelText('Business address')).toBeInTheDocument();
    fireEvent.change(dob, { target: { value: '1990-04-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() =>
      expect(patchDeskIntake).toHaveBeenCalledWith(
        'vc_ridgevale01',
        expect.objectContaining({ dateOfBirth: '1990-04-12' }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Pass phase' })).toBeEnabled();
  });

  it('attaches an arbitrary file from the desk Documents aside', async () => {
    getDeskCase.mockResolvedValue(intakeDesk());
    uploadDeskDocuments.mockResolvedValue(intakeDesk());
    const { container } = render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByLabelText('Date of birth');
    expect(screen.getByRole('combobox', { name: 'Attach as' })).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    const file = new File(['scan'], 'extra.pdf', { type: 'application/pdf' });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() =>
      expect(uploadDeskDocuments).toHaveBeenCalledWith('vc_ridgevale01', [file], {
        docType: 'other',
      }),
    );
  });

  /**
   * THE TYPE THE SELECT SAYS, not the default.
   *
   * Choosing a file uploads it immediately with whatever `attachType` currently holds, and the picker
   * used to sit ABOVE its type select — so a reviewer working down the panel in reading order filed
   * every document as "Something else" and then had to ask Sales to re-upload it. The select now comes
   * first and the button names the choice; this is the assertion that the choice is actually carried.
   */
  it('attaches under the type the reviewer picked', async () => {
    getDeskCase.mockResolvedValue(intakeDesk());
    uploadDeskDocuments.mockResolvedValue(intakeDesk());
    const { container } = render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByLabelText('Date of birth');

    fireEvent.pointerDown(
      screen.getByRole('combobox', { name: 'Attach as' }).closest('[data-focus-shell]')!,
    );
    fireEvent.click(screen.getByRole('option', { name: 'Bank statement' }));
    // The control names what it will do, so the choice is visible without reopening the select.
    expect(screen.getByText('Attach bank statement')).toBeInTheDocument();

    const file = new File(['scan'], 'march.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() =>
      expect(uploadDeskDocuments).toHaveBeenCalledWith('vc_ridgevale01', [file], {
        docType: 'bank_statement',
      }),
    );
  });
});

describe('CaseView phase decisions', () => {
  it('hides Pass / manager / Decline once the open phase is already passed', async () => {
    getDeskCase.mockResolvedValue({
      ...desk(),
      rail: [phase({ status: 'passed' })],
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to manager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    expect(screen.getByText('This phase is signed off.')).toBeInTheDocument();
  });

  it('hides the same actions when the case has moved past the spine step', async () => {
    getDeskCase.mockResolvedValue({
      ...desk(),
      case: { ...desk().case, phaseCode: 'p3_screening' },
      rail: [
        phase({ status: 'passed' }),
        phase({
          code: 'p3_screening',
          label: 'Screening',
          order: 3,
          status: 'in_progress',
        }),
      ],
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    fireEvent.click(screen.getByRole('button', { name: /Identity/ }));
    await screen.findByText(/No warehouse match|This phase is signed off/);
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('shows the carrier checklist and keeps Pass disabled until every check is OK', async () => {
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    expect(screen.getAllByText('Legal company name and EIN').length).toBeGreaterThan(0);
    expect(screen.queryByText("Driver's licence")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
    for (const btn of screen.getAllByRole('radio', { name: 'OK' })) {
      fireEvent.click(btn);
    }
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeEnabled();
  });

  it('asks Sales for documents through the existing request path when a check is missing', async () => {
    requestDocuments.mockResolvedValue(desk());
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    fireEvent.click(screen.getAllByRole('radio', { name: 'Missing' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Pending documents' }));
    await waitFor(() =>
      expect(requestDocuments).toHaveBeenCalledWith('vc_ridgevale01', {
        phaseCode: 'p2_identity',
        items: [{ docType: 'other', label: 'Company / EIN documentation' }],
      }),
    );
  });

  it('shows the owner-operator checklist instead of the carrier one', async () => {
    getDeskCase.mockResolvedValue({
      ...desk(),
      case: { ...desk().case, applicantType: 'owner_operator', firstName: 'Ada', lastName: 'Cole' },
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    expect((await screen.findAllByText("Driver's licence")).length).toBeGreaterThan(0);
    expect(screen.getAllByText('SSN documentation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Legal company name and EIN')).not.toBeInTheDocument();
  });
});

function screeningDesk(
  over: Partial<VerificationDeskDetail['case']> = {},
): VerificationDeskDetail {
  const base = desk();
  return {
    ...base,
    case: { ...base.case, phaseCode: 'p3_screening', ...over },
    rail: [
      phase({ status: 'passed' }),
      phase({ code: 'p3_screening', label: 'Screening', order: 3, status: 'in_progress' }),
    ],
  };
}

describe('CaseView Phase 3 screening', () => {
  it('shows carrier identity facts and keeps Pass disabled until both checks are clear', async () => {
    getDeskCase.mockResolvedValue(screeningDesk());
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    /**
     * ONE facts block, not two. The pane printed the same eight identifiers in both check columns —
     * eight facts read twice to notice they are identical. They are a label/value grid now, stated once
     * above the two verdicts, so the label and the value are separate elements and `EIN:` with its old
     * colon no longer exists.
     */
    // Scoped to the `.va-recorded` block, not to the heading's own row: the heading now shares a
    // `.va-pane-head` with the Run Check A button, and the case HEADER carries an `EIN` fact of its own.
    const facts = screen
      .getByText('Identifiers to compare')
      .closest<HTMLElement>('.va-recorded')!;
    expect(within(facts).getAllByText('Name / owner / principals')).toHaveLength(1);
    expect(within(facts).getAllByText('EIN')).toHaveLength(1);
    expect(within(facts).getByText('12-3456789')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'No match' }));
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'No duplicate' }));
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeEnabled();
  });

  it('shows owner-operator name and SSN rather than company principals', async () => {
    getDeskCase.mockResolvedValue(
      screeningDesk({
        applicantType: 'owner_operator',
        companyName: null,
        firstName: 'Ada',
        lastName: 'Cole',
        ssnLast4: '7788',
        residentialAddress: '1 Oak St',
      }),
    );
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ada Cole' });
    expect(screen.getAllByText(/SSN last 4/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Residential address/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Name \/ owner \/ principals/)).not.toBeInTheDocument();
  });

  it('sends a confirmed blacklist through Decline as decline_blacklist', async () => {
    const row = screeningDesk();
    getDeskCase.mockResolvedValue(row);
    decidePhase.mockResolvedValue(row);
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    fireEvent.click(screen.getByRole('radio', { name: 'Confirmed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(decidePhase).toHaveBeenCalledWith('vc_ridgevale01', 'p3_screening', {
        outcome: 'decline_blacklist',
      }),
    );
  });

  it('sends a duplicate to the existing manager path', async () => {
    const row = screeningDesk();
    getDeskCase.mockResolvedValue(row);
    decidePhase.mockResolvedValue(row);
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    fireEvent.click(screen.getByRole('radio', { name: 'Duplicate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to manager' }));
    await waitFor(() =>
      expect(decidePhase).toHaveBeenCalledWith('vc_ridgevale01', 'p3_screening', {
        outcome: 'manager_review',
      }),
    );
  });

  it('hides Pass / manager / Decline once Phase 3 is passed', async () => {
    getDeskCase.mockResolvedValue({
      ...screeningDesk(),
      rail: [
        phase({ status: 'passed' }),
        phase({ code: 'p3_screening', label: 'Screening', order: 3, status: 'passed' }),
      ],
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to manager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });
});

function authorityDesk(
  over: Partial<VerificationDeskDetail['case']> = {},
  railOver: Partial<VerificationRailPhase> = {},
): VerificationDeskDetail {
  const base = desk();
  return {
    ...base,
    case: { ...base.case, phaseCode: 'p4_authority', ...over },
    rail: [
      phase({ status: 'passed' }),
      phase({
        code: 'p4_authority',
        label: 'Authority',
        order: 4,
        status: 'in_progress',
        applies: true,
        ...railOver,
      }),
    ],
  };
}

describe('CaseView Phase 4 authority', () => {
  it('skips the working pane and decision buttons for an owner-operator', async () => {
    getDeskCase.mockResolvedValue(
      authorityDesk(
        {
          applicantType: 'owner_operator',
          companyName: null,
          firstName: 'Ada',
          lastName: 'Cole',
        },
        {
          applies: false,
          status: 'skipped',
          skipReason: 'Not applicable — owner-operator has no MC/DOT authority to verify.',
        },
      ),
    );
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByText('Not applicable to this applicant');
    expect(screen.getByText(/owner-operator has no MC\/DOT authority/)).toBeInTheDocument();
    expect(screen.getByLabelText('Applicant type')).toBeInTheDocument();
    expect(screen.getByLabelText('MC number')).toBeInTheDocument();
    expect(screen.getByLabelText('USDOT')).toBeInTheDocument();
    expect(screen.queryByText('MC status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('patches type and MC/DOT from the N/A fallback so the phase can apply', async () => {
    getDeskCase.mockResolvedValue(
      authorityDesk(
        {
          applicantType: 'owner_operator',
          companyName: null,
          firstName: 'Ada',
          lastName: 'Cole',
          mc: null,
          dot: null,
        },
        {
          applies: false,
          status: 'skipped',
          skipReason: 'Not applicable — owner-operator has no MC/DOT authority to verify.',
        },
      ),
    );
    patchDeskIntake.mockResolvedValue(
      authorityDesk(
        { applicantType: 'carrier', firstName: 'Ada', lastName: 'Cole', mc: '123456', dot: '987654' },
        { applies: true, status: 'not_started' },
      ),
    );
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByText('Not applicable to this applicant');
    fireEvent.change(screen.getByLabelText('MC number'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('USDOT'), { target: { value: '987654' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Applicant type' }), {
      target: { value: 'carrier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() =>
      expect(patchDeskIntake).toHaveBeenCalledWith(
        'vc_ridgevale01',
        expect.objectContaining({ applicantType: 'carrier', mc: '123456', dot: '987654' }),
      ),
    );
    expect((await screen.findAllByText('MC status')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
  });

  it('does not apply Phase 4 when MC/DOT are filled but the type stays owner-operator', async () => {
    const skipped = {
      applies: false,
      status: 'skipped' as const,
      skipReason: 'Not applicable — owner-operator has no MC/DOT authority to verify.',
    };
    getDeskCase.mockResolvedValue(
      authorityDesk(
        {
          applicantType: 'owner_operator',
          companyName: null,
          firstName: 'Ada',
          lastName: 'Cole',
          mc: null,
          dot: null,
        },
        skipped,
      ),
    );
    patchDeskIntake.mockResolvedValue(
      authorityDesk(
        { applicantType: 'owner_operator', firstName: 'Ada', lastName: 'Cole', mc: '123456', dot: '987654' },
        skipped,
      ),
    );
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByText('Not applicable to this applicant');
    fireEvent.change(screen.getByLabelText('MC number'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('USDOT'), { target: { value: '987654' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() =>
      expect(patchDeskIntake).toHaveBeenCalledWith(
        'vc_ridgevale01',
        expect.objectContaining({ applicantType: 'owner_operator', mc: '123456', dot: '987654' }),
      ),
    );
    expect(screen.getByText('Not applicable to this applicant')).toBeInTheDocument();
    expect(screen.queryByText('MC status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
  });

  it('shows the carrier checklist and keeps Pass disabled until authority is verified', async () => {
    getDeskCase.mockResolvedValue(authorityDesk());
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    expect(screen.getAllByText('MC status').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Operating authority').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
    /**
     * SIX checks now, not five. "Authority age" was the one item on the SOP's Phase 4 list with no
     * check of its own, so a reviewer had nowhere to record it and Phase 9 — which reads authority age
     * for the risk tier — had nothing to inherit. And they are `radiogroup`s now: mutually exclusive
     * verdicts, sharing Phase 2's control.
     */
    for (const label of [
      'MC status',
      'USDOT status',
      'Operating authority',
      'Insurance status',
      'Operating history',
      'Authority age',
    ]) {
      const group = screen.getByRole('radiogroup', { name: label });
      fireEvent.click(within(group).getByRole('radio', { name: 'OK' }));
    }
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeEnabled();
  });

  it('asks Sales for documents when an authority check is missing', async () => {
    const row = authorityDesk();
    getDeskCase.mockResolvedValue(row);
    requestDocuments.mockResolvedValue(row);
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    const insurance = screen.getByRole('radiogroup', { name: 'Insurance status' });
    fireEvent.click(within(insurance).getByRole('radio', { name: 'Missing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending documents' }));
    await waitFor(() =>
      expect(requestDocuments).toHaveBeenCalledWith('vc_ridgevale01', {
        phaseCode: 'p4_authority',
        items: [{ docType: 'insurance', label: 'Insurance certificate' }],
      }),
    );
  });

  it('hides Pass / manager / Decline once Phase 4 is passed', async () => {
    getDeskCase.mockResolvedValue(
      authorityDesk({}, { status: 'passed' }),
    );
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to manager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });
});

function routingDesk(
  over: Partial<VerificationDeskDetail['case']> = {},
  railOver: Partial<VerificationRailPhase> = {},
): VerificationDeskDetail {
  const base = desk();
  return {
    ...base,
    case: { ...base.case, phaseCode: 'p5_routing', trucksCount: 12, ...over },
    rail: [
      phase({
        code: 'p5_routing',
        label: 'Routing',
        order: 5,
        status: 'in_progress',
        applies: true,
        ...railOver,
      }),
    ],
  };
}

function creditDesk(
  over: Partial<VerificationDeskDetail['case']> = {},
  rail: VerificationRailPhase[] = [],
): VerificationDeskDetail {
  const base = desk();
  return {
    ...base,
    case: { ...base.case, phaseCode: 'p6_credit_banking', ...over },
    rail:
      rail.length > 0
        ? rail
        : [
            phase({
              code: 'p6_credit_banking',
              label: 'Credit & banking',
              order: 6,
              status: 'in_progress',
            }),
          ],
  };
}

describe('CaseView Phase 5 routing', () => {
  it('shows banking-first for a 10+ truck carrier and stores that order on Pass', async () => {
    getDeskCase.mockResolvedValue(routingDesk());
    decidePhase.mockResolvedValue(routingDesk({}, { status: 'passed' }));
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    expect(await screen.findByText('Banking → Credit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pass phase' }));
    await waitFor(() =>
      expect(decidePhase).toHaveBeenCalledWith(
        'vc_ridgevale01',
        'p5_routing',
        expect.objectContaining({
          outcome: 'pass',
          findings: { reviewOrder: 'banking_first' },
        }),
      ),
    );
  });

  it('shows credit-first for an owner-operator and for a carrier under 10 trucks', async () => {
    getDeskCase.mockResolvedValue(routingDesk({ applicantType: 'owner_operator', trucksCount: 25 }));
    const { unmount } = render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    expect(await screen.findByText('Credit → Banking')).toBeInTheDocument();
    unmount();
    getDeskCase.mockResolvedValue(routingDesk({ applicantType: 'carrier', trucksCount: 9 }));
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    expect(await screen.findByText('Credit → Banking')).toBeInTheDocument();
  });

  it('assumes credit-first when trucks are missing and does not invent 10', async () => {
    getDeskCase.mockResolvedValue(routingDesk({ applicantType: 'carrier', trucksCount: null }));
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    expect(await screen.findByText('Credit → Banking')).toBeInTheDocument();
    expect(screen.getByText(/treated as fewer than 10/)).toBeInTheDocument();
  });

  it('patches type and truck count from the routing pane', async () => {
    getDeskCase.mockResolvedValue(routingDesk({ trucksCount: null }));
    patchDeskIntake.mockResolvedValue(routingDesk({ trucksCount: 12 }));
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByText('Credit → Banking');
    fireEvent.change(screen.getByLabelText('Trucks'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() =>
      expect(patchDeskIntake).toHaveBeenCalledWith(
        'vc_ridgevale01',
        expect.objectContaining({ applicantType: 'carrier', trucksCount: 12 }),
      ),
    );
  });

  it('hides Pass once Routing is passed', async () => {
    getDeskCase.mockResolvedValue(routingDesk({}, { status: 'passed' }));
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('heading', { name: 'Ridgevale Freight' });
    expect(screen.queryByRole('button', { name: 'Pass phase' })).not.toBeInTheDocument();
  });
});

describe('CaseView Phase 6 credit and banking', () => {
  it('renders banking before credit when Phase 5 stored banking-first', async () => {
    getDeskCase.mockResolvedValue(
      creditDesk({ trucksCount: 4 }, [
        phase({
          code: 'p5_routing',
          label: 'Routing',
          order: 5,
          status: 'passed',
          findings: { reviewOrder: 'banking_first' },
        }),
        phase({
          code: 'p6_credit_banking',
          label: 'Credit & banking',
          order: 6,
          status: 'in_progress',
        }),
      ]),
    );
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    expect(await screen.findByText(/Banking → Credit/)).toBeInTheDocument();
    expect(screen.getByText(/confirmed in Routing/)).toBeInTheDocument();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((n) => n.textContent);
    expect(titles.indexOf('Banking review — last 3 months')).toBeLessThan(
      titles.indexOf('Credit report review'),
    );
  });

  it('keeps Pass off until credit is strong/acceptable and banking has no missing rows', async () => {
    getDeskCase.mockResolvedValue(creditDesk());
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('group', { name: 'Credit profile result' });
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Strong' }));
    for (const check of screen.getAllByRole('group').filter((g) => g.getAttribute('aria-label') !== 'Credit profile result')) {
      fireEvent.click(within(check).getByRole('button', { name: 'OK' }));
    }
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeEnabled();
  });

  it('sends borderline to the manager and unacceptable to deposit/prepaid', async () => {
    getDeskCase.mockResolvedValue(creditDesk());
    decidePhase.mockResolvedValue(creditDesk());
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    await screen.findByRole('group', { name: 'Credit profile result' });
    fireEvent.click(screen.getByRole('button', { name: 'Borderline / Mixed' }));
    expect(screen.getByRole('button', { name: 'Pass phase' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Unacceptable' }));
    expect(screen.getByRole('button', { name: 'Deposit / prepaid' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deposit / prepaid' }));
    await waitFor(() =>
      expect(decidePhase).toHaveBeenCalledWith(
        'vc_ridgevale01',
        'p6_credit_banking',
        expect.objectContaining({ outcome: 'deposit_prepaid' }),
      ),
    );
  });

  it('asks Sales for statements when a banking row is missing', async () => {
    getDeskCase.mockResolvedValue(creditDesk());
    requestDocuments.mockResolvedValue(creditDesk());
    render(<CaseView caseId="vc_ridgevale01" onBack={() => undefined} />);
    const ownership = await screen.findByRole('group', {
      name: 'Account ownership — applicant/company name and address',
    });
    fireEvent.click(within(ownership).getByRole('button', { name: 'Missing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending documents' }));
    await waitFor(() =>
      expect(requestDocuments).toHaveBeenCalledWith('vc_ridgevale01', {
        phaseCode: 'p6_credit_banking',
        items: [{ docType: 'bank_statement', label: 'Bank statements (last 3 months)' }],
      }),
    );
  });
});

/**
 * REOPENING A PHASE — the desk's way back, and the rules about where the control appears.
 *
 * The rail only ever moved forward, so a phase signed off on the wrong reading had no remedy short of a
 * database edit. The control is deliberately narrow: there must be a verdict to withdraw, and the case
 * must still be open. The server enforces the same three guards (`verification-desk-reopen.test.ts`);
 * this is the half that decides whether the agent is offered the button at all.
 */
describe('reopening a phase', () => {
  const railOf = (status: VerificationRailPhase['status']) => [
    phase({ code: 'p1_intake', label: 'Application Intake', order: 1, status: 'passed' }),
    phase({ code: 'p2_identity', label: 'Identity', order: 2, status }),
    phase({ code: 'p3_screening', label: 'Screening', order: 3, status: 'not_started' }),
  ];

  beforeEach(() => {
    reopenPhase.mockReset();
    getPolicy.mockResolvedValue({ wexCardCutoff: 20 });
  });

  it('offers Reopen on a phase this case has passed', async () => {
    getDeskCase.mockResolvedValue({ ...desk(), rail: railOf('passed') });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('offers nothing on a phase with no verdict to withdraw', async () => {
    getDeskCase.mockResolvedValue({ ...desk(), rail: railOf('not_started') });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    await screen.findByRole('heading', { name: 'Identity' });
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  it('offers nothing once the case is decided', async () => {
    const base = desk();
    getDeskCase.mockResolvedValue({
      ...base,
      case: { ...base.case, statusCode: 'approved', closedAt: '2026-08-19T09:00:00.000Z' },
      rail: railOf('passed'),
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    await screen.findByRole('heading', { name: 'Identity' });
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  /**
   * The dialog exists BECAUSE a reason is required — and it has to say what reopening costs, because
   * everything downstream is un-decided too. A bare confirm would hide both.
   */
  it('requires a reason, and says what it costs before taking one', async () => {
    getDeskCase.mockResolvedValue({ ...desk(), rail: railOf('passed') });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));

    expect(screen.getByRole('heading', { name: /Reopen Identity/ })).toBeInTheDocument();
    // One applicable phase sits after Identity in this rail.
    expect(screen.getByText(/1 phase after it/)).toBeInTheDocument();
    expect(screen.getByText(/Findings already recorded stay/)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Reopen phase' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Why is it being reopened?'), {
      target: { value: 'Licence belonged to a different person' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(reopenPhase).toHaveBeenCalledWith('vc_ridgevale01', 'p2_identity', {
        reason: 'Licence belonged to a different person',
      }),
    );
  });
});

/**
 * STAGE 1 (Intake) and STAGE 2 (Identity) — the pane structure and the verdict control.
 *
 * The three defects here were all "the screen says something that is not true": a documents sentence
 * rendered inside the Owners / principals block so it read as a principals requirement, an Owners /
 * principals section on owner-operator cases where the server never asks for one, and a verdict control
 * whose three verdicts looked identical.
 */
describe('Phase 1 — the intake pane', () => {
  beforeEach(() => {
    getPolicy.mockResolvedValue({ wexCardCutoff: 20 });
  });

  const intakeRail = [phase({ code: 'p1_intake', label: 'Application Intake', order: 1, status: 'in_progress' })];

  /**
   * `evaluateIntakeCompleteness` requires a principal on the CARRIER flow only — an owner-operator IS
   * the person, so there is nobody else to name. Sales' own form has always hidden it there.
   */
  it('hides Owners / principals on an owner-operator case', async () => {
    const base = desk();
    getDeskCase.mockResolvedValue({
      ...base,
      case: { ...base.case, applicantType: 'owner_operator', phaseCode: 'p1_intake' },
      rail: intakeRail,
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    await screen.findByRole('textbox', { name: 'First name' });
    expect(screen.queryByText('Owners / principals')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Owner or principal full name')).not.toBeInTheDocument();
  });

  it('keeps it on a carrier case, where the server asks for one', async () => {
    const base = desk();
    getDeskCase.mockResolvedValue({
      ...base,
      case: { ...base.case, applicantType: 'carrier', phaseCode: 'p1_intake' },
      rail: intakeRail,
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    expect(await screen.findByText('Owners / principals')).toBeInTheDocument();
  });

  /**
   * The sentence is about DOCUMENTS. It used to render bare, straight after the principals list, so
   * "Still needed as files: Bank statements" read as a requirement of the section it sat inside.
   */
  it('gives the outstanding-files sentence its own heading', async () => {
    const base = desk();
    getDeskCase.mockResolvedValue({
      ...base,
      case: { ...base.case, applicantType: 'carrier', phaseCode: 'p1_intake', intakeMissing: ['bankStatements'] },
      rail: intakeRail,
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    const heading = await screen.findByText('Still needed as files');
    expect(heading).toBeInTheDocument();
    // And the sentence lives under THAT heading, not under the principals one.
    expect(heading.parentElement).toHaveTextContent(/Bank statements/);
  });

  /** Every column stays reachable — a case whose type was set wrong at ingest has to be correctable. */
  it('keeps both flows’ columns editable, grouped and labelled', async () => {
    const base = desk();
    getDeskCase.mockResolvedValue({
      ...base,
      case: { ...base.case, applicantType: 'owner_operator', phaseCode: 'p1_intake' },
      rail: intakeRail,
    });
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    await screen.findByRole('textbox', { name: 'First name' });
    // The other flow's fields are present, and the group says it is not required here.
    expect(screen.getByRole('textbox', { name: 'Company' })).toBeEnabled();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText(/Not required for an owner-operator/)).toBeInTheDocument();
  });
});

describe('Phase 2 — the verdict control and What to check', () => {
  const idRail = [phase({ code: 'p2_identity', label: 'Identity', order: 2, status: 'in_progress' })];

  beforeEach(() => {
    getPolicy.mockResolvedValue({ wexCardCutoff: 20 });
    const base = desk();
    getDeskCase.mockResolvedValue({
      ...base,
      case: { ...base.case, applicantType: 'owner_operator', phaseCode: 'p2_identity' },
      rail: idRail,
    });
  });

  /**
   * A radio GROUP, not three toggles. These are mutually exclusive verdicts; `aria-pressed` on three
   * buttons announces three independent switches, which is a different control from the one they mean.
   */
  it('is a radio group with exactly one verdict selected', async () => {
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    // BY ITS LABEL, not by index: `ReviewPanes` declares radiogroups of its own ("Risk tier", "Final
    // decision"), so `[0]` is not reliably a verdict control.
    const group = await screen.findByRole('radiogroup', { name: 'Full name' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    // `queryAll`, not `getAll`: nothing is checked yet, and `getAllByRole` throws on zero matches.
    expect(within(group).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    fireEvent.click(within(group).getByRole('radio', { name: 'OK' }));
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  /** The aside used to light up all at once when the phase passed. Now it follows the marks. */
  it('moves What to check as the reviewer marks each row', async () => {
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    await screen.findAllByRole('radiogroup');
    const aside = screen.getByRole('heading', { name: 'What to check' }).closest('section')!;
    expect(within(aside).getByText('0 of 7')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('radio', { name: 'OK' })[0]!);
    expect(within(aside).getByText('1 of 7')).toBeInTheDocument();

    // `attention` outranks the count — it is the thing the reviewer has to come back to.
    fireEvent.click(screen.getAllByRole('radio', { name: 'Missing' })[1]!);
    expect(within(aside).getByText('1 needs work')).toBeInTheDocument();
    expect(within(aside).getByText(/request the document/i)).toBeInTheDocument();
  });

  it('says the ticks follow the marks, not the clock', async () => {
    render(<CaseView caseId="vc_ridgevale01" onBack={() => {}} />);
    await screen.findAllByRole('radiogroup');
    expect(screen.getByText(/Follows the marks you set beside each check/)).toBeInTheDocument();
  });
});
