import { describe, it, expect } from 'vitest';
import type { UserContext } from '../context/userContext';
import { resolveAccessibleMytrions, canAccess, canManageHr, isAdmin, ruleAllows } from './resolveAccess';
import { COMING_SOON_MYTRION_IDS, MYTRIONS } from './mytrions.config';

function ctx(over: Partial<UserContext>): UserContext {
  return { userId: 'u', profile: '', role: '', userName: '', trusted: false, ...over };
}

describe('resolveAccessibleMytrions', () => {
  it('a "Sales Agent" profile gets ONLY sales → auto-enters /m/sales', () => {
    const { accessible } = resolveAccessibleMytrions(ctx({ profile: 'Sales Agent', role: 'Uzbekistan Sales Agent' }));
    expect(accessible).toEqual(['sales']);
  });

  it('matches a profile that CONTAINS "Sales Agent" (case-insensitive, variants)', () => {
    for (const profile of ['Senior Sales Agent', 'sales agent - US', 'SALES AGENT']) {
      const { accessible } = resolveAccessibleMytrions(ctx({ profile }));
      expect(accessible, profile).toEqual(['sales']);
    }
  });

  it('does NOT grant sales to an unrelated profile', () => {
    expect(canAccess(ctx({ profile: 'Sales Processing Manager' }), 'sales')).toBe(false);
    expect(canAccess(ctx({ profile: 'Billing' }), 'sales')).toBe(false);
  });

  it('admins (adminBypass) get every enterable Mytrion, so the picker shows (not auto-enter)', () => {
    const { accessible, isAdmin: admin } = resolveAccessibleMytrions(ctx({ profile: 'Administrator', role: 'CEO' }));
    expect(admin).toBe(true);
    expect(accessible).toContain('sales');
    expect(accessible.length).toBeGreaterThan(1);
    // Whatever is parked is never enterable — asserted against the constant, so this test stays
    // correct as Mytrions launch instead of needing an edit each time one does.
    for (const parked of COMING_SOON_MYTRION_IDS) expect(accessible).not.toContain(parked);
    // The launched department Mytrions an admin should see.
    for (const live of ['manager', 'hr', 'recruit', 'analyst', 'collection', 'verification', 'trailhead']) {
      expect(accessible).toContain(live);
    }
    // Finance's rule sets adminBypass:false — the 'Administrator' PROFILE is what grants it here,
    // not the admin bypass.
    expect(accessible).toContain('finance');
  });

  it('parking a Mytrion blocks it even when the server granted it', () => {
    const granted = ctx({
      profile: 'Administrator',
      accessibleMytrions: ['sales', 'collection', 'finance', 'verification', 'analyst'],
      allDepartmentAccess: true,
    });
    const { accessible } = resolveAccessibleMytrions(granted);

    // Nothing is parked today, so every server grant resolves. Driving both sides off the constant
    // keeps this honest whichever way the list moves.
    for (const id of ['sales', 'collection', 'finance', 'verification', 'analyst'] as const) {
      const parked = COMING_SOON_MYTRION_IDS.includes(id);
      expect(canAccess(granted, id)).toBe(!parked);
      expect(accessible.includes(id)).toBe(!parked);
    }
  });

  it('an unknown profile is forbidden (0 accessible)', () => {
    const { accessible } = resolveAccessibleMytrions(ctx({ profile: 'Nobody' }));
    expect(accessible).toEqual([]);
  });

  it('Recruiter enters Recruit while HR can move between HR and Recruit', () => {
    expect(resolveAccessibleMytrions(ctx({ profile: 'Recruiter' })).accessible).toEqual([
      'recruit',
    ]);
    const hr = resolveAccessibleMytrions(ctx({ profile: 'HR' })).accessible;
    expect(hr).toContain('hr');
    expect(hr).toContain('recruit');
  });

  it('isAdmin is true only for admin profiles/roles', () => {
    expect(isAdmin(ctx({ profile: 'Administrator' }))).toBe(true);
    expect(isAdmin(ctx({ role: 'CEO' }))).toBe(true);
    expect(isAdmin(ctx({ profile: 'Sales Agent' }))).toBe(false);
  });

  // Finance is parked coming-soon, so canAccess('finance') is false for everyone. These assert the
  // underlying access RULE via ruleAllows so the grant logic stays covered until finance re-launches.
  it('finance access rule grants the Administrator profile, and finance has launched', () => {
    expect(ruleAllows(ctx({ profile: 'Administrator' }), MYTRIONS.finance)).toBe(true);
    // No longer parked — Home (EFS parent balance) + Clients are live, so it is enterable.
    expect(canAccess(ctx({ profile: 'Administrator' }), 'finance')).toBe(true);
  });

  it('finance access rule grants a userName containing Azimov or Mirjalol', () => {
    expect(ruleAllows(ctx({ profile: 'Sales Agent', userName: 'John Azimov' }), MYTRIONS.finance)).toBe(true);
    expect(ruleAllows(ctx({ profile: 'Billing', userName: 'Mirjalol Karimov' }), MYTRIONS.finance)).toBe(true);
    expect(ruleAllows(ctx({ profile: 'Sales Agent', userName: 'azimov.ops' }), MYTRIONS.finance)).toBe(true);
  });

  it('finance access rule denies unrelated users (no adminBypass)', () => {
    expect(ruleAllows(ctx({ profile: 'Finance' }), MYTRIONS.finance)).toBe(false);
    expect(ruleAllows(ctx({ profile: 'Sales Agent', userName: 'Random User' }), MYTRIONS.finance)).toBe(false);
    expect(ruleAllows(ctx({ role: 'CEO', profile: 'Sales Agent' }), MYTRIONS.finance)).toBe(false);
  });
});

