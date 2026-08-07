import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_TONES,
  DEPARTMENT_TONE_NAMES,
  departmentTone,
} from './departmentAppearance';

/**
 * The bug these pin: `icon_color` is null for nearly every department (the Zoho migration never set
 * it), so the old unconditional `?? var(--accent)` painted all ~22 the same HR red — on the cards and
 * across the entire org canvas.
 */
describe('departmentTone', () => {
  it('honours a stored token over the seed', () => {
    expect(departmentTone('tone-sky', 'hrd_anything')).toBe('var(--tone-sky)');
  });

  it('gives different departments different colours when none is stored', () => {
    const tones = new Set(
      ['hrd_1', 'hrd_2', 'hrd_3', 'hrd_4', 'hrd_5', 'hrd_6'].map((id) =>
        departmentTone(null, id),
      ),
    );
    // Not a guarantee of six distinct values (a hash can collide), but the old code produced exactly
    // one for any input — anything above that proves the seed is doing work.
    expect(tones.size).toBeGreaterThan(1);
  });

  it('is stable for the same seed, so a department keeps its colour across screens and reloads', () => {
    expect(departmentTone(null, 'hrd_42')).toBe(departmentTone(null, 'hrd_42'));
  });

  it('never auto-assigns slate — that is the unassigned bucket’s neutral', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => `hrd_${i}`);
    const tones = new Set(seeds.map((id) => departmentTone(null, id)));
    expect(tones.has('var(--tone-slate)')).toBe(false);
  });

  it('falls back to the module accent with no token and no seed', () => {
    expect(departmentTone(null)).toBe('var(--accent)');
    expect(departmentTone(null, null)).toBe('var(--accent)');
  });

  it('resolves every offered token to a real tone variable', () => {
    for (const name of DEPARTMENT_TONE_NAMES) {
      expect(departmentTone(name)).toBe(DEPARTMENT_TONES[name]!.cssVar);
    }
  });

  it('ignores an unknown token rather than emitting it', () => {
    // A value that somehow got past the backend's shape check must never reach a style rule.
    expect(departmentTone('tone-nope; background:url(x)')).toBe('var(--accent)');
  });
});
