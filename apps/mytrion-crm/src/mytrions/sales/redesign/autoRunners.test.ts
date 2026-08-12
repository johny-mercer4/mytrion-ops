import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { callTouchpointMock, requestMock, requestBlobMock } = vi.hoisted(() => ({
  callTouchpointMock: vi.fn(),
  requestMock: vi.fn(),
  requestBlobMock: vi.fn(),
}));

vi.mock('@/api/touchpoints', () => ({
  callTouchpoint: callTouchpointMock,
}));

vi.mock('@/api/transport', () => ({
  request: requestMock,
  requestBlob: requestBlobMock,
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

describe('automation catalog', () => {
  it('publishes Card Status Report under service code C-30', () => {
    expect(action('view-manage-cards').codes).toEqual(['C-30']);
  });
});

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
  beforeEach(() => {
    callTouchpointMock.mockReset();
    requestMock.mockReset();
  });

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

  it('prefers live EFS active card counts over stale carrier overview', async () => {
    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'dwh.carrier_overview') {
        return {
          company_name: 'Divergent',
          is_active: true,
          cards: { count: 4, active_count: 0 },
          cmp_debt: { total_debt: 0 },
        };
      }
      if (key === 'efs.cards') {
        return {
          data: [
            { cardNumber: card.number, status: 'ACTIVE' },
            { cardNumber: '7083050000002222', status: 'INACTIVE' },
          ],
        };
      }
      throw new Error(`unexpected touchpoint ${key}`);
    });

    await expect(runAutomation(input(action('account-status')))).resolves.toEqual({
      kind: 'message',
      message: 'Divergent: account active, 1 active cards, open debt $0.',
    });
    expect(callTouchpointMock).toHaveBeenCalledWith('efs.cards', { carrierId: deal.carrier });
  });

  it('falls back to overview card counts when EFS is unavailable', async () => {
    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'dwh.carrier_overview') {
        return {
          company_name: 'Divergent',
          is_active: true,
          cards: { count: 4, active_count: 2 },
          cmp_debt: { total_debt: 0 },
        };
      }
      if (key === 'efs.cards') throw new Error('EFS down');
      throw new Error(`unexpected touchpoint ${key}`);
    });

    await expect(runAutomation(input(action('account-status')))).resolves.toEqual({
      kind: 'message',
      message: 'Divergent: account active, 2 active cards, open debt $0.',
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

  it('loads the owned carrier Card Lookup roster through the Sales route', async () => {
    const reportRows = [{
      cardId: '1001',
      cardNumber: '007378',
      unit: '995',
      driverId: '995',
      driverName: 'Driver One',
      xRef: '',
      status: 'Active',
      override: 'No',
    }];
    requestMock.mockResolvedValue({ rows: reportRows });

    await expect(runAutomation(input(action('view-manage-cards')))).resolves.toEqual({
      kind: 'card-lookup',
      carrierId: deal.carrier,
      companyName: deal.name,
      rows: reportRows,
    });
    expect(requestMock).toHaveBeenCalledWith('GET', '/sales/cards', {
      query: { carrierId: deal.carrier },
      timeoutMs: 45_000,
    });
  });
});

describe('C-20 request invoices', () => {
  beforeEach(() => {
    callTouchpointMock.mockReset();
  });

  it('loads clients.invoices (CMP) and filters status client-side', async () => {
    const setInvRows = vi.fn();
    callTouchpointMock.mockResolvedValue({
      data: [
        {
          id: 1,
          invoice_number: '177728',
          invoice_date: '2026-08-01',
          total_amount: 200,
          status: 'PARTIALLY_PAID',
        },
        {
          id: 2,
          invoice_number: '177729',
          invoice_date: '2026-08-02',
          total_amount: 100,
          status: 'PAID',
        },
        {
          id: 3,
          invoice_number: '177730',
          invoice_date: '2026-08-03',
          total_amount: 80,
          status: 'PENDING',
        },
      ],
    });

    await expect(
      runAutomation(input(action('invoices'), { setInvRows, invStatus: 'PARTIALLY_PAID' })),
    ).resolves.toEqual({ kind: 'invoices', source: 'cmp' });

    expect(callTouchpointMock).toHaveBeenCalledWith('clients.invoices', {
      carrierId: deal.carrier,
      limit: 500,
    });
    expect(setInvRows).toHaveBeenCalledWith([
      expect.objectContaining({ inv: '177728', status: 'Partially Paid' }),
    ]);
  });
});

