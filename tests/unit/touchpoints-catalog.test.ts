/**
 * Touchpoint catalog invariants: key uniqueness, full coverage of the legacy widget's remaining
 * Deluge functions, schema accept/reject sanity, the exact destructive set, and the
 * identity/carrier scoping annotations every user-/carrier-keyed entry must carry.
 */
import { describe, expect, it } from 'vitest';
import { getTouchpoint, listTouchpoints } from '../../src/modules/touchpoints/catalog/index.js';

const all = listTouchpoints();

/**
 * Legacy widget Deluge functions still served via `kind: 'deluge'`. Migrated to native TypeScript
 * handlers (kind: 'local') and therefore intentionally ABSENT from this list:
 *   - dashboards → src/integrations/salesDashboards.ts (mytrionhomesnapshot, mytrionAgentSalesDashboard,
 *     mytriondbdebtorsinfo, mytrioncompanydashboard);
 *   - CRM-backed → src/integrations/salesCrmActions.ts (mytrionfetchannouncements, mytrionfetchinbox,
 *     mytriondeleteinboxmessage, mytrioncreatelead, mytrionapplicationupdate, mytriontruckingnumberrequest).
 *
 * Also absent, for a different reason — the data moved OUT of Zoho rather than the handler moving
 * into TypeScript: `createmaintenance` and `mytrionGetMaintenanceAnalytics`. Maintenance lives in our
 * `maintenance_cases` table, served by /cs/maintenance and /cs/analytics/maintenance, so no touchpoint
 * may read or write it in Zoho. The Deluge functions themselves still exist in Zoho for the in-Zoho
 * widgets that call them directly — they are simply not reachable through this catalog.
 */
const WIDGET_DELUGE_FUNCTIONS = [
  'mytrionCallback',
  'mytrionCheckPayment',
  'mytrionfetchbillingforminfo',
  'mytrioncardstatus',
  'mytrioncardlimits',
  'mytriondatacenterleads',
] as const;

