import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReferralsCard } from './ReferralsCard';

/**
 * Hold the card on its loading frame so these tests exercise the controls, not the network.
 *
 * `vi.mock` is keyed by module path and fails SILENTLY when nothing imports that path — it stubs a
 * module the subject never asks for and the suite still goes green, just against a component that
 * really did try to fetch. This used to point at `sales/redesign/dcCache`, which is now a re-export
 * shim the card no longer imports. `useCachedLoadSpy` below exists so that can't happen quietly
 * again: if the path ever stops matching, the assertion fails instead of the mock evaporating.
 */
const useCachedLoadSpy = vi.fn(() => ({
  data: null,
  loading: true,
  revalidating: false,
  error: '',
  reload: vi.fn(),
  cachedAt: null,
}));

vi.mock('../../_shared/swrCache', () => ({
  formatCachedAt: () => 'just now',
  useCachedLoad: () => useCachedLoadSpy(),
}));

describe('Referrals calculation month range', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders against the mocked cache rather than the network', () => {
    render(<ReferralsCard />);
    expect(useCachedLoadSpy).toHaveBeenCalled();
  });

  it('opens the native month picker from the full visible control', () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    const { container } = render(<ReferralsCard />);

    fireEvent.click(screen.getByRole('button', { name: /choose from month/i }));

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('From month')).toHaveAttribute('type', 'month');
    expect(screen.getByLabelText('To month')).toHaveAttribute('type', 'month');
    expect(screen.getByRole('status', { name: 'Loading referrals' })).toBeInTheDocument();
    // The cold-open placeholder is Referrals' OWN shape — the KPI row, the controls panel and the
    // 290px card grid — not the 380px-track Loyalty grid it used to borrow, which relaid the whole
    // page on arrival. Asserting on the real containers is what pins that down.
    expect(container.querySelector('.mg-sk-stack .mg-rf-grid')).toBeInTheDocument();
    expect(container.querySelectorAll('.mg-sk-stack .mg-rf-grid > .mg-sk')).toHaveLength(9);
    expect(container.querySelectorAll('.mg-sk-stack .mg-rf-kpis > .mg-sk')).toHaveLength(4);
    expect(container.querySelector('.mg-lty-grid')).toBeNull();
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
});
