import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineSnapshot, VerificationClient, VerificationClientPage } from '@/api/verification';
import { VerificationTab } from './VerificationTab';

const state = vi.hoisted(() => ({
  current: {
    data: null as VerificationClientPage | null,
    loading: true,
    revalidating: false,
    error: null as string | null,
    reload: vi.fn(),
  },
  pipeline: { data: null as PipelineSnapshot | null, loading: false, error: null as string | null, reload: vi.fn() },
}));

vi.mock('../dcCache', () => ({
  useCachedLoad: (key: string) =>
    key.startsWith('sales:verification:detail:') ? state.pipeline : state.current,
}));

vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('@/context/UserContextProvider', () => ({
  useUserContext: () => ({ userId: 'u1', role: 'CEO', userName: 'Admin', allDepartmentAccess: true }),
}));
vi.mock('../live', () => ({
  useLoad: () => state.pipeline,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggle: vi.fn() }),
}));

function client(index: number, classification: VerificationClient['classification'] = 'in_pipeline'): VerificationClient {
  return {
    dealId: `deal-${index}`,
    carrierId: `carrier-${index}`,
    companyName: classification === 'active' ? 'Active account should be hidden' : `Pipeline application ${index}`,
    dealName: `Deal ${index}`,
    appFillDate: `2026-07-${String(Math.max(1, 31 - index)).padStart(2, '0')}`,
    dealStage: 'Application Processing',
    applicationStage: 'Adjudication',
    applicationStatus: 'Pending Decision',
    stageUpdatedAt: null,
    classification,
    creditDecision: null,
    creditScore: null,
    creditLimit: null,
    creditLineApproved: null,
    riskScore: null,
    creditSafeGrade: null,
    moneyCodeLimit: null,
    billingCycle: null,
    paymentTerms: null,
    companyVerification: null,
    billingVerification: null,
    lovesVerification: null,
    verified: false,
    limitsAdded: false,
    rejectReason: null,
    verificationNotes: null,
    cardsRequested: null,
    applicationId: null,
    dot: null,
    mc: null,
    agentName: 'Sales Agent',
    modifiedAt: null,
    attentionCount: 0,
    verificationStatus: null,
    verificationUpdatedAt: null,
    verificationState: null,
    plaidLinkUrl: null,
    plaidStatus: null,
    cpLimit: null,
    cpPaymentType: null,
    cpBillingCycle: null,
    missingFields: [],
    docsUploaded: 0,
    workingOn: null,
  };
}

function page(clients: VerificationClient[], total = clients.length, current = 1): VerificationClientPage {
  return {
    clients,
    pagination: { page: current, pageSize: 9, total, pageCount: Math.max(1, Math.ceil(total / 9)) },
  };
}