describe('C-18 check payment information', () => {
  beforeEach(() => {
    callTouchpointMock.mockReset();
  });

  it('shows CMP amounts to the cent and does not call a part-paid invoice Paid', async () => {
    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'dwh.payment_info') {
        return {
          invoices: { count: 13, totals: { total_billed: 384_817.4, total_paid: 341_320.57, open_balance: 43_496.83 } },
          payments: { count: 26, total_amount: 340_174.11 },
        };
      }
      return {
        invoices: [
          // CMP's own numbers contradict its status string — this is carrier 5815660's invoice.
          { id: 1, invoiceNumber: '178238', status: 'PAID', totalAmount: 43_495.62, totalPaid: 10_000, remainingAmount: 33_495.62 },
          { id: 2, invoiceNumber: '176639', status: 'PAID', totalAmount: 53_026.51, totalPaid: 53_026.51, remainingAmount: 0 },
          { id: 3, invoiceNumber: '176640', status: 'PAID', totalAmount: 1_200, totalPaid: 0, remainingAmount: 1_200 },
        ],
      };
    });

    const out = await runAutomation(input(action('payments')));
    if (out.kind !== 'payments') throw new Error(`expected payments, got ${out.kind}`);

    // Exact to the cent — 43,495.62 must not read as 43,496.
    expect(out.cmpInvoices[0]).toMatchObject({
      invoiceNumber: '178238',
      status: 'Partially Paid',
      total: '$43,495.62',
      paid: '$10,000.00',
      remaining: '$33,495.62',
    });
    expect(out.cmpInvoices[1]).toMatchObject({ status: 'Paid', total: '$53,026.51' });
    // Nothing paid at all is Pending, not "Partially Paid".
    expect(out.cmpInvoices[2]).toMatchObject({ status: 'Pending' });
    expect(out.summary).toEqual({
      invoiceCount: '13',
      totalBilled: '$384,817.40',
      totalPaid: '$341,320.57',
      openBalance: '$43,496.83',
      paymentCount: '26',
    });
    // "Payments total" is gone — "Total paid" is the number the team reads.
    expect(out.summary && 'paymentsTotal' in out.summary).toBe(false);
  });
});

describe('C-18 merges the two CMP invoice sources', () => {
  beforeEach(() => {
    callTouchpointMock.mockReset();
  });

  it('takes status and total from clients.invoices, paid/remaining from the Deluge', async () => {
    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'dwh.payment_info') return {};
      if (key === 'carrier.check_payment') {
        return {
          invoices: [
            { id: 1, invoiceNumber: '178238', status: 'PAID', totalAmount: 43_496, totalPaid: 10_000, remainingAmount: 33_495.62 },
          ],
        };
      }
      return {
        data: [
          { id: 1, invoice_number: '178238', status: 'PARTIALLY_PAID', total_amount: 43_495.62 },
          { id: 9, invoice_number: '178901', status: 'PENDING', total_amount: 900.25 },
        ],
      };
    });

    const out = await runAutomation(input(action('payments')));
    if (out.kind !== 'payments') throw new Error(`expected payments, got ${out.kind}`);

    expect(out.cmpInvoices).toEqual([
      {
        id: '1',
        invoiceNumber: '178238',
        status: 'Partially Paid',
        total: '$43,495.62',
        paid: '$10,000.00',
        remaining: '$33,495.62',
      },
      // Live-only invoice: the Deluge never returned it, and it is still a real invoice.
      { id: '9', invoiceNumber: '178901', status: 'Pending', total: '$900.25', paid: '$0.00', remaining: '$0.00' },
    ]);
  });

  it('renders on one source when the other fails, and only errors when both do', async () => {
    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'dwh.payment_info') return {};
      if (key === 'carrier.check_payment') throw new Error('Deluge timeout');
      return { data: [{ id: 4, invoice_number: '178300', status: 'PAID', total_amount: 10 }] };
    });
    const ok = await runAutomation(input(action('payments')));
    if (ok.kind !== 'payments') throw new Error(`expected payments, got ${ok.kind}`);
    expect(ok.cmpError).toBeUndefined();
    expect(ok.cmpInvoices).toHaveLength(1);

    callTouchpointMock.mockImplementation(async (key: string) => {
      if (key === 'dwh.payment_info') return {};
      throw new Error('CMP unreachable');
    });
    const bad = await runAutomation(input(action('payments')));
    if (bad.kind !== 'payments') throw new Error(`expected payments, got ${bad.kind}`);
    expect(bad.cmpError).toBe('CMP unreachable');
    expect(bad.cmpInvoices).toEqual([]);
  });
});

describe('invoice download', () => {
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  beforeEach(() => {
    callTouchpointMock.mockReset();
    requestMock.mockReset();
    requestBlobMock.mockReset();
    anchorClick.mockClear();
    // jsdom ships no object-URL implementation; deliverBlob needs both halves.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.MytrionDownload;
  });

  /** The desktop path is the one that actually produces a file — see downloadInvoice's comment. */
  it('fetches the bytes from our own origin and delivers them as a blob', async () => {
    requestBlobMock.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));

    await downloadInvoice('100', 'pdf', 'INV/100', '12345');

    expect(requestBlobMock).toHaveBeenCalledWith('/sales/invoices/100/pdf?carrierId=12345');
    // No signed-URL round trip on desktop: the proxy carries the key for us.
    expect(callTouchpointMock).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledOnce();
  });

  it('rejects an empty body instead of reporting a phantom success', async () => {
    requestBlobMock.mockResolvedValue(new Blob([], { type: 'application/pdf' }));

    await expect(downloadInvoice('100', 'excel', 'INV/100', '12345')).rejects.toThrow(/No EXCEL available/i);
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('requires a carrier scope before requesting invoice bytes', async () => {
    await expect(downloadInvoice('100', 'pdf', 'INV/100')).rejects.toThrow(/Pick a client/i);
    expect(requestBlobMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('falls back to the signed URL inside the Zoho app WebView (blob URLs die on the tab hop)', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    window.MytrionDownload = { deliverBlob: vi.fn(), isMobileWebView: () => true };
    requestMock.mockResolvedValue({ url: 'https://servercrm.example/signed?token=abc' });

    await downloadInvoice('100', 'pdf', 'INV/100', '12345');

    expect(requestMock).toHaveBeenCalledWith(
      'GET',
      '/sales/invoices/100/pdf/signed-url?carrierId=12345',
    );
    expect(requestBlobMock).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://servercrm.example/signed?token=abc', '_blank', 'noopener');
  });
});
