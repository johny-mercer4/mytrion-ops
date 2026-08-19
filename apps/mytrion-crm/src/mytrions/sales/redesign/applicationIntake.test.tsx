/**
 * Sales intake case detail — the three defects that made the form unusable.
 *
 *  1. A required field stays red after the agent types into it, because "missing" was only the
 *     last server verdict. Typing is what the agent can see; the red has to follow that.
 *  2. Upload / remove called `adopt()` on the full payload and reseeds every input, so unsaved
 *     values vanished the moment a file landed.
 *  3. A single `pending` key locked the picker until the previous file finished.
 *
 * Completeness for Submit is still the server's. These tests only cover the Sales-side form.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationDetail, VerificationDocument, VerificationRailPhase } from '@/api/verificationFlow';
import { ApplicationIntake } from './applicationIntake';
import { DocumentsSection } from './applicationDocs';

vi.mock('./ctx', () => ({
  useSales: () => ({ pushToast: vi.fn() }),
}));

const api = vi.hoisted(() => ({
  getApplication: vi.fn(),
  getApplicationPrefill: vi.fn(),
  uploadApplicationDocuments: vi.fn(),
  deleteApplicationDocument: vi.fn(),
  patchApplication: vi.fn(),
  addPrincipal: vi.fn(),
  removePrincipal: vi.fn(),
  submitApplication: vi.fn(),
  createApplication: vi.fn(),
  openDocument: vi.fn(),
}));

vi.mock('@/api/verificationFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationFlow')>();
  return { ...actual, ...api };
});

function leftoverRequest(): VerificationDocument {
  return doc({
    id: 'req_ins',
    docType: 'insurance',
    status: 'requested',
    fileName: null,
    label: 'Certificate of insurance',
  });
}

function phase(over: Partial<VerificationRailPhase> = {}): VerificationRailPhase {
  return {
    code: 'p1_intake',
    label: 'Intake',
    order: 1,
    description: '',
    applies: true,
    skipReason: null,
    status: 'not_started',
    outcome: null,
    findings: {},
    note: null,
    decidedAt: null,
    decidedBy: null,
    ...over,
  };
}

function doc(over: Partial<VerificationDocument> = {}): VerificationDocument {
  return {
    id: 'doc_1',
    docType: 'insurance',
    label: 'Insurance',
    status: 'received',
    requestedInPhase: null,
    fileName: 'policy.pdf',
    mime: 'application/pdf',
    sizeBytes: 1200,
    uploadedByName: 'Agent',
    requestedAt: null,
    createdAt: '2026-08-18T10:00:00.000Z',
    ...over,
  };
}

function detail(over: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    case: {
      id: 'vc_case',
      companyName: 'Kaiser Freight LLC',
      firstName: null,
      lastName: null,
      email: '',
      phone: '',
      applicantType: 'carrier',
      ein: '',
      mc: '',
      dot: '',
      underwritingRoute: 'octane_internal',
      verificationProcess: false,
      phaseCode: 'p1_intake',
      statusCode: 'intake_incomplete',
      statusLabel: 'Incomplete application',
      boardColumn: 'draft',
      trucksCount: null,
      fuelCardsRequested: null,
      requestedLimit: null,
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
      dateOfBirth: '',
      ssnLast4: '',
      dlLast4: '',
      dlState: '',
      residentialAddress: '',
      businessAddress: '',
      bankingSource: 'statements',
    },
    principals: [],
    documents: [],
    intake: {
      complete: false,
      missing: [
        { field: 'ein', label: 'EIN', section: 'business' },
        { field: 'businessAddress', label: 'Business address', section: 'business' },
        { field: 'bankStatements', label: 'Bank statements', section: 'banking' },
      ],
    },
    phases: [
      phase(),
      phase({
        code: 'p4_authority',
        label: 'Authority',
        order: 4,
        applies: false,
        status: 'skipped',
        skipReason: 'Found in carrier records — long essay that must not appear.',
      }),
    ],
    underwritingRoute: 'octane_internal',
    reviewOrder: 'banking_first',
    ...over,
  };
}

beforeEach(() => {
  api.getApplication.mockReset();
  api.getApplicationPrefill.mockReset();
  api.uploadApplicationDocuments.mockReset();
  api.deleteApplicationDocument.mockReset();
  api.patchApplication.mockReset();
  api.getApplicationPrefill.mockResolvedValue({ match: null, suggestions: [] });
});

/**
 * Drive the applicant-type `ds/Select`.
 *
 * It is an `<input role="combobox" readOnly>` over a popup listbox, not a native `<select>` — so its
 * `value` is the option's LABEL and it is changed by opening it and clicking an option, never by
 * `fireEvent.change`. The native control it replaced painted the OS popup in the middle of the case
 * header; see the note in `applicationCaseHead.tsx`.
 */
