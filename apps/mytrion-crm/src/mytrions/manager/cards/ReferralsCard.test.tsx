import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReferralsCard } from './ReferralsCard';

vi.mock('../../sales/redesign/dcCache', () => ({
  formatCachedAt: () => 'just now',
  useCachedLoad: () => ({
    data: null,
    loading: true,
    revalidating: false,
    error: '',
    reload: vi.fn(),
    cachedAt: null,
  }),
}));

describe('Referrals calculation month control', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the native month picker from the full visible control', () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    const { container } = render(<ReferralsCard />);

    fireEvent.click(screen.getByRole('button', { name: /choose calculation month/i }));

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Calculation month')).toHaveAttribute('type', 'month');
    expect(screen.getByRole('status', { name: 'Loading referrals' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mg-lty-sk')).toHaveLength(9);
  });
});
