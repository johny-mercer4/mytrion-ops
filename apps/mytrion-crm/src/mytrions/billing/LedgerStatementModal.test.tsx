import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchLedgerStatement } from '../../api/billing';
import type { LedgerStatementResponse } from '../../api/ledgerTypes';
import { setViewport } from '../../test/viewport';
import { LedgerStatementModal } from './LedgerStatementModal';

vi.mock('../../api/billing', () => ({
  fetchLedgerStatement: vi.fn(),
}));

const STATEMENT: LedgerStatementResponse = {
  carrierId: '5758544',
  companyName: 'Acme Transport',
  clientType: 'LOC',
  section: 'ar',
  sectionLabel: 'Accounts Receivable',
  period: { startDate: '2026-08-01', endDate: '2026-08-13', endDateExclusive: '2026-08-14' },
  opening: 1000,
  openingAsOf: '2026-08-01',
  openingSource: 'recorded',
  debit: 250,
  credit: 100,
  closing: 1150,
  truncated: false,
  warnings: [],
  lines: [
    {
      id: 'l1',
      date: '2026-08-04',
      description: 'Invoice 4412',
      debit: 250,
      credit: null,
      running: 1250,
      refType: 'invoice',
    },
    {
      id: 'l2',
      date: '2026-08-10',
      description: 'Payment received',
      debit: null,
      credit: 100,
      running: 1150,
      refType: 'payment',
    },
  ],
};

function mount() {
  render(
    <LedgerStatementModal
      carrierId="5758544"
      companyName="Acme Transport"
      section="ar"
      sectionLabel="Accounts Receivable"
      column="closing"
      range={{ from: '2026-08-01', to: '2026-08-13' }}
      onClose={() => undefined}
    />,
  );
}

describe('LedgerStatementModal', () => {
  it('keeps the dense table on desktop', async () => {
    vi.mocked(fetchLedgerStatement).mockResolvedValue(STATEMENT);
    mount();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText('Invoice 4412')).toBeInTheDocument();
    expect(screen.queryByLabelText('Statement lines')).not.toBeInTheDocument();
  });

  it('renders date + amount rows on phone instead of a min-width table', async () => {
    setViewport(390);
    vi.mocked(fetchLedgerStatement).mockResolvedValue(STATEMENT);
    mount();
    await waitFor(() => expect(screen.getByLabelText('Statement lines')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Invoice 4412')).toBeInTheDocument();
    expect(screen.getByText('Payment received')).toBeInTheDocument();
  });
});
