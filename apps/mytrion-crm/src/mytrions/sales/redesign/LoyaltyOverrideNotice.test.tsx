import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoyaltyOverrideNotice } from './LoyaltyOverrideNotice';

describe('Sales loyalty override disclosure', () => {
  it('shows Manager-owned reward details and the note', () => {
    render(
      <LoyaltyOverrideNotice
        override={{
          carrierId: '123', enterpriseMode: null, enterpriseGoldTargetGallons: null,
          enabledRewardIds: ['loves_rebate'], note: 'Contract exception',
          updatedBy: 'Kristina', updatedAt: '2026-07-31T12:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Manager-controlled loyalty')).toBeInTheDocument();
    expect(screen.getByText(/1 custom rewards active · Kristina/)).toBeInTheDocument();
    expect(screen.getByText('Contract exception')).toBeInTheDocument();
  });

  it('renders nothing when the automatic program is active', () => {
    const { container } = render(<LoyaltyOverrideNotice override={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
