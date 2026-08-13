import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhoneLeadsList } from './dataCenterPhoneList';
import type { LeadEdit, LeadVM } from './dataCenterLive';

const EDIT: LeadEdit = {
  MC: '',
  DOT: '',
  Referral_Source: '',
  Cell: '',
  Phone: '',
  Email: '',
  Description: '',
};

function lead(over: Partial<LeadVM> = {}): LeadVM {
  return {
    id: 'lead-1',
    contact: 'Ada Lovelace',
    company: 'Octane Fuel',
    initials: 'AL',
    phone: '555-0100',
    cell: '',
    email: '',
    source: 'Meta',
    status: 'New',
    converted: false,
    created: 'today',
    createdAt: '',
    fbRegisteredAt: '',
    webRegisteredAt: '',
    lastActivityAt: '',
    modifiedAt: '',
    mc: '',
    dot: '',
    referral: '',
    trucks: 0,
    callAttempts: 0,
    note: '',
    edit: EDIT,
    ...over,
  };
}

describe('PhoneLeadsList', () => {
  it('renders a tappable row with title and meta, not a sideways table', () => {
    const onOpen = vi.fn();
    render(<PhoneLeadsList rows={[lead()]} onOpen={onOpen} />);
    const row = screen.getByRole('button', { name: /Ada Lovelace/ });
    expect(row.textContent).toContain('Octane Fuel');
    expect(row.textContent).toContain('New');
    row.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
