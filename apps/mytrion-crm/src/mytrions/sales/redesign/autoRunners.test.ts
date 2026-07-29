import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { callTouchpointMock } = vi.hoisted(() => ({ callTouchpointMock: vi.fn() }));

vi.mock('@/api/touchpoints', () => ({
  callTouchpoint: callTouchpointMock,
}));

import { AUTO_LIST, loadCards, type Automation, type Card, type Deal } from './autoLive';
import { downloadInvoice, runAutomation, type RunInput } from './autoRunners';

const deal: Deal = {
  id: 'deal-1',
  name: 'Fleet One',
  company: 'Fleet One',
  app: 'app-1',
  carrier: '12345',
  phone: '',
  dealId: 'zoho-deal-1',
};
const card: Card = {
  id: 'card-1',
  number: '7083050000001111',
  status: 'Active',
  driver: '',
  driverId: '',
  unit: '',
};

function action(id: string): Automation {
  const found = AUTO_LIST.find((item) => item.id === id);
  if (!found) throw new Error(`Missing automation ${id}`);
  return found;
}

function input(automation: Automation, patch: Partial<RunInput> = {}): RunInput {
  return {
    action: automation,
    deal,
    card,
    invRange: 'Last 30 Days',
    invStatus: 'all',
    txnRange: 'month',
    limitId: 'ULSD',
    limitValue: '350',
    limitDir: 'increase',
    addr: { address: '', city: '', state: '', zip: '' },
    note: '',
    due: '',
    assignedTo: '',
    priority: '',
    unitDriver: { unitNumber: '', driverName: '', driverId: '' },
    moneyCode: { amount: '', reason: '', unitNumber: '' },
    setInvRows: vi.fn(),
    setTxnReport: vi.fn(),
    ...patch,
  };
}

describe('limit update runner', () => {
  beforeEach(() => callTouchpointMock.mockReset());

  it('sends a 350-gallon delta and returns the resulting EFS limit', async () => {
    callTouchpointMock.mockResolvedValue({
      previousLimit: 200,
      newLimit: 550,
      message: 'Limit updated successfully.',
    });

    await expect(runAutomation(input(action('limits-change')))).resolves.toEqual({
      kind: 'limit-update',
      result: {
        cardNumber: card.number,
        limitId: 'ULSD',
        previousLimit: 200,
        newLimit: 550,
        delta: 350,
        direction: 'increase',
      },
    });
    expect(callTouchpointMock).toHaveBeenCalledWith('efs.card_limits', {
      carrierId: deal.carrier,
      cardNumber: card.number,
      limitId: 'ULSD',
      value: 350,
      action: 'INCREASE',
    });
  });

  it('rejects 351 gallons before making an EFS request', async () => {
    await expect(
      runAutomation(input(action('limits-change'), { limitValue: '351' })),
    ).rejects.toThrow('cannot exceed 350 gallons');
    expect(callTouchpointMock).not.toHaveBeenCalled();
  });
});

describe('live EFS card state', () => {
  beforeEach(() => callTouchpointMock.mockReset());

  it('loads the card picker from EFS before considering DWH', async () => {
    callTouchpointMock.mockResolvedValue({
      data: [{
        cardNumber: card.number,
        status: 'ACTIVE',
        driverName: 'Alice',
        driverId: 'D-7',
        unitNumber: 'U-1',
      }],
    });

    await expect(loadCards(deal.carrier)).resolves.toEqual([
      expect.objectContaining({
        number: card.number,
        status: 'active',
        driver: 'Alice',
        driverId: 'D-7',
        unit: 'U-1',
      }),
    ]);
    expect(callTouchpointMock).toHaveBeenCalledOnce();
    expect(callTouchpointMock).toHaveBeenCalledWith('efs.cards', { carrierId: deal.carrier });
  });

  it('uses the same direct EFS status endpoint for activation and deactivation', async () => {
    callTouchpointMock.mockResolvedValue({ newStatus: 'ACTIVE' });
    await runAutomation(input(action('card-activation')));
    await runAutomation(input(action('card-deactivation')));

    expect(callTouchpointMock).toHaveBeenNthCalledWith(1, 'efs.card_status', {
      carrierId: deal.carrier,
      cardNumber: card.number,
      action: 'ACTIVATE',
    });
    expect(callTouchpointMock).toHaveBeenNthCalledWith(2, 'efs.card_status', {
      carrierId: deal.carrier,
      cardNumber: card.number,
      action: 'DEACTIVATE',
    });
  });

  it('keeps live EFS status and reads the DWH last_used_date fallback', async () => {
    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'efs.cards') {
        return { data: [{ cardNumber: card.number, status: 'ACTIVE' }] };
      }
      return {
        data: [{
          card_number: card.number,
          status: 'Inactive',
          last_used_date: '2026-07-28T13:00:00-04:00',
          days_since_last_use: 1,
          transactions: 12,
        }],
      };
    });

    await expect(runAutomation(input(action('card-last-used')))).resolves.toEqual({
      kind: 'card-last-used',
      rows: [{
        cardNumber: card.number,
        status: 'ACTIVE',
        lastUsed: '2026-07-28T13:00:00-04:00',
        daysSinceLastUse: 1,
        transactions: 12,
        source: 'dwh',
      }],
    });
  });
});

describe('invoice download', () => {
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  beforeEach(() => {
    callTouchpointMock.mockReset();
    anchorClick.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the signed URL directly without a cross-origin fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    callTouchpointMock.mockResolvedValue({
      url: 'https://servercrm.example/api/invoices/100/pdf?download=1&token=signed',
    });

    await downloadInvoice('100', 'pdf', 'INV/100');

    expect(callTouchpointMock).toHaveBeenCalledWith('sales_mytrion.invoice_signed_url', {
      invoiceId: '100',
      type: 'pdf',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledOnce();
  });
});
