/**
 * Case-detail invoices: a failed GET must not look like "no invoices", and rows past the
 * first page must be reachable via total / limit / offset.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionCaseRow, CollectionInvoiceRow } from '@/api/collection';
import { CASE_INVOICES_PAGE_SIZE } from './casesModel';
import { caseRowFixture } from '../caseRow.fixture';

const getCollectionCase = vi.fn();
const listCollectionInvoices = vi.fn();
const getCaseDesk = vi.fn();
const listActivity = vi.fn();

vi.mock('@/api/collection', async () => {
  const actual = await vi.importActual<typeof import('@/api/collection')>('@/api/collection');
  return {
    ...actual,
    getCollectionCase: (...args: unknown[]) => getCollectionCase(...args),
    listCollectionInvoices: (...args: unknown[]) => listCollectionInvoices(...args),
  };
});

/**
 * The record now reads four sources, not two. The desk bundle and the activity feed are stubbed
 * so these tests stay about the INVOICE panel's load states — the thing they were written for.
 */
vi.mock('@/api/collectionDesk', async () => {
  const actual = await vi.importActual<typeof import('@/api/collectionDesk')>('@/api/collectionDesk');
  return {
    ...actual,
    getCaseDesk: (...args: unknown[]) => getCaseDesk(...args),
    listActivity: (...args: unknown[]) => listActivity(...args),
  };
});

const { CaseDetail } = await import('./CaseDetail');
const { invalidateSwrCache } = await import('../../_shared/swrCache');
import { ToastProvider } from '@/ds';

function caseRow(): CollectionCaseRow {
  return caseRowFixture();
}

function invoice(n: number): CollectionInvoiceRow {
  return {
    id: `inv_${n}`,
    caseId: 'cc_1',
    cmpInvoiceId: n,
    invoiceNumber: `INV-${n}`,
    cmpStage: 'open',
    status: 'PENDING',
    periodFrom: '2026-01-01',
    periodTo: '2026-01-31',
    periodLabel: 'Jan 2026',
    totalAmount: '100.00',
    totalPaid: '0.00',
    remainingAmount: '100.00',
    totalMerchantFee: '0.00',
    dueDate: '2026-02-15',
    cmpCreateDate: '2026-01-01',
    paymentDay: null,
    invoiceNotes: null,
    zohoDealId: null,
  };
}

function pageOf(offset: number, total: number): { items: CollectionInvoiceRow[]; total: number } {
  const start = offset + 1;
  const items = Array.from({ length: Math.min(CASE_INVOICES_PAGE_SIZE, total - offset) }, (_, i) =>
    invoice(start + i),
  );
  return { items, total };
}

beforeEach(() => {
  invalidateSwrCache('collection:case');
  invalidateSwrCache('collection:activity');
  getCollectionCase.mockReset();
  listCollectionInvoices.mockReset();
  getCaseDesk.mockReset();
  listActivity.mockReset();
  getCollectionCase.mockResolvedValue({ case: caseRow() });
  getCaseDesk.mockResolvedValue({
    plan: null,
    promises: [],
    tradeline: null,
    policy: {
      agencyMinDaysPastDue: 180,
      agencyMinRemaining: 5000,
      agencyWarnWindowDays: 14,
      promiseGraceDays: 5,
      silentAfterDays: 30,
      intakeUncontactedDays: 2,
      agingBands: [30, 90, 180],
    },
  });
  listActivity.mockResolvedValue({ items: [], total: 0 });
});

/**
 * The panels on this record raise toasts, so they need the provider the Collection module mounts
 * at its root. Rendering the component bare threw "useToast() must be called inside a
 * <ToastProvider>" — a real crash in the app if that provider ever goes missing, which is exactly
 * why the test should render it the way the app does.
 */
function renderDetail() {
  return render(
    <ToastProvider>
      <CaseDetail caseId="cc_1" onBack={() => undefined} onChanged={() => undefined} />
    </ToastProvider>,
  );
}

describe('case invoice load states', () => {
  it('shows an error and Retry when invoices fail and there is no cache', async () => {
    listCollectionInvoices.mockRejectedValue(new Error('Backend issue'));
    renderDetail();

    // By text, not by role: ToastProvider's own region is also role="alert", so a bare
    // findByRole('alert') now matches the empty toast outlet instead of the error state.
    expect(await screen.findByText('Could not load invoices')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No invoices on this case')).not.toBeInTheDocument();
  });

  it('shows the empty state only after a successful zero-item load', async () => {
    listCollectionInvoices.mockResolvedValue({ items: [], total: 0 });
    renderDetail();

    expect(await screen.findByText('No invoices on this case')).toBeInTheDocument();
    expect(screen.queryByText('Could not load invoices')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('case invoice pagination', () => {
  it('requests the next page from total instead of stopping at the first 50', async () => {
    listCollectionInvoices.mockImplementation((_id: string, page?: { offset?: number }) =>
      Promise.resolve(pageOf(page?.offset ?? 0, 120)),
    );
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByText('INV-1')).toBeInTheDocument();
    expect(screen.getByText('INV-50')).toBeInTheDocument();
    expect(screen.queryByText('INV-51')).not.toBeInTheDocument();
    expect(document.querySelector('.cc-foot-count')?.textContent).toMatch(/1–50/);
    expect(document.querySelector('.cc-foot-count')?.textContent).toMatch(/120/);
    expect(listCollectionInvoices).toHaveBeenCalledWith('cc_1', { limit: 50, offset: 0 });

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(listCollectionInvoices).toHaveBeenCalledWith('cc_1', { limit: 50, offset: 50 });
    });
    expect(await screen.findByText('INV-51')).toBeInTheDocument();
    expect(screen.queryByText('INV-1')).not.toBeInTheDocument();
  });
});
