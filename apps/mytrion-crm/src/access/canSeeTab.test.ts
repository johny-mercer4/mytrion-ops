import { describe, expect, it } from 'vitest';
import { canSeeTab, firstVisibleTab } from './resolveAccess';
import type { UserContext } from '../context/userContext';

function user(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'u1',
    profile: 'Standard',
    role: 'Agent',
    userName: 'Robiya',
    trusted: true,
    allDepartmentAccess: false,
    ...overrides,
  };
}

describe('canSeeTab', () => {
  it('shows every tab when the Mytrion is UNSCOPED', () => {
    /**
     * The rollout default, and the single most important behaviour here.
     *
     * A Mytrion absent from `mytrionTabGrants` is unrestricted — including for tabs that did not
     * exist when the grant was written. Invert this and every scoped user loses a tab silently the
     * day it ships, with nothing in the UI explaining why.
     */
    const u = user({ mytrionTabGrants: { hr: ['home'] } });
    expect(canSeeTab(u, 'billing', 'ledger')).toBe(true);
    expect(canSeeTab(u, 'billing', 'a-tab-invented-tomorrow')).toBe(true);
  });

  it('filters to the granted list when the Mytrion IS scoped', () => {
    const u = user({ mytrionTabGrants: { billing: ['ledger', 'debtors'] } });
    expect(canSeeTab(u, 'billing', 'ledger')).toBe(true);
    expect(canSeeTab(u, 'billing', 'transactions')).toBe(false);
  });

  it('treats an EMPTY scope as "no tabs", not as unscoped', () => {
    const u = user({ mytrionTabGrants: { billing: [] } });
    expect(canSeeTab(u, 'billing', 'ledger')).toBe(false);
  });

  it('keys on the (mytrion, tab) PAIR, not the key alone', () => {
    // `home` exists in six workspaces and means six different destinations.
    const u = user({ mytrionTabGrants: { hr: ['home'], finance: ['clients'] } });
    expect(canSeeTab(u, 'hr', 'home')).toBe(true);
    expect(canSeeTab(u, 'finance', 'home')).toBe(false);
  });

  it('bypasses for an admin', () => {
    const u = user({ allDepartmentAccess: true, mytrionTabGrants: { billing: [] } });
    expect(canSeeTab(u, 'billing', 'ledger')).toBe(true);
  });

  it('shows everything when no grants exist at all', () => {
    expect(canSeeTab(user(), 'billing', 'ledger')).toBe(true);
  });
});

describe('firstVisibleTab', () => {
  const TABS = [
    { key: 'home' },
    { key: 'parked', soon: true },
    { key: 'ledger' },
  ];

  it('skips a hidden tab', () => {
    const u = user({ mytrionTabGrants: { billing: ['ledger'] } });
    expect(firstVisibleTab(u, 'billing', TABS)?.key).toBe('ledger');
  });

  it('skips a `soon` tab even when it is granted', () => {
    // `soon` is a build status and a grant is a permission — they compose, and neither is expressed
    // in terms of the other. Landing someone on a ComingSoon panel by default is not useful.
    const u = user({ mytrionTabGrants: { billing: ['parked', 'ledger'] } });
    expect(firstVisibleTab(u, 'billing', TABS)?.key).toBe('ledger');
  });

  it('honours a preferred tab when it is visible — the deep-link case', () => {
    expect(firstVisibleTab(user(), 'billing', TABS, 'ledger')?.key).toBe('ledger');
  });

  it('falls back rather than failing when the preferred tab is forbidden', () => {
    // A stale bookmark should land somewhere sensible, not on an error.
    const u = user({ mytrionTabGrants: { billing: ['home'] } });
    expect(firstVisibleTab(u, 'billing', TABS, 'ledger')?.key).toBe('home');
  });

  it('returns undefined when nothing is visible', () => {
    const u = user({ mytrionTabGrants: { billing: [] } });
    expect(firstVisibleTab(u, 'billing', TABS)).toBeUndefined();
  });
});
