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

import { loadClientCards } from './clientDrilldown';

const carrierId = '5840175';
const cardNumber = '7083050000317340';

describe('loadClientCards', () => {
  beforeEach(() => {
    callTouchpointMock.mockReset();
    getClientCardsMock.mockReset();
  });

  it('overrides stale DWH Inactive with live EFS ACTIVE for the same card', async () => {
    getClientCardsMock.mockResolvedValue([{
      cardId: '1',
      cardNumber,
      cardType: 'TCH',
      status: 'Inactive',
      balance: null,
      unit: 'U-9',
      driverId: 'D-1',
      driverName: 'Pat',
    }]);
    callTouchpointMock.mockResolvedValue({
      data: [{ cardNumber, status: 'ACTIVE' }],
    });

    await expect(loadClientCards(carrierId)).resolves.toEqual([{
      num: '•••• 7340',
      status: 'ACTIVE',
      tone: 'var(--ok)',
      cardType: 'TCH',
      unit: 'U-9',
      driverId: 'D-1',
      driverName: 'Pat',
    }]);
    expect(callTouchpointMock).toHaveBeenCalledWith('efs.cards', { carrierId });
  });

  it('keeps DWH status when live EFS fails', async () => {
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
      num: '•••• 7340',
      status: 'INACTIVE',
      tone: 'var(--muted)',
      cardType: 'TCH',
      unit: null,
      driverId: null,
      driverName: null,
    }]);
  });

  it('still lists EFS cards when DWH is empty', async () => {
    getClientCardsMock.mockResolvedValue([]);
    callTouchpointMock.mockResolvedValue({
      data: [{ card_number: cardNumber, status: 'Active' }],
    });

    await expect(loadClientCards(carrierId)).resolves.toEqual([{
      num: '•••• 7340',
      status: 'ACTIVE',
      tone: 'var(--ok)',
      cardType: null,
      unit: null,
      driverId: null,
      driverName: null,
    }]);
  });
});
