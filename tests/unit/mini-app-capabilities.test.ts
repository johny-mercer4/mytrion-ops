import { describe, expect, it } from 'vitest';

import { RBACError } from '../../src/lib/errors.js';
import {
  MINI_APP_CAPABILITIES,
  assertMiniAppCapability,
  miniAppCapabilitiesFor,
  miniAppHasCapability,
} from '../../src/modules/carrier/miniAppCapabilities.js';

describe('mini-app capability policy', () => {
  it('gives owners and managers the complete capability set', () => {
    expect(miniAppCapabilitiesFor('owner')).toEqual(MINI_APP_CAPABILITIES);
    expect(miniAppCapabilitiesFor('manager')).toEqual(MINI_APP_CAPABILITIES);
  });

  it('lets drivers read their company context, operate their own card, and send reports', () => {
    expect(miniAppCapabilitiesFor('driver')).toEqual([
      'company:read',
      'card:write',
      'reports:send',
    ]);
    expect(miniAppHasCapability('driver', 'financial:read')).toBe(false);
    expect(miniAppHasCapability('driver', 'fleet:manage')).toBe(false);
    expect(miniAppHasCapability('driver', 'access:manage')).toBe(false);
  });

  it('gives sales agents the complete owner-like set, including registration-link access', () => {
    expect(miniAppCapabilitiesFor('sales_agent')).toEqual(MINI_APP_CAPABILITIES);
    expect(miniAppHasCapability('sales_agent', 'access:manage')).toBe(true);
  });

  it('returns a stable RBAC error when a capability is denied', () => {
    expect(() => assertMiniAppCapability('driver', 'access:manage')).toThrow(RBACError);
    let denied: unknown;
    try {
      assertMiniAppCapability('driver', 'financial:read');
    } catch (error) {
      denied = error;
    }
    expect(denied).toMatchObject({
      statusCode: 403,
      code: 'MINI_APP_CAPABILITY_DENIED',
      details: { capability: 'financial:read' },
    });
  });
});
