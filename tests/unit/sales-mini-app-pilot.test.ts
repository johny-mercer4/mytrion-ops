import { describe, expect, it } from 'vitest';

import {
  SALES_MINI_APP_PILOT_AGENTS,
  assertSalesMiniAppPilotAgent,
  isSalesMiniAppPilotAgent,
} from '../../src/modules/carrier/salesMiniAppPilot.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const DANIEL = '6227679000031473048';
/** Another real Sales Agent from the same directory — same role, not in the pilot. */
const OTHER_SALES_AGENT = '6227679000023144026';

function ctx(overrides: Partial<TenantContext> & { userId: string }): TenantContext {
  return {
    tenantId: 'octane',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'req_test',
    ...overrides,
  } as TenantContext;
}

describe('Sales mini-app pilot roster', () => {
  it('lets the pilot agent through and nobody else with the same role', () => {
    expect(isSalesMiniAppPilotAgent(ctx({ userId: `zoho:${DANIEL}` }))).toBe(true);
    expect(isSalesMiniAppPilotAgent(ctx({ userId: `zoho:${OTHER_SALES_AGENT}` }))).toBe(false);
  });

  it('matches on the Zoho id, never the display name', () => {
    // A rename must not remove access, and taking the name "Daniel Brown" must not grant it.
    expect(isSalesMiniAppPilotAgent(ctx({ userId: `zoho:${DANIEL}`, userName: 'Renamed Person' }))).toBe(true);
    expect(
      isSalesMiniAppPilotAgent(ctx({ userId: `zoho:${OTHER_SALES_AGENT}`, userName: 'Daniel Brown' })),
    ).toBe(false);
  });

  it('keeps the admin bypass but not through "View as"', () => {
    expect(isSalesMiniAppPilotAgent(ctx({ userId: 'zoho:999', role: 'admin' }))).toBe(true);
    // Admin viewing as a non-pilot agent sees that agent's Sales, pilot membership included.
    expect(
      isSalesMiniAppPilotAgent(
        ctx({ userId: `zoho:${OTHER_SALES_AGENT}`, role: 'admin', impersonatorUserId: 'zoho:999' }),
      ),
    ).toBe(false);
    // ...and viewing as the pilot agent does show it.
    expect(
      isSalesMiniAppPilotAgent(
        ctx({ userId: `zoho:${DANIEL}`, role: 'worker', impersonatorUserId: 'zoho:999' }),
      ),
    ).toBe(true);
  });

  it('rejects an unverified or non-Zoho identity', () => {
    expect(isSalesMiniAppPilotAgent(ctx({ userId: DANIEL }))).toBe(false);
    expect(isSalesMiniAppPilotAgent(ctx({ userId: 'tg:12345' }))).toBe(false);
  });

  it('throws a named RBAC error for everyone outside the roster', () => {
    expect(() =>
      assertSalesMiniAppPilotAgent(ctx({ userId: `zoho:${OTHER_SALES_AGENT}` }), 'Opening the Sales mini-app'),
    ).toThrow(/Opening the Sales mini-app is limited to the Sales mini-app pilot agents/);
    expect(() =>
      assertSalesMiniAppPilotAgent(ctx({ userId: `zoho:${DANIEL}` }), 'Opening the Sales mini-app'),
    ).not.toThrow();
  });

  it('is one named agent today', () => {
    expect(SALES_MINI_APP_PILOT_AGENTS).toEqual([{ zohoUserId: DANIEL, name: 'Daniel Brown' }]);
  });
});
