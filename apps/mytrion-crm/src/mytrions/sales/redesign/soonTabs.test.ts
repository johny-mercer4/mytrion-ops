import { describe, expect, it } from 'vitest';
import { NAV, TICKETS_ENABLED } from './salesData';
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

  it('parks Tickets, and keeps TICKETS_ENABLED in step with it', () => {
    // These two must never disagree: `comingSoon` drives the sidebar chip and the ComingSoonPanel
    // short-circuit, while TICKETS_ENABLED gates the unread badge and the Create → open-ticket jump.
    // Un-parking by dropping `comingSoon` flips both together; hard-coding either is the bug.
    expect(parked).toContain('tickets');
    expect(TICKETS_ENABLED).toBe(false);
    expect(soonTabMeta('tickets').title).toBe('Tickets');
  });

  it('parks My Tasks and Verification with shared coming-soon metadata', () => {
    expect(parked).toEqual(expect.arrayContaining(['tasks', 'verification']));
    expect(soonTabMeta('tasks').title).toBe('My Tasks');
    expect(soonTabMeta('verification').title).toBe('Verification Pipeline');
  });

  it('falls back for unknown sections', () => {
    expect(soonTabMeta('nope').title).toBe('Coming soon');
    expect(soonHue('nope')).toBe('var(--warn)');
  });
});