function typeSelect(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Applicant type' }) as HTMLInputElement;
}

function pickType(label: string): void {
  // `pointerDown` on the shell is the disclosure toggle (`onShellPointerDown`), not a click on the
  // input — jsdom fires no pointer events from `click`, so the popup would never open.
  fireEvent.pointerDown(typeSelect().closest('[data-focus-shell]')!);
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('required-field red', () => {
  it('clears the error treatment once a required field has a value, and restores it when emptied', async () => {
    api.getApplication.mockResolvedValue(detail());
    render(<ApplicationIntake applicationId="vc_case" />);

    const ein = await screen.findByRole<HTMLInputElement>('textbox', { name: /EIN/ });
    expect(ein).toHaveAttribute('aria-invalid', 'true');
    expect(ein.labels?.[0]?.textContent).toMatch(/needed/);

    fireEvent.change(ein, { target: { value: '12-3456789' } });
    expect(ein).not.toHaveAttribute('aria-invalid');
    expect(ein.labels?.[0]?.textContent).not.toMatch(/needed/);

    fireEvent.change(ein, { target: { value: '   ' } });
    expect(ein).toHaveAttribute('aria-invalid', 'true');
    expect(ein.labels?.[0]?.textContent).toMatch(/needed/);
  });

  it('keeps an empty required field flagged', async () => {
    api.getApplication.mockResolvedValue(detail());
    render(<ApplicationIntake applicationId="vc_case" />);

    const address = await screen.findByRole('textbox', { name: /Business address/ });
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(address).toHaveValue('');
  });
});

describe('attachments stay off the form values', () => {
  it('does not wipe typed fields after an upload whose payload still has empty case data', async () => {
    const loaded = detail({ documents: [leftoverRequest()] });
    api.getApplication.mockResolvedValue(loaded);
    api.uploadApplicationDocuments.mockResolvedValue(
      detail({
        case: { ...loaded.case, ein: '', companyName: '' },
        documents: [doc()],
      }),
    );
    render(<ApplicationIntake applicationId="vc_case" />);

    const ein = await screen.findByRole('textbox', { name: /EIN/ });
    const company = screen.getByRole('textbox', { name: /Full legal company name/ });
    fireEvent.change(ein, { target: { value: '12-3456789' } });
    fireEvent.change(company, { target: { value: 'Kaiser Freight LLC' } });

    const picker = screen.getByLabelText('Choose documents to upload');
    const file = new File(['pdf-bytes'], 'policy.pdf', { type: 'application/pdf' });
    fireEvent.change(picker, { target: { files: [file] } });

    await waitFor(() => expect(api.uploadApplicationDocuments).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: /EIN/ })).toHaveValue('12-3456789');
    expect(screen.getByRole('textbox', { name: /Full legal company name/ })).toHaveValue(
      'Kaiser Freight LLC',
    );
    expect(await screen.findByText('policy.pdf')).toBeInTheDocument();
  });

  it('does not wipe typed fields after a remove whose payload still has empty case data', async () => {
    const loaded = detail({ documents: [doc()] });
    api.getApplication.mockResolvedValue(loaded);
    api.deleteApplicationDocument.mockResolvedValue(
      detail({
        case: { ...loaded.case, ein: '', companyName: '' },
        documents: [],
      }),
    );
    render(<ApplicationIntake applicationId="vc_case" />);

    const ein = await screen.findByRole('textbox', { name: /EIN/ });
    fireEvent.change(ein, { target: { value: '98-7654321' } });

    fireEvent.click(screen.getByRole('button', { name: /Remove policy\.pdf/i }));
    await waitFor(() => expect(api.deleteApplicationDocument).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: /EIN/ })).toHaveValue('98-7654321');
    expect(screen.queryByText('policy.pdf')).not.toBeInTheDocument();
  });
});

