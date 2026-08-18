import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferralWorkspace } from '../../../api/referrals';
import { ReferralsCard } from './ReferralsCard';
import { currentPeriodFrom, currentPeriodTo } from './referralPeriod';

/**
 * Hold the card on its loading frame so these tests exercise the controls, not the network.
 *
 * `vi.mock` is keyed by module path and fails SILENTLY when nothing imports that path — it stubs a
 * module the subject never asks for and the suite still goes green, just against a component that
 * really did try to fetch. This used to point at `sales/redesign/dcCache`, which is now a re-export
 * shim the card no longer imports. `useCachedLoadSpy` below exists so that can't happen quietly
 * again: if the path ever stops matching, the assertion fails instead of the mock evaporating.
 */
const emptyCache = {
  data: null as ReferralWorkspace | null,
  loading: true,
  revalidating: false,
  error: '',
  reload: vi.fn(),
  cachedAt: null as number | null,
};

const useCachedLoadSpy = vi.fn(() => ({ ...emptyCache }));

function staleWorkspace(periodFrom: string, periodTo: string): ReferralWorkspace {
  return {
    periodMonth: periodFrom,
    periodFrom,
    periodTo,
    generatedAt: '2026-08-01T00:00:00.000Z',
    parents: {
      module: 'Parent_Referrers',
      moduleKey: 'parents',
      fields: [],
      rows: [
        {
          id: 'P1',
          ReferrerId: 'REF-000322',
          Name: 'Stale July Partner',
          Company_Name: 'AL AZIZ EXPRESS INC',
          Calculation: 'Swipes (Legacy)',
        },
      ],
      total: 1,
      truncated: false,
    },
    children: {
      module: 'Child_Referrals',
      moduleKey: 'children',
      fields: [],
      rows: [],
      total: 0,
      truncated: false,
    },
    associations: {
      leads: { module: 'Leads', fields: [], rows: [], total: 0, truncated: false },
      deals: { module: 'Deals', fields: [], rows: [], total: 0, truncated: false },
    },
    previews: [],
    unresolvedChildIds: [],
    skippedNoCalculationChildIds: [],
    summary: {
      parents: 1,
      configuredParents: 1,
      children: 0,
      relatedDeals: 0,
      connectedCarriers: 0,
      needsDealLink: 1,
      needsCalculation: 0,
      earned: 0,
      tracking: 0,
      paid: 0,
      payableAmountUsd: '0.00',
    },
  };
}

vi.mock('../../_shared/swrCache', () => ({
  formatCachedAt: () => 'just now',
  useCachedLoad: () => useCachedLoadSpy(),
}));

describe('Referrals calculation date range', () => {
  afterEach(() => {
    useCachedLoadSpy.mockReset();
    useCachedLoadSpy.mockImplementation(() => ({ ...emptyCache }));
    vi.restoreAllMocks();
  });

  it('renders against the mocked cache rather than the network', () => {
    render(<ReferralsCard />);
    expect(useCachedLoadSpy).toHaveBeenCalled();
  });

  it('opens the native date picker from the full visible control', () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    const { container } = render(<ReferralsCard />);

    fireEvent.click(screen.getByRole('button', { name: /choose from date/i }));

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Month')).toHaveAttribute('type', 'month');
    expect(screen.getByLabelText('From date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('To date')).toHaveAttribute('type', 'date');
    expect(screen.getByRole('status', { name: 'Loading referrals' })).toBeInTheDocument();
    // The cold-open placeholder is Referrals' OWN shape — the KPI row, the controls panel and the
    // 290px card grid — not the 380px-track Loyalty grid it used to borrow, which relaid the whole
    // page on arrival. Asserting on the real containers is what pins that down.
    expect(container.querySelector('.mg-sk-stack .mg-rf-grid')).toBeInTheDocument();
    expect(container.querySelectorAll('.mg-sk-stack .mg-rf-grid > .mg-sk')).toHaveLength(9);
    expect(container.querySelectorAll('.mg-sk-stack .mg-rf-kpis > .mg-sk')).toHaveLength(4);
    expect(container.querySelector('.mg-lty-grid')).toBeNull();
  });

  it('fills from and to when a month is chosen', () => {
    render(<ReferralsCard />);
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-07' } });
    expect(screen.getByLabelText('From date')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('To date')).toHaveValue('2026-07-31');
  });

  it('drops the real controls panel while the cold skeleton is up, so only one loader shows', () => {
    const { container } = render(<ReferralsCard />);

    // The skeleton renders its OWN `.mg-rf-controls` (that reuse is what stops the shift), so the
    // check is that no LIVE one sits beside it — i.e. none outside the placeholder stack.
    const live = [...container.querySelectorAll('.mg-rf-controls')].filter(
      (el) => !el.closest('.mg-sk-stack'),
    );
    expect(live).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('replaces stale cards with the skeleton while a refresh is calculating', () => {
    useCachedLoadSpy.mockReturnValue({
      data: staleWorkspace(currentPeriodFrom(), currentPeriodTo()),
      loading: false,
      revalidating: true,
      error: '',
      reload: vi.fn(),
      cachedAt: Date.now(),
    });
    const { container } = render(<ReferralsCard />);

    expect(screen.getByRole('status', { name: 'Loading referrals' })).toBeInTheDocument();
    expect(screen.queryByText('Stale July Partner')).toBeNull();
    expect(screen.queryByText('Refreshing…')).toBeNull();
    expect(screen.queryByText('Calculating…')).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});
