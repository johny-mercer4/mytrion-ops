import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AutoPaymentsPanel } from './AutoRichResults';

describe('AutoPaymentsPanel', () => {
  it('shows exact cents and preserves the partially-paid CMP status', () => {
    render(
      <AutoPaymentsPanel
        summary={{
          invoiceCount: '1',
          totalBilled: '$43,496.27',
          totalPaid: '$12,000.11',
          openBalance: '$31,496.16',
          paymentCount: '2',
        }}
        cmpInvoices={[{
          id: '77',
          invoiceNumber: '178238',
          status: 'Partially Paid',
          total: '$43,496.27',
          paid: '$12,000.11',
          remaining: '$31,496.16',
        }]}
      />,
    );

    expect(screen.getByText('Partially Paid')).toBeInTheDocument();
    expect(screen.getAllByText('$43,496.27')).toHaveLength(2);
    expect(screen.queryByText('Payments total')).not.toBeInTheDocument();
  });
});
