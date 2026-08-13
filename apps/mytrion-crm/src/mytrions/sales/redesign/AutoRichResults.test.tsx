import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AutoAccountStatusPanel, AutoBalancePanel } from './AutoRichResults';
import type { AccountStatusResult, BalanceCheckResult } from './autoLive';

const balance: BalanceCheckResult = {
  companyName: 'Divergent',
  efsBalance: '$1,250.50',
  availableLimit: '$3,200.00',
  weeklyLimit: '$8,000.00',
  creditUsed: '$4,800.00',
  accountType: 'LOC',
  paymentTerms: 'Weekly',
  billingCycle: 'WEEKLY_MON_SUN',
  efsError: '',
};

const status: AccountStatusResult = {
  companyName: 'Divergent',
  isActive: true,
  accountType: 'LOC',
  paymentTerms: 'Weekly',
  efsBalance: '$1,250.50',
  weeklyLimit: '$8,000.00',
  totalDebt: '$4,310',
  debtInvoiceCount: '3',
  maxDebtDays: '21 days',
  worstStatus: 'OVERDUE',
  isHardDebtor: true,
  activeCards: 7,
  totalCards: 9,
  cardsLive: true,
  notices: ['CMP debt: report timed out'],
};

describe('AutoBalancePanel', () => {
  it('renders the three balance blocks C-8 is judged on', () => {
    render(<AutoBalancePanel result={balance} />);

    expect(screen.getByText('EFS Balance')).toBeInTheDocument();
    expect(screen.getByText('$1,250.50')).toBeInTheDocument();
    expect(screen.getByText('Available Limit')).toBeInTheDocument();
    expect(screen.getByText('$3,200.00')).toBeInTheDocument();
    expect(screen.getByText('Weekly Limit')).toBeInTheDocument();
    expect(screen.getByText('$8,000.00')).toBeInTheDocument();
  });

  it('hides secondary fields the balance source did not answer for', () => {
    render(<AutoBalancePanel result={{ ...balance, billingCycle: '', creditUsed: '—' }} />);

    expect(screen.getByText('Account type')).toBeInTheDocument();
    expect(screen.queryByText('Billing cycle')).not.toBeInTheDocument();
    expect(screen.queryByText('Credit used')).not.toBeInTheDocument();
  });
});

describe('AutoAccountStatusPanel', () => {
  it('splits the carrier overview into blocks instead of one sentence', () => {
    render(<AutoAccountStatusPanel result={status} />);

    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('HARD DEBTOR')).toBeInTheDocument();
    expect(screen.getByText('Open debt')).toBeInTheDocument();
    expect(screen.getByText('$4,310')).toBeInTheDocument();
    expect(screen.getByText('Active cards (live EFS)')).toBeInTheDocument();
    expect(screen.getByText('7 / 9')).toBeInTheDocument();
    expect(screen.getByText('Invoices in debt')).toBeInTheDocument();
    expect(screen.getByText('21 days')).toBeInTheDocument();
    expect(screen.getByText('CMP debt: report timed out')).toBeInTheDocument();
  });

  it('marks warehouse card counts as such when live EFS did not answer', () => {
    render(<AutoAccountStatusPanel result={{ ...status, cardsLive: false, isHardDebtor: false }} />);

    expect(screen.getByText('Active cards')).toBeInTheDocument();
    expect(screen.queryByText('HARD DEBTOR')).not.toBeInTheDocument();
  });
});
