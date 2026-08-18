/**
 * The Sales-side Verification tab is admin-only, and SALES-ONLY.
 *
 * Two different mechanisms live here and must not be confused: `comingSoon: true` in NAV_GROUPS
 * parks a tab for everyone (Tickets), while ADMIN_ONLY_SECTIONS parks one for everyone EXCEPT an
 * admin. Both flow through `isSectionParked`, so the sidebar chip and the panel body can never
 * disagree — the failure you get when two call sites decide separately and a tab renders navigable
 * but blocked.
 */
import { describe, expect, it } from 'vitest';
import { NAV, isSectionParked } from './salesData';

describe('Sales section parking', () => {
  it('opens Verification for a Sales AGENT, not just an admin', () => {
    // It was admin-only while the Sales-side surface was still settling. That surface is built, and
    // the agent is the person the roster and the intake form are for — parking it from them made
    // the whole flow untestable as the user who has to use it.
    expect(isSectionParked('verification', false)).toBe(false);
    expect(isSectionParked('verification', true)).toBe(false);
  });

  it('leaves a genuinely live tab alone for both', () => {
    // Home is the landing section; if this ever parks, the workspace opens on a dead panel.
    expect(isSectionParked('home', false)).toBe(false);
    expect(isSectionParked('home', true)).toBe(false);
  });

  it('keeps an everyone-parked tab parked even for an admin', () => {
    // Tickets is comingSoon in NAV_GROUPS — admin-ness must not unpark it, because the console it
    // would open does not exist yet.
    const ticketsParkedForAll = NAV.some((n) => n.id === 'tickets' && n.comingSoon === true);
    if (ticketsParkedForAll) {
      expect(isSectionParked('tickets', true)).toBe(true);
      expect(isSectionParked('tickets', false)).toBe(true);
    }
  });

  it('admin-gates nothing at all right now', () => {
    // Guards against ADMIN_ONLY_SECTIONS quietly growing. It is empty by design — a tab parked from
    // agents is a tab whose owners cannot test it, so adding one should be a deliberate act that
    // fails this test and gets a reason written next to it.
    const gated = NAV.filter((n) => n.comingSoon !== true && isSectionParked(n.id, false)).map((n) => n.id);
    expect(gated).toEqual([]);
  });
});
