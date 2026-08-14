import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerificationSummary, VerificationSummaryItem } from './VerificationSummaryItem';

describe('VerificationSummaryItem', () => {
  it('shimmers the pill on first paint and never prints a dash', () => {
    const { container } = render(
      <div data-mytrion="verification">
        <VerificationSummary pending>
          <VerificationSummaryItem pending value={0} label="open" />
        </VerificationSummary>
      </div>,
    );
    expect(container.querySelector('.vf-sk-chip')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[—–-]/);
    expect(screen.getByRole('status').textContent).toBe('Loading counts');
  });

  it('swaps to the real count once data arrives', () => {
    const { container } = render(
      <div data-mytrion="verification">
        <VerificationSummary pending={false}>
          <VerificationSummaryItem pending={false} value={12} label="open" />
        </VerificationSummary>
      </div>,
    );
    expect(container.querySelector('.vf-sk-chip')).toBeNull();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(/open/)).toBeTruthy();
  });
});