describe('server-resolved access is authoritative (verified session)', () => {
  it('uses accessibleMytrions verbatim (in display order), overriding the static table', () => {
    const { accessible, homeMytrion } = resolveAccessibleMytrions(
      ctx({ profile: 'Sales Agent', accessibleMytrions: ['billing', 'sales'], homeMytrion: 'sales', allDepartmentAccess: false }),
    );
    expect(accessible).toEqual(['sales', 'billing']); // reordered to MYTRION_ORDER
    expect(homeMytrion).toBe('sales');
  });

  it('canAccess honors the server list, not the static profile rules', () => {
    const granted = ctx({ profile: 'Sales Agent', accessibleMytrions: ['billing'] });
    expect(canAccess(granted, 'billing')).toBe(true); // granted server-side despite the profile
    expect(canAccess(granted, 'sales')).toBe(false); // NOT in the server list, though the profile would
  });

  it('isAdmin follows the server-resolved allDepartmentAccess when present', () => {
    expect(isAdmin(ctx({ profile: 'Sales Agent', allDepartmentAccess: true }))).toBe(true);
    expect(isAdmin(ctx({ profile: 'Administrator', allDepartmentAccess: false }))).toBe(false);
  });
});

describe('DEFAULT_PROFILE_SEED mirror (fallback table only — server list wins when present)', () => {
  it('sales-family profiles land on sales only', () => {
    for (const profile of ['Sales Plus', 'Sales Assistant', 'Referral Standard Plus']) {
      expect(resolveAccessibleMytrions(ctx({ profile })).accessible, profile).toEqual(['sales']);
    }
  });

  it('Standard Plus gets sales + billing; Standard gets nothing; Customer Retention gets CS', () => {
    const plus = resolveAccessibleMytrions(ctx({ profile: 'Standard Plus' })).accessible;
    expect(plus).toContain('sales');
    expect(plus).toContain('billing');
    expect(resolveAccessibleMytrions(ctx({ profile: 'Standard' })).accessible).toEqual([]);
    expect(resolveAccessibleMytrions(ctx({ profile: 'Customer Retention' })).accessible).toEqual([
      'customer-service',
    ]);
  });

  it('a server-resolved single-Mytrion list yields exactly one accessible (Landing hard-navigates)', () => {
    const { accessible, homeMytrion } = resolveAccessibleMytrions(
      ctx({ profile: 'Sales Agent', accessibleMytrions: ['sales'], homeMytrion: null, allDepartmentAccess: false }),
    );
    expect(accessible).toEqual(['sales']);
    expect(homeMytrion).toBeNull(); // Landing's length===1 rule must not depend on home
  });
});

describe('canManageHr — who may create/manage the HR directory', () => {
  it('admins manage (all-department access)', () => {
    expect(canManageHr(ctx({ allDepartmentAccess: true }))).toBe(true);
  });

  it('an Administrator profile manages even before server-resolved flags arrive', () => {
    expect(canManageHr(ctx({ profile: 'Administrator' }))).toBe(true);
  });

  it('an HR Manager — HR granted in full mode — manages', () => {
    expect(
      canManageHr(ctx({ allDepartmentAccess: false, mytrionAccessModes: { hr: 'full' } })),
    ).toBe(true);
  });

  it('a plain HR directory user (hr: read) may NOT manage', () => {
    expect(
      canManageHr(ctx({ allDepartmentAccess: false, mytrionAccessModes: { hr: 'read' } })),
    ).toBe(false);
  });

  it('is fail-closed when no HR mode is present', () => {
    // A legacy session or one that never carried modes must read as read-only, not accidentally elevate.
    expect(canManageHr(ctx({ allDepartmentAccess: false }))).toBe(false);
    expect(
      canManageHr(ctx({ allDepartmentAccess: false, mytrionAccessModes: { billing: 'full' } })),
    ).toBe(false);
  });
});