describe('multi-file does not lock the picker', () => {
  it('lets a second pick start while the first upload is still in flight', async () => {
    const loaded = detail({ documents: [leftoverRequest()] });
    api.getApplication.mockResolvedValue(loaded);

    let finishFirst: (value: ApplicationDetail) => void = () => undefined;
    api.uploadApplicationDocuments
      .mockImplementationOnce(
        () =>
          new Promise<ApplicationDetail>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(detail({ documents: [doc({ id: 'doc_2', fileName: 'two.pdf' })] }));

    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });

    const picker = screen.getByLabelText('Choose documents to upload');
    expect(picker).not.toBeDisabled();

    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'one.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(api.uploadApplicationDocuments).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Choose documents to upload')).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText('Choose documents to upload'), {
      target: { files: [new File(['b'], 'two.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(api.uploadApplicationDocuments).toHaveBeenCalledTimes(2));

    finishFirst(detail({ documents: [doc({ id: 'doc_1', fileName: 'one.pdf' })] }));
    expect(await screen.findByText('one.pdf')).toBeInTheDocument();
    expect(await screen.findByText('two.pdf')).toBeInTheDocument();
  });
});

describe('DocumentsSection picker', () => {
  it('stays enabled while a previous batch is uploading', () => {
    render(
      <DocumentsSection
        documents={[leftoverRequest()]}
        leftoverType="insurance"
        locked={false}
        uploading
        removingId={null}
        error={null}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Choose documents to upload')).not.toBeDisabled();
  });

  it('does not render a type dropdown', () => {
    render(
      <DocumentsSection
        documents={[leftoverRequest()]}
        leftoverType="insurance"
        locked={false}
        uploading={false}
        removingId={null}
        error={null}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByText('What is this document?')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('type and progress are single', () => {
  it('shows a compact type select, not the card pair, once type is set', async () => {
    api.getApplication.mockResolvedValue(detail());
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    expect(typeSelect()).toHaveValue('Carrier (Company)');
    expect(screen.queryByRole('radiogroup', { name: 'Applicant type' })).not.toBeInTheDocument();
    expect(screen.queryByText('What is this document?')).not.toBeInTheDocument();
  });

  it('reuses the underwriting-phases spine and drops skip essays', async () => {
    api.getApplication.mockResolvedValue(detail());
    render(<ApplicationIntake applicationId="vc_case" />);
    const spine = await screen.findByRole('region', { name: 'Underwriting phases' });
    expect(spine).toHaveTextContent('0 passed');
    expect(spine).toHaveTextContent('1 remaining');
    expect(spine).toHaveTextContent('1 not applicable');
    expect(screen.queryByText(/long essay/)).not.toBeInTheDocument();
  });
});

describe('type can change without wiping work', () => {
  it('keeps typed fields and attachments when Sales switches type', async () => {
    const loaded = detail({ documents: [doc()] });
    api.getApplication.mockResolvedValue(loaded);
    api.patchApplication.mockResolvedValue(
      detail({
        case: { ...loaded.case, applicantType: 'owner_operator', ein: '', companyName: '' },
        documents: loaded.documents,
      }),
    );
    render(<ApplicationIntake applicationId="vc_case" />);

    const ein = await screen.findByRole('textbox', { name: /EIN/ });
    const company = screen.getByRole('textbox', { name: /Full legal company name/ });
    fireEvent.change(ein, { target: { value: '12-3456789' } });
    fireEvent.change(company, { target: { value: 'Kaiser Freight LLC' } });
    expect(screen.getByText('policy.pdf')).toBeInTheDocument();

    pickType('Owner-Operator / Individual');
    await waitFor(() => expect(api.patchApplication).toHaveBeenCalledTimes(1));
    expect(api.patchApplication).toHaveBeenCalledWith('vc_case', {
      applicantType: 'owner_operator',
    });

    expect(await screen.findByRole('textbox', { name: /First name/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /EIN/ })).not.toBeInTheDocument();
    expect(screen.getByText('policy.pdf')).toBeInTheDocument();

    api.patchApplication.mockResolvedValueOnce(
      detail({ case: { ...loaded.case, applicantType: 'carrier' }, documents: loaded.documents }),
    );
    pickType('Carrier (Company)');
    await waitFor(() => expect(api.patchApplication).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: /EIN/ })).toHaveValue('12-3456789');
    expect(screen.getByRole('textbox', { name: /Full legal company name/ })).toHaveValue(
      'Kaiser Freight LLC',
    );
    expect(screen.getByText('policy.pdf')).toBeInTheDocument();
  });

  it('does not flip type when Use applies a carrier-record suggestion', async () => {
    const loaded = detail();
    api.getApplication.mockResolvedValue(loaded);
    api.getApplicationPrefill.mockResolvedValue({
      match: {
        matchedOn: 'phone',
        dotNumber: '4530242',
        ownerFullName: null,
        physicalAddress: '3972 MINK RD, EMMAUS, PA 18049',
        operatingStatus: 'AUTHORIZED FOR PROPERTY',
        authorityAddedOn: '2026-03-01',
      },
      suggestions: [
        { field: 'dot', label: 'USDOT number', value: '4530242' },
        { field: 'businessAddress', label: 'Business address', value: '3972 MINK RD, EMMAUS, PA 18049' },
      ],
    });
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[0]!);
    expect(typeSelect()).toHaveValue('Carrier (Company)');
    expect(api.patchApplication).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /USDOT/ })).toHaveValue('4530242');
  });

  it('does not claim company authority on an owner-operator case', async () => {
    api.getApplication.mockResolvedValue(
      detail({ case: { ...detail().case, applicantType: 'owner_operator' } }),
    );
    api.getApplicationPrefill.mockResolvedValue({
      match: {
        matchedOn: 'phone',
        dotNumber: '4530242',
        ownerFullName: null,
        physicalAddress: '3972 MINK RD, EMMAUS, PA 18049',
        operatingStatus: 'AUTHORIZED FOR PROPERTY',
        authorityAddedOn: '2026-03-01',
      },
      suggestions: [
        { field: 'dot', label: 'USDOT number', value: '4530242' },
        {
          field: 'residentialAddress',
          label: 'Residential address',
          value: '3972 MINK RD, EMMAUS, PA 18049',
        },
      ],
    });
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /First name/ });
    expect(screen.getByText('matched on phone number')).toBeInTheDocument();
    expect(screen.queryByText(/authority authorized/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorized for property/i)).not.toBeInTheDocument();
  });
});

