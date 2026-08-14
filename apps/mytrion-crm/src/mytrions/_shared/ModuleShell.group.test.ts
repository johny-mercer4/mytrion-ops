import { describe, expect, it } from 'vitest';
import { groupModuleTabs } from './ModuleShell';

describe('groupModuleTabs', () => {
  it('keeps an ungrouped first tab, then labelled runs', () => {
    const groups = groupModuleTabs(
      [
        { id: 'main' },
        { id: 'inbox', group: 'Queue' },
        { id: 'cases', group: 'Queue' },
        { id: 'ruleset', group: 'Policy' },
        { id: 'clients', group: 'Roster' },
        { id: 'tickets', group: 'Roster' },
      ],
      'Verification',
    );
    expect(groups.map((g) => [g.label, g.items.map((t) => t.id)])).toEqual([
      ['Verification', ['main']],
      ['Queue', ['inbox', 'cases']],
      ['Policy', ['ruleset']],
      ['Roster', ['clients', 'tickets']],
    ]);
  });
});
