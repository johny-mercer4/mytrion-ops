import { describe, expect, it } from 'vitest';

import type { UserContext } from '@/context/userContext';

import {
  ANALYTICS_CATEGORIES,
  resolveAnalyticsCategory,
  visibleAnalyticsCategories,
} from './categories';

function analyticsUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: '1',
    profile: 'Sales Agent',
    role: 'Analytics Specialist',
    userName: 'Analyst User',
    trusted: true,
    accessibleMytrions: ['analyst'],
    allDepartmentAccess: false,
    ...overrides,
  };
}

describe('Analytics category navigation', () => {
  it('places Mytrion after Transactions and before Reports without changing Sales landing', () => {
    const ids = ANALYTICS_CATEGORIES.map((category) => category.id);
    expect(ids[0]).toBe('sales');
    expect(ids.slice(-3)).toEqual(['transactions', 'mytrion', 'reports']);
  });

  it('shows Mytrion to verified Analytics users while keeping Reports management-only', () => {
    const ids = visibleAnalyticsCategories(analyticsUser()).map((category) => category.id);
    expect(ids).toContain('mytrion');
    expect(ids).not.toContain('reports');
  });

  it('allows all-department operators to see both management categories', () => {
    const ids = visibleAnalyticsCategories(
      analyticsUser({ accessibleMytrions: [], allDepartmentAccess: true }),
    ).map((category) => category.id);
    expect(ids).toContain('mytrion');
    expect(ids).toContain('reports');
  });

  it('keeps the cross-agent Mytrion tab available while an admin previews another user', () => {
    const viewedUser = analyticsUser({ accessibleMytrions: ['sales'], allDepartmentAccess: false });
    const principal = analyticsUser({ accessibleMytrions: [], allDepartmentAccess: true });
    expect(visibleAnalyticsCategories(viewedUser, principal).map((category) => category.id)).toContain(
      'mytrion',
    );
  });

  it('resolves a hidden deep link to the first visible category', () => {
    const user = analyticsUser({ mytrionTabGrants: { analyst: ['crm', 'transactions'] } });
    expect(resolveAnalyticsCategory(user, 'mytrion').id).toBe('crm');
    expect(resolveAnalyticsCategory(user, 'reports').id).toBe('crm');
  });
});
