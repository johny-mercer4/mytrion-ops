import { describe, expect, it } from 'vitest';
import { NAV } from './salesData';
import { soonHue, soonTabMeta, SOON_TABS } from './soonTabs';

describe('soonTabs', () => {
  /**
   * DERIVED from NAV rather than hardcoded. The invariant is "every parked tab has matching
   * metadata", so the parked set belongs to NAV — spelling it out again meant the list had to be
   * hand-edited every time a tab shipped, and it silently became an assertion about LIVE tabs when
   * that was missed. Extra SOON_TABS entries for tabs that have since gone live are fine and stay
   * unasserted: the check is parked ⊆ SOON_TABS, not equality.
   *
   * `parked` is currently EMPTY — Tickets, Verification and Call Hub have all shipped — so the loop
   * below is vacuous today. That is a real state, not a broken test: asserting a non-empty parked set
   * would fail the moment the last tab ships, which is exactly the wrong incentive. The loop starts
   * doing work again the moment anything is parked.
   */
  const parked = NAV.filter((n) => n.comingSoon === true).map((n) => n.id);

  it('covers every parked Sales nav id with matching hue helpers', () => {
    for (const id of parked) {
      expect(SOON_TABS[id], `missing SOON_TABS metadata for parked tab '${id}'`).toBeDefined();
      expect(soonHue(id)).toBe(SOON_TABS[id]!.hue);
      expect(soonTabMeta(id).title.length).toBeGreaterThan(0);
      expect(soonTabMeta(id).blurb.length).toBeGreaterThan(0);
    }
  });

  it('does not park Tickets — the native comms console is live', () => {
    // If 'tickets' ever reappears here, the sidebar SOON chip and the ComingSoonPanel short-circuit
    // both come back and TicketConsole silently stops mounting. That is the exact regression this
    // merge fixed, so it is worth one assertion even while `parked` is empty.
    expect(parked).not.toContain('tickets');
  });

  it('falls back for unknown sections', () => {
    expect(soonTabMeta('nope').title).toBe('Coming soon');
    expect(soonHue('nope')).toBe('var(--warn)');
  });
});