describe('catalog shape', () => {
  it('has unique keys and the expected size', () => {
    const keys = all.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Billing has ZERO Deluge touchpoints now — the whole Transactions/Returns/carrier surface,
    // including the mapping-picker invoice search (mytrionSearchInvoices → GET /billing/invoices/
    // search, a CMP read via servercrm), moved off Deluge. Two waves of Sales touchpoints migrated
    // Deluge→native (kind: 'local'): 4 dashboards + 6 CRM-backed (inbox/announcements/leads/
    // application/trucking), dropping the deluge count 30→20; billing's last one drops it to 19.
    // Then Maintenance moved out of Zoho entirely: cs.analytics.maintenance and maintenance.create went
    // once maintenance_cases became the source of truth (19 → 17), and TICKETING removed the last four
    // when Sales briefly moved to /v1/comms (17 → 13). Sales then went BACK to filing in Zoho Desk, so
    // `tickets.create_in_crm` and `tickets.create_escalation` are live again (13 → 15). The two
    // `tickets.upload_*` attachment touchpoints did NOT come back: the routes attach through the Desk
    // API directly, and those two had no callers even before the removal. Then `cs.applications.list`
    // moved off `mytrionGetApplications` to a direct-COQL `kind: 'local'` handler (2026-08-13, global
    // sort/filter — the Deluge function had no expressible path for the Deal-owner join anyway) (15 → 14).
    expect(all.filter((t) => t.kind === 'deluge')).toHaveLength(14);
    // Includes direct EFS card-status and delta-limit writes used by Sales automations.
    expect(all.filter((t) => t.kind === 'servercrm')).toHaveLength(50);
    // BOCA and Close Application are guarded local handlers around Playwright.
    expect(all.filter((t) => t.kind === 'browserauto')).toHaveLength(0);
    expect(all.filter((t) => t.kind === 'zapier')).toHaveLength(1);
  });

  it('billing touchpoints are billing-gated and portfolio-wide (no owner scoping)', () => {
    const billing = all.filter((t) => t.key.startsWith('billing.'));
    // 7 servercrm touchpoints (DWH/prepay reads); everything else — including the invoice-search
    // mapping picker — is now a Postgres-backed / servercrm-proxied REST route, no Deluge.
    expect(billing).toHaveLength(7);
    for (const tp of billing) {
      expect(tp.departments, `${tp.key} must be billing-gated`).toEqual(['billing']);
      // Billing is a portfolio role: no per-agent carrier ownership gate (would wrongly
      // block agents from carriers not on their personal roster).
      expect(tp.carrierParam, `${tp.key} must NOT be owner-scoped`).toBeUndefined();
    }
    // Money-adjacent mapping writes are 'write' (billing's core job), never 'destructive'.
    expect(billing.some((t) => t.riskClass === 'destructive')).toBe(false);
  });

  it('finance touchpoints are finance-department scoped and cover the widget surface', () => {
    const finance = all.filter((t) => t.key.startsWith('finance.'));
    expect(finance).toHaveLength(21);
    for (const tp of finance) {
      expect(tp.departments, `${tp.key} must be finance-gated`).toEqual(['finance']);
    }
    // The widget's three Deluge functions, exactly.
    const fns = finance.flatMap((t) => (t.kind === 'deluge' ? [...t.functionNames] : []));
    expect(fns.sort()).toEqual([
      'mytrionfetchsmartevents',
      'mytrionfinancebalancerun',
      'mytrionfinanceparentsnapshot',
    ]);
    // balance_run is the only finance write; everything else is read-only.
    expect(finance.filter((t) => t.riskClass !== 'read').map((t) => t.key)).toEqual([
      'finance.balance_run',
    ]);
    // Finance client drilldowns are org-wide: no per-agent carrier ownership gate.
    for (const key of ['finance.client_invoices', 'finance.client_payments', 'finance.client_recent_transactions']) {
      expect(getTouchpoint(key)?.carrierParam, `${key} must NOT be owner-scoped`).toBeUndefined();
    }
  });

  it('finance list filters accept scalars and reject junk keys', () => {
    const list = getTouchpoint('finance.main_transactions');
    expect(list?.paramsSchema.parse({ limit: 50, page: 2, search: 'ZHU LLC' })).toEqual({
      limit: 50,
      page: 2,
      search: 'ZHU LLC',
    });
    expect(() => list?.paramsSchema.parse({ 'bad key!': 'x' })).toThrow();
  });

  it('covers every legacy Deluge function (primary names)', () => {
    const covered = new Set(
      all.flatMap((t) => (t.kind === 'deluge' ? [...t.functionNames] : [])),
    );
    for (const fn of WIDGET_DELUGE_FUNCTIONS) {
      expect(covered, `missing Deluge function ${fn}`).toContain(fn);
    }
  });

  it('flags exactly the destructive touchpoints', () => {
    const destructive = all
      .filter((t) => t.riskClass === 'destructive')
      .map((t) => t.key)
      .sort();
    expect(destructive).toEqual([
      'cards.limits',
      'cards.status',
      'dwh.money_code_draw',
      'efs.card_limits',
      'efs.card_override',
      'efs.card_status',
      'fraud.hold_release',
      'money_code.void',
    ]);
  });

  it('every servercrm {carrierId} template declares carrierParam; user-keyed entries declare identityParam', () => {
    for (const tp of all) {
      // finance.* drilldowns are deliberately org-wide (widget parity) — exempt.
      if (tp.kind === 'servercrm' && tp.pathTemplate.includes('{carrierId}') && !tp.key.startsWith('finance.')) {
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

    const efsLimits = getTouchpoint('efs.card_limits');
    expect(
      efsLimits?.paramsSchema.parse({
        carrierId: '1',
        cardNumber: '7083051234',
        limitId: 'ULSD',
        value: 350,
        action: 'DECREASE',
      }),
    ).toMatchObject({ value: 350, action: 'DECREASE' });
    expect(() =>
      efsLimits?.paramsSchema.parse({
        carrierId: '1',
        cardNumber: '7083051234',
        limitId: 'ULSD',
        value: 351,
        action: 'INCREASE',
      }),
    ).toThrow();

    const lead = getTouchpoint('leads.create');
    expect(() =>
      lead?.paramsSchema.parse({
        createPayload: { firstName: 'A', lastName: 'B', companyName: 'C Trucking', phone: '5551234567', dot: '123' },
      }),
    ).not.toThrow();
  });

  it('uses the DWH range vocabulary for /api/agent/dwh/* and the sales vocabulary for salesMytrion', () => {
    const tx = getTouchpoint('dwh.transactions');
    expect(() => tx?.paramsSchema.parse({ carrierId: '1', range: 'month' })).not.toThrow();
    // 'last_30' belongs to the salesMytrion endpoint, NOT the DWH agent endpoints.
    expect(() => tx?.paramsSchema.parse({ carrierId: '1', range: 'last_30' })).toThrow();

    const inv = getTouchpoint('sales_mytrion.fetch_invoices');
    expect(() => inv?.paramsSchema.parse({ carrierId: '1', range: 'last_30' })).not.toThrow();
    expect(() => inv?.paramsSchema.parse({ carrierId: '1', range: 'month' })).toThrow();
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
