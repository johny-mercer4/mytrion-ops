import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationClient, VerificationClientPage } from '@/api/verification';
import { VerificationTab } from './VerificationTab';

const state = vi.hoisted(() => ({
  current: {
    data: null as VerificationClientPage | null,
    loading: true,
    revalidating: false,
    error: null as string | null,
    reload: vi.fn(),
  },
  pipeline: { data: null, loading: false, error: null, reload: vi.fn() },
}));

vi.mock('../dcCache', () => ({
  useCachedLoad: () => state.current,
}));

vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('../live', () => ({
  useLoad: () => state.pipeline,
}));

function client(index: number, classification: VerificationClient['classification'] = 'in_pipeline'): VerificationClient {
  return {
    dealId: `deal-${index}`,
    carrierId: `carrier-${index}`,
    companyName: classification === 'active' ? 'Active account should be hidden' : `Pipeline application ${index}`,
    appFillDate: `2026-07-${String(Math.max(1, 31 - index)).padStart(2, '0')}`,
    dealStage: 'Application Submitted',
    classification,
    creditScore: null,
    creditLimit: null,
    billingCycle: null,
    paymentTerms: null,
    paymentDay: null,
    minimumRequiredBalance: null,
    firstSwipeDate: null,
    lastTransactionDate: null,
    totalActiveCards: 0,
    totalSwipedCards: 0,
    activeCardsLast30Days: 0,
    isActive: classification === 'active',
    isLocSuspended: false,
    isDebtor: false,
    applicationId: null,
    dot: null,
    country: 'US',
    contactSource: 'Web',
    agentName: 'Sales Agent',
    attentionCount: 0,
    verificationStatus: null,
    verificationUpdatedAt: null,
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

  it('keeps the original nine-stage visual when Verification intake has not started', () => {
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
    expect(screen.getAllByText('Not started')).toHaveLength(9);
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
});
