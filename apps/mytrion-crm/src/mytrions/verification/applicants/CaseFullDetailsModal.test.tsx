/**
 * Full Details modal — open from the desk Record, save intake, manage attachments.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationDeskDetail, VerificationRailPhase } from '@/api/verificationFlow';

const patchDeskIntake = vi.fn();
const uploadDeskDocuments = vi.fn();
const openDocument = vi.fn();
const fetchDocumentBytes = vi.fn();
vi.mock('@/api/verificationFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationFlow')>();
  return {
    ...actual,
    patchDeskIntake,
    uploadDeskDocuments,
    openDocument,
    fetchDocumentBytes,
  };
});

const deleteDeskDocument = vi.fn();
const addDeskPrincipal = vi.fn();
const removeDeskPrincipal = vi.fn();
vi.mock('@/api/verificationDeskWrites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationDeskWrites')>();
  return { ...actual, deleteDeskDocument, addDeskPrincipal, removeDeskPrincipal };
});

const deliverExport = vi.fn();
vi.mock('@/lib/deliverExport', () => ({ deliverExport }));

const { CaseFullDetailsModal } = await import('./CaseFullDetailsModal');

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

function detail(over: Partial<VerificationDeskDetail['case']> = {}): VerificationDeskDetail {
  return {
    case: {
      id: 'vc_ridgevale01',
      companyName: 'Ridgevale Freight',
      firstName: null,
      lastName: null,
      email: 'ops@ridgevale.test',
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
      ...over,
    },
    rail: [phase()],
    principals: [
      {
        id: 'pr_1',
        fullName: 'Maria Okonkwo',
        role: null,
        ownershipPct: null,
        dateOfBirth: null,
        ssnLast4: null,
        phone: null,
        email: null,
        address: null,
      },
    ],
    documents: [
      {
        id: 'doc_1',
        docType: 'bank_statement',
        label: null,
        status: 'received',
        requestedInPhase: null,
        fileName: 'march.pdf',
        mime: 'application/pdf',
        sizeBytes: 12000,
        uploadedByName: 'Sales Agent',
        requestedAt: null,
        createdAt: '2026-08-16T10:00:00.000Z',
      },
    ],
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
  patchDeskIntake.mockReset();
  uploadDeskDocuments.mockReset();
  openDocument.mockReset();
  fetchDocumentBytes.mockReset();
  deleteDeskDocument.mockReset();
  addDeskPrincipal.mockReset();
  removeDeskPrincipal.mockReset();
  deliverExport.mockReset();
  patchDeskIntake.mockResolvedValue(detail());
  deleteDeskDocument.mockResolvedValue(detail());
  uploadDeskDocuments.mockResolvedValue(detail());
  openDocument.mockResolvedValue(undefined);
  fetchDocumentBytes.mockResolvedValue(new Blob(['pdf']));
  deliverExport.mockResolvedValue('downloaded');
});

describe('CaseFullDetailsModal', () => {
  it('loads every intake group and the attachments list', () => {
    render(
      <CaseFullDetailsModal
        open
        caseId="vc_ridgevale01"
        detail={detail()}
        wexCardCutoff={20}
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /full details/i });
    expect(within(dialog).getByText('Case ID')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Company')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('First name')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Trucks')).toBeInTheDocument();
    expect(within(dialog).getByText('Maria Okonkwo')).toBeInTheDocument();
    expect(within(dialog).getByText('march.pdf')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Preview march.pdf' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download march.pdf' })).toBeInTheDocument();
  });

  it('saves edited application fields through the desk intake PATCH', async () => {
    const onUpdated = vi.fn();
    render(
      <CaseFullDetailsModal
        open
        caseId="vc_ridgevale01"
        detail={detail()}
        wexCardCutoff={20}
        onClose={() => undefined}
        onUpdated={onUpdated}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /full details/i });
    fireEvent.change(within(dialog).getByLabelText('Company'), { target: { value: 'Ridgevale LLC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patchDeskIntake).toHaveBeenCalledWith(
        'vc_ridgevale01',
        expect.objectContaining({ companyName: 'Ridgevale LLC' }),
      ),
    );
    expect(onUpdated).toHaveBeenCalled();
  });

  it('previews, downloads, and removes an attachment after confirm', async () => {
    const onUpdated = vi.fn();
    render(
      <CaseFullDetailsModal
        open
        caseId="vc_ridgevale01"
        detail={detail()}
        wexCardCutoff={20}
        onClose={() => undefined}
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview march.pdf' }));
    await waitFor(() =>
      expect(openDocument).toHaveBeenCalledWith(
        'verification',
        'vc_ridgevale01',
        'doc_1',
        'march.pdf',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download march.pdf' }));
    await waitFor(() => expect(deliverExport).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Remove march.pdf' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() =>
      expect(deleteDeskDocument).toHaveBeenCalledWith('vc_ridgevale01', 'doc_1'),
    );
    expect(onUpdated).toHaveBeenCalled();
  });

  it('is read-only on a decided case', () => {
    render(
      <CaseFullDetailsModal
        open
        caseId="vc_ridgevale01"
        detail={detail({ closedAt: '2026-08-20T10:00:00.000Z', statusCode: 'approved' })}
        wexCardCutoff={20}
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /full details/i });
    expect(within(dialog).getByLabelText('Company')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Remove march.pdf' })).not.toBeInTheDocument();
  });
});