/**
 * SUBMIT IS THE HANDOVER.
 *
 * The gate used to spare `pending_docs`, so the whole form reopened whenever the desk asked for a
 * file — an agent could retype the requested limit on a case a credit agent was already reading, and
 * the server refused the write only after they had done it. `assertSalesMayEdit` now closes at submit
 * and `assertSalesMayAttach` keeps uploads open; this is the browser half of that pair.
 */
describe('after submit, Sales cannot override the details', () => {
  const submitted = (statusCode: string) =>
    detail({
      case: {
        ...detail().case,
        verificationProcess: true,
        statusCode,
        statusLabel: statusCode === 'pending_docs' ? 'Pending docs' : 'In review',
        intakeMissing: [],
      },
      intake: { complete: true, missing: [] },
    });

  /**
   * EVERY field, counted — not three named ones.
   *
   * The first pass at this threaded `readOnly` onto each `Field` by hand and missed "Licence state",
   * the one field with no `missing` prop to sit beside. A spot-check on EIN and the limit passed and
   * the gap shipped; a sweep over the whole form is what actually holds.
   */
  it('makes every typed field read-only, with none missed', async () => {
    api.getApplication.mockResolvedValue(
      detail({
        case: {
          ...detail().case,
          applicantType: 'owner_operator',
          verificationProcess: true,
          statusCode: 'in_review',
          intakeMissing: [],
        },
        intake: { complete: true, missing: [] },
      }),
    );
    const view = render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /First name/ });
    const writable = [...view.container.querySelectorAll('input')].filter(
      (i) => !i.readOnly && i.type !== 'file',
    );
    expect(writable.map((i) => i.id)).toEqual([]);
    // …and the same for the owner-operator flow's sibling, the carrier form.
    expect(view.container.querySelectorAll('select:not([disabled])')).toHaveLength(0);
  });

  it('makes the carrier form’s fields read-only too', async () => {
    api.getApplication.mockResolvedValue(submitted('in_review'));
    const view = render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    expect(
      [...view.container.querySelectorAll('input')].filter((i) => !i.readOnly && i.type !== 'file'),
    ).toHaveLength(0);
  });

  /** Read-only ALSO in Pending Documents — the ask there is a file, not a second pass at the form. */
  it('keeps the fields read-only when Verification asks for a document', async () => {
    api.getApplication.mockResolvedValue(submitted('pending_docs'));
    render(<ApplicationIntake applicationId="vc_case" />);
    expect(await screen.findByRole('textbox', { name: /EIN/ })).toHaveAttribute('readonly');
  });

  /** But the document slots still take a file — that IS Pending Documents. */
  it('still lets the agent attach the document that was asked for', async () => {
    api.getApplication.mockResolvedValue(submitted('pending_docs'));
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    const pickers = screen.getAllByText('Choose file');
    expect(pickers.length).toBeGreaterThan(0);
  });

  it('drops the Save and Submit bar entirely', async () => {
    api.getApplication.mockResolvedValue(submitted('in_review'));
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    expect(screen.queryByRole('button', { name: /Save application/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit to Verification/ })).not.toBeInTheDocument();
  });

  /** The type is a fact once submitted, not a disabled combobox the agent keeps trying to use. */
  it('shows the applicant type as text rather than a control', async () => {
    api.getApplication.mockResolvedValue(submitted('in_review'));
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    expect(screen.queryByRole('combobox', { name: 'Applicant type' })).not.toBeInTheDocument();
    expect(screen.getByText('Carrier (Company)')).toBeInTheDocument();
  });

  it('says who can correct it instead of leaving the agent stuck', async () => {
    api.getApplication.mockResolvedValue(submitted('in_review'));
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    expect(screen.getByText(/ring the Verification desk/i)).toBeInTheDocument();
  });
});

