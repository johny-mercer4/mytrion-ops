/**
 * Touchpoint catalog invariants: key uniqueness, full coverage of the legacy widget's 21
 * Deluge functions, schema accept/reject sanity, the exact destructive set, and the
 * identity/carrier scoping annotations every user-/carrier-keyed entry must carry.
 */
import { describe, expect, it } from 'vitest';
import { getTouchpoint, listTouchpoints } from '../../src/modules/touchpoints/catalog/index.js';

const all = listTouchpoints();

/** The widget's 21 unique Deluge functions (SELF_SERVICE_API_TOUCHPOINTS golden list). */
const WIDGET_DELUGE_FUNCTIONS = [
  'mytrionCallback',
  'mytrionapplicationupdate',
  'mytriontruckingnumberrequest',
  'mytrionCheckPayment',
  'mytrionfetchbillingforminfo',
  'mytrioncardstatus',
  'mytrioncardlimits',
  'mytrionSearchInvoices',
  'mytrionAgentSalesDashboard',
  'mytrioncompanydashboard',
  'mytriondbdebtorsinfo',
  'mytrionhomesnapshot',
  'mytrionfetchannouncements',
  'mytrioncreatelead',
  'createescalationticket',
  'createticketincrm',
  'uploadticketattachment',
  'uploadescalationattachment',
  'createmaintenance',
  'mytrionfetchinbox',
  'mytriondeleteinboxmessage',
  'mytriondatacenterleads',
] as const;

describe('catalog shape', () => {
  it('has unique keys and the expected size', () => {
    const keys = all.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.filter((t) => t.kind === 'deluge')).toHaveLength(22);
    expect(all.filter((t) => t.kind === 'servercrm')).toHaveLength(26);
  });

  it('covers every legacy Deluge function (primary names)', () => {
    const covered = new Set(
      all.flatMap((t) => (t.kind === 'deluge' ? [...t.functionNames] : [])),
    );
    for (const fn of WIDGET_DELUGE_FUNCTIONS) {
      expect(covered, `missing Deluge function ${fn}`).toContain(fn);
    }
  });

  it('flags exactly the five destructive touchpoints', () => {
    const destructive = all
      .filter((t) => t.riskClass === 'destructive')
      .map((t) => t.key)
      .sort();
    expect(destructive).toEqual([
      'cards.limits',
      'cards.status',
      'dwh.money_code_draw',
      'efs.card_override',
      'fraud.hold_release',
    ]);
  });

  it('every servercrm {carrierId} template declares carrierParam; user-keyed entries declare identityParam', () => {
    for (const tp of all) {
      if (tp.kind === 'servercrm' && tp.pathTemplate.includes('{carrierId}')) {
        expect(tp.carrierParam, `${tp.key} needs carrierParam`).toBe('carrierId');
      }
      if (tp.kind === 'servercrm' && tp.pathTemplate.includes('{zohoUserId}')) {
        expect(tp.identityParam, `${tp.key} needs identityParam`).toBe('zohoUserId');
      }
    }
    // Deluge functions keyed on userId in the widget must inject the session identity.
    for (const key of [
      'user.callback',
      'dashboard.company',
      'dashboard.debtors',
      'dashboard.agent_sales',
      'dashboard.home_snapshot',
      'inbox.list',
      'leads.datacenter',
      'leads.create',
      'tickets.create_escalation',
    ]) {
      expect(getTouchpoint(key)?.identityParam, `${key} needs identityParam`).toBe('userId');
    }
  });
});

describe('param schemas', () => {
  it('accepts golden samples and coerces ids to strings', () => {
    const balance = getTouchpoint('dwh.carrier_balance');
    expect(balance?.paramsSchema.parse({ carrierId: 5796646 })).toEqual({ carrierId: '5796646' });

    const limits = getTouchpoint('cards.limits');
    expect(
      limits?.paramsSchema.parse({
        carrierId: '1',
        cardNumber: '7083051234',
        limitId: 'ULSD',
        limitValue: 300,
        action: 'INCREASE',
      }),
    ).toMatchObject({ limitValue: '300', action: 'INCREASE' });

    const lead = getTouchpoint('leads.create');
    expect(() =>
      lead?.paramsSchema.parse({
        createPayload: { firstName: 'A', lastName: 'B', companyName: 'C Trucking', phone: '5551234567', dot: '123' },
      }),
    ).not.toThrow();
  });

  it('rejects missing required params and smuggled enum values', () => {
    const status = getTouchpoint('cards.status');
    expect(() => status?.paramsSchema.parse({ carrierId: '1', cardNumber: '7083051234' })).toThrow();
    expect(() =>
      status?.paramsSchema.parse({ carrierId: '1', cardNumber: '7083051234', action: 'DELETE' }),
    ).toThrow();

    const fraud = getTouchpoint('fraud.hold_release');
    expect(() =>
      fraud?.paramsSchema.parse({
        companyName: 'X',
        carrierId: '1',
        agentEmail: 'not-an-email',
        cardNumber: '7083051234',
      }),
    ).toThrow();
  });
});
