import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callTouchpointMock, getClientCardsMock } = vi.hoisted(() => ({
  callTouchpointMock: vi.fn(),
  getClientCardsMock: vi.fn(),
}));

vi.mock('@/api/touchpoints', () => ({
  callTouchpoint: callTouchpointMock,
}));

vi.mock('@/api/dataCenter', () => ({
  getClientCards: getClientCardsMock,
  getClientBilling: vi.fn(),
}));

import { loadClientCards, loadClientEfsBalance } from './clientDrilldown';

const carrierId = '5840175';
const cardNumber = '7083050000317340';

describe('loadClientCards', () => {
  beforeEach(() => {
    callTouchpointMock.mockReset();
    getClientCardsMock.mockReset();
  });

  it('builds the roster from live EFS and prefers EFS unit/driver over stale DWH', async () => {
    getClientCardsMock.mockResolvedValue([{
      cardId: '1',
      cardNumber,
      cardType: 'TCH',
      status: 'Inactive',
      balance: null,
      unit: 'U-OLD',
      driverId: 'D-OLD',
      driverName: 'Stale',
    }]);
    callTouchpointMock.mockResolvedValue({
      data: [{
        cardNumber,
        status: 'ACTIVE',
        unitNumber: 'U-9',
        driverId: 'D-1',
        driverName: 'Pat',
      }],
    });

    await expect(loadClientCards(carrierId)).resolves.toEqual([{
      num: '•••• 317340',
      status: 'ACTIVE',
      tone: 'var(--ok)',
      cardType: 'TCH',
      unit: 'U-9',
      driverId: 'D-1',
      driverName: 'Pat',
    }]);
    expect(callTouchpointMock).toHaveBeenCalledWith('efs.cards', { carrierId });
  });

  it('keeps DWH roster when live EFS fails', async () => {
    getClientCardsMock.mockResolvedValue([{
      cardId: '1',
      cardNumber,
      cardType: 'TCH',
      status: 'Inactive',
      balance: null,
      unit: null,
      driverId: null,
      driverName: null,
    }]);
    callTouchpointMock.mockRejectedValue(new Error('EFS unavailable'));

    await expect(loadClientCards(carrierId)).resolves.toEqual([{
      num: '•••• 317340',
      status: 'INACTIVE',
      tone: 'var(--muted)',
      cardType: 'TCH',
      unit: null,
      driverId: null,
      driverName: null,
    }]);
  });

  it('lists EFS cards with live unit/driver when DWH is empty', async () => {
    getClientCardsMock.mockResolvedValue([]);
    callTouchpointMock.mockResolvedValue({
      data: [{
        card_number: cardNumber,
        status: 'Active',
        unit_number: '42',
        driver_name: 'Alex',
      }],
    });

    await expect(loadClientCards(carrierId)).resolves.toEqual([{
      num: '•••• 317340',
      status: 'ACTIVE',
      tone: 'var(--ok)',
      cardType: null,
      unit: '42',
      driverId: null,
      driverName: 'Alex',
    }]);
  });

  it('does not keep DWH-only cards when EFS returns a live roster', async () => {
    getClientCardsMock.mockResolvedValue([{
      cardId: '1',
      cardNumber: '7083050000311111',
      cardType: 'TCH',
      status: 'Active',
      balance: null,
      unit: 'GONE',
      driverId: null,
      driverName: null,
    }]);
    callTouchpointMock.mockResolvedValue({
      data: [{ cardNumber, status: 'ACTIVE' }],
    });

    await expect(loadClientCards(carrierId)).resolves.toEqual([{
      num: '•••• 317340',
      status: 'ACTIVE',
      tone: 'var(--ok)',
      cardType: null,
      unit: null,
      driverId: null,
      driverName: null,
    }]);
  });
});

describe('loadClientEfsBalance', () => {
  beforeEach(() => {
    callTouchpointMock.mockReset();
  });

  it('formats live EFS balance for the Overview tile', async () => {
    callTouchpointMock.mockResolvedValue({
      efs_balance: 12450.4,
      payment_terms: 'Prepay',
    });

    await expect(loadClientEfsBalance(carrierId)).resolves.toEqual({
      display: '$12,450',
      paymentTerms: 'Prepay',
      efsError: null,
    });
    expect(callTouchpointMock).toHaveBeenCalledWith('dwh.carrier_balance', { carrierId });
  });

  it('falls back to balance when efs_balance is missing and surfaces efs_error', async () => {
    callTouchpointMock.mockResolvedValue({
      balance: 0,
      efs_error: 'timeout',
      payment_terms: 'LOC',
    });

    await expect(loadClientEfsBalance(carrierId)).resolves.toEqual({
      display: '$0',
      paymentTerms: 'LOC',
      efsError: 'timeout',
    });
  });
});
