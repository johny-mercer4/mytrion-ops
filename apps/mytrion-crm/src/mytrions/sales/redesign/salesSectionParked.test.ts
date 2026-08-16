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
  it('parks Verification for a non-admin and opens it for an admin', () => {
    expect(isSectionParked('verification', false)).toBe(true);
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

  it('does not park anything else for non-admins', () => {
    // Guards against ADMIN_ONLY_SECTIONS quietly growing: only Verification is admin-gated.
    const gated = NAV.filter((n) => n.comingSoon !== true && isSectionParked(n.id, false)).map((n) => n.id);
    expect(gated).toEqual(['verification']);
  });
});
