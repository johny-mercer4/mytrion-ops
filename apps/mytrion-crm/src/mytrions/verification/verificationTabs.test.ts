import { describe, expect, it } from 'vitest';
import { VERIFICATION_TABS } from './verificationTabs';

describe('VERIFICATION_TABS', () => {
  it('puts Inbox under Main and groups Queue / Policy / Roster', () => {
    expect(VERIFICATION_TABS.map((tab) => tab.key)).toEqual([
      'main',
      'inbox',
      'cases',
      'ruleset',
      'clients',
      'tickets',
    ]);
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'ruleset')?.label).toBe('Decision rules');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'inbox')?.group).toBe('Queue');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'cases')?.group).toBe('Queue');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'ruleset')?.group).toBe('Policy');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'clients')?.group).toBe('Roster');
    expect(VERIFICATION_TABS.find((tab) => tab.key === 'tickets')?.group).toBe('Roster');
  });
});