/**
 * The drop target is the other door onto the same write.
 *
 * `Replace` and `Remove` vanish when the case is locked, but every slot row also accepts a drop — so a
 * drop on a slot that already held a file uploaded a second copy of it under the desk. Empty and
 * requested slots still take one; that is what Pending Documents asks for.
 */
describe('a handed-over slot takes nothing', () => {
  const withStatements = (received: number) =>
    detail({
      case: {
        ...detail().case,
        verificationProcess: true,
        statusCode: 'pending_docs',
        intakeMissing: [],
      },
      intake: { complete: true, missing: [] },
      documents: Array.from({ length: received }, (_, i) => ({
        id: `doc_s${i}`,
        docType: 'bank_statement' as const,
        label: `Statement ${i + 1}`,
        status: 'received' as const,
        requestedInPhase: null,
        fileName: `statement-${i + 1}.pdf`,
        mime: 'application/pdf',
        sizeBytes: 1024,
        uploadedByName: 'Test Agent',
        requestedAt: null,
        createdAt: '2026-08-15T09:00:00.000Z',
      })),
    });

  it('offers a picker on the empty slots only', async () => {
    api.getApplication.mockResolvedValue(withStatements(1));
    render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    // Three statement slots, one filled: two pickers, and the filled row offers neither
    // Replace nor Remove.
    expect(screen.getAllByText('Choose file')).toHaveLength(2);
    expect(screen.queryByText('Replace')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove statement-1\.pdf/ })).not.toBeInTheDocument();
  });

  it('disables the file input behind a slot that is already filled', async () => {
    api.getApplication.mockResolvedValue(withStatements(3));
    const view = render(<ApplicationIntake applicationId="vc_case" />);
    await screen.findByRole('textbox', { name: /EIN/ });
    const inputs = [...view.container.querySelectorAll<HTMLInputElement>('input[type=file]')];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.disabled)).toBe(true);
    expect(screen.queryByText('Choose file')).not.toBeInTheDocument();
  });
});
