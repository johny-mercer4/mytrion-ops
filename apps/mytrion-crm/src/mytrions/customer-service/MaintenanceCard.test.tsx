/**
 * CS feedback 2026-08-11: the "New" chip was `source === 'mytrion'`, which never turns off — every
 * case created from here on has that source, so it was on track to eventually sit on 100% of cards.
 * Time-boxed to the case's own creation day instead; this guards that it's actually day-scoped now,
 * not source-scoped.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaintenanceCard } from './MaintenanceCard';
import type { MaintenanceRecord } from '@/api/cs';

function mkRow(overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    id: 'mtc_1',
    zohoRecordId: null,
    source: 'mytrion',
    name: 'Acme Hauling',
    companyZohoId: null,
    companyName: 'Acme Hauling',
    carrierId: '5000001',
    unitNumber: '12',
    status: 'In Process',
    caseType: 'Tire',
    caseDate: '2026-08-11',
    caseCompletion: null,
    driverName: null,
    phone: null,
    shopNumber: null,
    parts: null,
    workOrderId: null,
    referenceNumber: '500000123',
    paymentMethod: null,
    paymentStatus: null,
    invoiced: null,
    cardDigits: null,
    totalAmount: '245.00',
    completionCompensation: null,
    halfCompletionCompensation: null,
    leadCompensation: null,
    ownerZohoUserId: null,
    ownerName: 'Jane Doe',
    bonusCompletionUserId: null,
    bonusCompletionName: null,
    bonusLeadName: null,
    createdTime: null,
    modifiedTime: null,
    createdByName: null,
    updatedByName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MaintenanceCard — "New" chip', () => {
  it('shows for a case created today', () => {
    render(<MaintenanceCard row={mkRow({ createdAt: new Date().toISOString() })} onOpen={() => {}} />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('does not show for a case created yesterday, even with source: mytrion', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    render(<MaintenanceCard row={mkRow({ createdAt: yesterday, source: 'mytrion' })} onOpen={() => {}} />);
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('shows for a migrated Zoho case (source: zoho_migration) IF it happens to be created today', () => {
    // Confirms the chip is genuinely day-scoped now, not a disguised source check.
    render(
      <MaintenanceCard
        row={mkRow({ createdAt: new Date().toISOString(), source: 'zoho_migration' })}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('New')).toBeInTheDocument();
  });
});