describe('VerificationTab roster chrome', () => {
  beforeEach(() => {
    state.current = {
      data: null,
      loading: true,
      revalidating: false,
      error: null,
      reload: vi.fn(),
    };
    state.pipeline = { data: null, loading: false, error: null, reload: vi.fn() };
  });

  it('uses the standardized card skeleton without Active or order controls', () => {
    render(<VerificationTab />);

    expect(screen.getByLabelText('Loading verification applications').children).toHaveLength(9);
    expect(screen.queryByRole('button', { name: /^Active/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Applied:/i })).not.toBeInTheDocument();
  });

  it('shows one equal-card server page with the paginated total', () => {
    state.current = {
      data: page(Array.from({ length: 9 }, (_, index) => client(index + 1)), 12),
      loading: false,
      revalidating: false,
      error: null,
      reload: vi.fn(),
    };

    render(<VerificationTab />);

    expect(screen.getAllByTestId('verification-card')).toHaveLength(9);
    expect(screen.getByText('Showing 1–9 of 12 pipeline applications')).toBeInTheDocument();
    expect(screen.getByTestId('verification-grid')).toHaveClass('ss-verification-grid');
  });

  it('keeps the full stage visual when Verification intake has not started', () => {
    state.current = {
      data: page([client(1)]),
      loading: false,
      revalidating: false,
      error: null,
      reload: vi.fn(),
    };

    render(<VerificationTab />);
    fireEvent.click(screen.getByTestId('verification-card'));

    expect(screen.getByText('Awaiting intake')).toBeInTheDocument();
    expect(screen.getByText('Pre Stop Factors')).toBeInTheDocument();
    expect(screen.getByText('Post Stop Factors')).toBeInTheDocument();
    expect(screen.getAllByText('Not started')).toHaveLength(10);
  });

  it('uses the standard detail skeleton while the live pipeline loads', () => {
    state.current = {
      data: page([client(1)]),
      loading: false,
      revalidating: false,
      error: null,
      reload: vi.fn(),
    };
    state.pipeline = { data: null, loading: true, error: null, reload: vi.fn() };

    render(<VerificationTab />);
    fireEvent.click(screen.getByTestId('verification-card'));

    expect(screen.getByLabelText('Loading verification detail')).toBeInTheDocument();
  });

  it('shows Zoho Credit Decision on the card and in the client-detail sheet', () => {
    const row = client(1);
    row.companyName = 'Daniilo Jacshvili';
    row.creditDecision = 'Declined-Prepay/Secured Only';
    row.applicationStatus = 'Pending Decision';
    row.dealStage = 'Application Processing';
    row.verificationState = 'in_progress';
    row.applicationId = '899640';
    row.missingFields = ['date of birth'];
    state.current = {
      data: page([row]),
      loading: false,
      revalidating: false,
      error: null,
      reload: vi.fn(),
    };
    state.pipeline = {
      data: {
        requestId: 'req-1',
        status: 'REVIEW',
        updatedAt: null,
        stages: [{ id: 'stop-factor-pre', order: 1, label: 'Pre Stop Factors', status: 'pending' }],
        decision: { outcome: 'rejected', reason: 'Prepay required' },
        requirements: [],
        events: [],
        attachments: [],
        source: 'credit_platform',
      },
      loading: false,
      error: null,
      reload: vi.fn(),
    };

    render(<VerificationTab />);

    expect(screen.getByTestId('vf-credit-decision')).toHaveTextContent('Declined-Prepay/Secured Only');
    expect(screen.getByText('Credit Decision')).toBeInTheDocument();
    expect(screen.getByTestId('vf-wex-status')).toHaveTextContent('Pending Decision');
    expect(screen.getByTestId('vf-deal-pipeline')).toHaveTextContent('Application Processing');
    expect(screen.getByTestId('vf-verification-state')).toHaveTextContent('Verification: In progress');

    fireEvent.click(screen.getByTestId('verification-card'));

    const dialog = screen.getByRole('dialog', { name: 'Verification Daniilo Jacshvili' });
    expect(within(dialog).getByTestId('vf-credit-decision')).toHaveTextContent('Declined-Prepay/Secured Only');
    expect(within(dialog).getByText('Credit Decision')).toBeInTheDocument();
    expect(within(dialog).getByTestId('vf-desk-decision')).toHaveTextContent('Prepay');
    expect(within(dialog).getByTestId('vf-wex-status')).toHaveTextContent('Pending Decision');
    expect(within(dialog).getByTestId('vf-deal-pipeline')).toHaveTextContent('Application Processing');
    expect(within(dialog).getByTestId('vf-verification-state')).toHaveTextContent('Verification: In progress');
    expect(within(dialog).getByTestId('vf-credit-note')).toHaveTextContent('prepay/secured only');
    expect(within(dialog).queryByText('Not Accepted')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Pre Stop Factors')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it('hides numbered compliance steps once the request is approved', () => {
    const row = client(1);
    row.companyName = 'Approved Carrier';
    row.verificationState = 'approved';
    row.cpPaymentType = 'LOC';
    row.cpLimit = 5000;
    row.creditDecision = 'Approved-Requested';
    state.current = {
      data: page([row]),
      loading: false,
      revalidating: false,
      error: null,
      reload: vi.fn(),
    };
    state.pipeline = {
      data: {
        requestId: 'req-ok',
        status: 'APPROVED',
        updatedAt: null,
        stages: [
          { id: 'stop-factor-pre', order: 1, label: 'Pre Stop Factors', status: 'done' },
          { id: 'blacklist', order: 2, label: 'Black List Match', status: 'done' },
          { id: 'fmcsa', order: 3, label: 'FMCSA', status: 'skipped' },
        ],
        decision: { outcome: 'loc' },
        requirements: [],
        events: [],
        attachments: [],
        source: 'credit_platform',
      },
      loading: false,
      error: null,
      reload: vi.fn(),
    };

    render(<VerificationTab />);
    expect(screen.getByTestId('vf-credit-decision')).toHaveTextContent('Approved-Requested');
    expect(screen.getByText('Credit Decision')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('verification-card'));

    const dialog = screen.getByRole('dialog', { name: 'Verification Approved Carrier' });
    expect(within(dialog).getByTestId('vf-credit-decision')).toHaveTextContent('Approved-Requested');
    expect(within(dialog).getByText('Credit Decision')).toBeInTheDocument();
    expect(within(dialog).getByTestId('vf-approved-result')).toHaveTextContent('LOC Approved');
    expect(within(dialog).queryByText('Pre Stop Factors')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Black List Match')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('FMCSA')).not.toBeInTheDocument();
  });
});
