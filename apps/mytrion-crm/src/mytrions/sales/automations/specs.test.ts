/**
 * Automation runner composition: payments falls back to the Deluge CMP check only when
 * the servercrm window fails; wex-tasks survives one leg failing (partial sections) but
 * not both; card-activation only pushes unit/driver info when provided; fraud release
 * requires a session email and sends the session's, not a typed one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/touchpoints', () => ({ callTouchpoint: callMock, logAutomation: vi.fn() }));

import { AUTOMATION_SPECS, type AutomationTarget } from './specs';

const target: AutomationTarget = {
  carrierId: '5796646',
  applicationId: '9001',
  companyName: 'HORSERIDER INC',
};
const input = { fields: {} };

const SESSION_KEY = 'octane.session.v1';
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: 't',
      refreshToken: 'r',
      worker: { zohoUserId: '42', userName: 'Robiya', email: 'robiya@octane.test' },
    }),
  );
});

describe('payments', () => {
  it('uses payment_info and does NOT call the Deluge fallback on success', async () => {
    callMock.mockResolvedValueOnce({ invoices: { count: 2, totals: { total_billed: 100 } }, payments: { count: 1 } });
    const out = await AUTOMATION_SPECS.payments!.run(target, input);
    expect(out.kind).toBe('sections');
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith('dwh.payment_info', { carrierId: '5796646', days: 90 });
  });

  it('falls back to carrier.check_payment when payment_info throws', async () => {
    callMock
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce({ invoices: [{ invoiceNumber: 'INV-1', status: 'PAID', totalAmount: 10 }] });
    const out = await AUTOMATION_SPECS.payments!.run(target, input);
    expect(out.kind).toBe('table');
    expect(callMock).toHaveBeenNthCalledWith(2, 'carrier.check_payment', { carrierId: '5796646' });
  });
});

describe('wex-tasks', () => {
  it('renders partial sections when one leg fails', async () => {
    callMock.mockImplementation(async (key: string) => {
      if (key === 'application.update') throw new Error('deluge broke');
      return { status: 'APPROVED', statusGroup: 'Open', lastModified: 'today' };
    });
    const out = await AUTOMATION_SPECS['wex-tasks']!.run(target, input);
    if (out.kind !== 'sections') throw new Error('expected sections');
    expect(out.sections.some((s) => s.error)).toBe(true);
    expect(out.sections.some((s) => !s.error)).toBe(true);
  });

  it('throws when BOTH legs fail and when the target has no application id', async () => {
    callMock.mockRejectedValue(new Error('down'));
    await expect(AUTOMATION_SPECS['wex-tasks']!.run(target, input)).rejects.toThrow();
    await expect(
      AUTOMATION_SPECS['wex-tasks']!.run({ ...target, applicationId: null }, input),
    ).rejects.toThrow(/application id/);
  });
});

describe('card-activation', () => {
  it('activates, and only calls efs.card_info when unit/driver provided', async () => {
    callMock.mockResolvedValue({});
    await AUTOMATION_SPECS['card-activation']!.run(target, { fields: { cardNumber: '7083051234' } });
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith('dwh.card_activate', {
      carrierId: '5796646',
      cardNumber: '7083051234',
    });

    callMock.mockClear();
    await AUTOMATION_SPECS['card-activation']!.run(target, {
      fields: { cardNumber: '7083051234', unitNumber: '12' },
    });
    expect(callMock).toHaveBeenNthCalledWith(2, 'efs.card_info', {
      carrierId: '5796646',
      cardNumber: '7083051234',
      unitNumber: '12',
    });
  });
});

describe('fraud-hold', () => {
  it("sends the SESSION email and the target's company", async () => {
    callMock.mockResolvedValue({});
    const out = await AUTOMATION_SPECS['fraud-hold']!.run(target, { fields: { cardNumber: '7083059999' } });
    expect(out.kind).toBe('ack');
    expect(callMock).toHaveBeenCalledWith('fraud.hold_release', {
      companyName: 'HORSERIDER INC',
      carrierId: '5796646',
      agentEmail: 'robiya@octane.test',
      cardNumber: '7083059999',
      ticketType: 'fraud_release',
    });
  });

  it('refuses to run without a session email', async () => {
    localStorage.clear();
    await expect(
      AUTOMATION_SPECS['fraud-hold']!.run(target, { fields: { cardNumber: 'x' } }),
    ).rejects.toThrow(/email/);
    expect(callMock).not.toHaveBeenCalled();
  });
});

describe('carrier requirement', () => {
  it('carrier-keyed specs refuse a target without a carrier id', async () => {
    await expect(
      AUTOMATION_SPECS.balance!.run({ ...target, carrierId: null }, input),
    ).rejects.toThrow(/carrier id/);
    expect(callMock).not.toHaveBeenCalled();
  });
});

describe('invoices range', () => {
  it('passes custom from/to when both set, else last_30', async () => {
    callMock.mockResolvedValue({ data: [] });
    await AUTOMATION_SPECS.invoices!.run(target, { from: '2026-06-01', to: '2026-06-30', fields: {} });
    expect(callMock).toHaveBeenCalledWith('sales_mytrion.fetch_invoices', {
      carrierId: '5796646',
      range: 'custom',
      from: '2026-06-01',
      to: '2026-06-30',
    });
    callMock.mockClear();
    await AUTOMATION_SPECS.invoices!.run(target, input);
    expect(callMock).toHaveBeenCalledWith('sales_mytrion.fetch_invoices', {
      carrierId: '5796646',
      range: 'last_30',
    });
  });
});
