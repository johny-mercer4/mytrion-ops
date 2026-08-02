import { describe, expect, it } from 'vitest';
import { soonHue, soonTabMeta, SOON_TABS } from './soonTabs';

describe('soonTabs', () => {
  it('covers every parked Sales nav id with matching hue helpers', () => {
    // Tickets remains parked; Verification + Call Hub are live (meta may still exist for reuse).
    for (const id of ['tickets'] as const) {
      expect(SOON_TABS[id]).toBeDefined();
      expect(soonHue(id)).toBe(SOON_TABS[id]!.hue);
      expect(soonTabMeta(id).title.length).toBeGreaterThan(0);
      expect(soonTabMeta(id).blurb.length).toBeGreaterThan(0);
    }
  });

  it('falls back for unknown sections', () => {
    expect(soonTabMeta('nope').title).toBe('Coming soon');
    expect(soonHue('nope')).toBe('var(--warn)');
  });
});
