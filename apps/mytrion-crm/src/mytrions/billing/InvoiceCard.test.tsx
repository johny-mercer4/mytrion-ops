/**
 * The outstanding-days chip, as a STRUCTURAL claim.
 *
 * The request was "outstanding days on the left side of the paid status", and "left of" in a flex row
 * whose children are laid out in source order is a DOM-order fact — which jsdom can assert even
 * though it does no layout. So this pins the ordering and the chip's presence/absence rules; the
 * arithmetic itself lives in DataCenter.outstanding.test.ts.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InvoiceCard } from './DataCenter';

const PAID = {
  invoiceNumber: '178899',
  status: 'Paid',
  period: '06 Aug 2026 - 12 Aug 2026',
  createdDate: '2026-08-06',
  paymentDate: '2026-08-13',
  totalAmount: 7799.89,
  totalPaid: 7799.89,
  remainingAmount: 0,
};

describe('InvoiceCard — outstanding chip', () => {
  it('renders the chip BEFORE the status badge', () => {
    const { container } = render(<InvoiceCard inv={PAID} />);
    const group = container.querySelector('.tx-invoice-status-group');
    expect(group).not.toBeNull();

    const kids = [...group!.children];
    expect(kids).toHaveLength(2);
    // Source order == visual order in a row flex container, so index 0 IS "the left side".
    expect(kids[0]).toHaveClass('dc-inv-outstanding');
    expect(kids[1]).toHaveClass('bm-badge');
    expect(kids[1]).toHaveTextContent('Paid');
  });

  it('shows the formula\'s result: 13 Aug paid, 06 Aug created -> 6d', () => {
    render(<InvoiceCard inv={PAID} />);
    expect(screen.getByText('6d')).toBeInTheDocument();
  });

  it('marks anything past the grace day as late, and 0 days as not late', () => {
    const { container, unmount } = render(<InvoiceCard inv={PAID} />);
    expect(container.querySelector('.dc-inv-outstanding-late')).not.toBeNull();
    unmount();

    // Paid the day after creation — inside the grace day, so 0d and NOT flagged.
    const onTime = render(<InvoiceCard inv={{ ...PAID, createdDate: '2026-08-12', paymentDate: '2026-08-13' }} />);
    expect(onTime.container.querySelector('.dc-inv-outstanding')).not.toBeNull();
    expect(onTime.container.querySelector('.dc-inv-outstanding-late')).toBeNull();
    expect(onTime.getByText('0d')).toBeInTheDocument();
  });

  it('renders no chip at all on an unpaid invoice, leaving the badge alone', () => {
    // The requester's explicit choice: nothing, not a 0 and not a dash.
    const { container } = render(
      <InvoiceCard inv={{ ...PAID, status: 'Pending', paymentDate: null, totalPaid: 0, remainingAmount: 7799.89 }} />,
    );
    expect(container.querySelector('.dc-inv-outstanding')).toBeNull();
    const group = container.querySelector('.tx-invoice-status-group')!;
    expect([...group.children]).toHaveLength(1);
    expect(group.children[0]).toHaveClass('bm-badge');
  });

  it('still renders the card when CMP sends no created date', () => {
    const { container } = render(<InvoiceCard inv={{ ...PAID, createdDate: '' }} />);
    expect(container.querySelector('.dc-inv-outstanding')).toBeNull();
    expect(screen.getByText('#178899')).toBeInTheDocument();
  });
});
