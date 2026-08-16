import { describe, expect, it } from 'vitest';
import { VERIFICATION_TABS } from './verificationTabs';
import { LEGACY_VERIFICATION_DESK_ENABLED } from './legacyDesk';

describe('VERIFICATION_TABS', () => {
  it('leads with Main, then the underwriting queue and the roster', () => {
    expect(VERIFICATION_TABS.map((tab) => tab.key)).toEqual([
      'main',
      'applicants',
      'watch',
      'clients',
      'tickets',
    ]);
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'main')).not.toHaveProperty('group');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'applicants')?.group).toBe('Queue');
    // Watch sits under Queue beside New applicants: both answer "who deserves credit", one at
    // intake and one every week after.
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'watch')?.group).toBe('Queue');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'clients')?.group).toBe('Roster');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'tickets')?.group).toBe('Roster');
  });

  it('does not declare the quarantined credit-platform tabs', () => {
    // Declaring a tab the shell will not mount fails tabRegistry.test.ts, and would let an admin
    // grant a permission set for a tab nobody can open. The components stay on disk; the DECLARATION
    // is what has to go while the desk is parked.
    expect(LEGACY_VERIFICATION_DESK_ENABLED).toBe(false);
    const keys = VERIFICATION_TABS.map((tab) => tab.key) as readonly string[];
    for (const legacy of ['inbox', 'cases', 'ruleset']) {
      expect(keys).not.toContain(legacy);
    }
  });
});
