/**
 * The viewport stub is load-bearing for every responsive test in the app, so it is worth pinning
 * itself. If it silently answered `false` to everything, a suite asserting "the phone layout renders"
 * would pass by rendering the desktop one.
 */
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_WIDTH, setReducedMotion, setViewport } from './viewport';

const matches = (query: string): boolean => window.matchMedia(query).matches;

describe('viewport stub — width queries', () => {
  it('defaults to a desktop width so existing suites keep their rendering', () => {
    expect(window.innerWidth).toBe(DESKTOP_WIDTH);
    expect(matches('(width < 640px)')).toBe(false);
    expect(matches('(width < 900px)')).toBe(false);
    expect(matches('(max-width: 768px)')).toBe(false);
  });

  it('evaluates range syntax from either side', () => {
    setViewport(375);
    expect(matches('(width < 640px)')).toBe(true);
    expect(matches('(width <= 375px)')).toBe(true);
    expect(matches('(width > 640px)')).toBe(false);
    expect(matches('(640px <= width)')).toBe(false);

    setViewport(820);
    expect(matches('(640px <= width < 900px)')).toBe(true);
    expect(matches('(width < 640px)')).toBe(false);
    expect(matches('(width < 900px)')).toBe(true);
  });

  /** The boundaries are where the 767/768/769 class of bug lives, so assert them exactly. */
  it('is exact at a boundary — `<` excludes, `max-width` includes', () => {
    setViewport(640);
    expect(matches('(width < 640px)')).toBe(false);
    expect(matches('(640px <= width)')).toBe(true);
    expect(matches('(max-width: 640px)')).toBe(true);
    expect(matches('(min-width: 640px)')).toBe(true);

    setViewport(639);
    expect(matches('(width < 640px)')).toBe(true);
    expect(matches('(min-width: 640px)')).toBe(false);
  });

  it('understands the legacy max-width/min-width the app still ships', () => {
    setViewport(768);
    expect(matches('(max-width: 768px)')).toBe(true);
    expect(matches('(max-width: 767px)')).toBe(false);
    expect(matches('(min-width: 769px)')).toBe(false);
  });

  it('ands multiple conditions and ignores the media type', () => {
    setViewport(700);
    expect(matches('screen and (width < 900px) and (640px <= width)')).toBe(true);
    expect(matches('(width < 900px) and (width < 640px)')).toBe(false);
  });

  /** A browser treats an unsupported feature as a non-match rather than an error. So does this. */
  it('answers false for a feature it does not know', () => {
    expect(matches('(prefers-contrast: more)')).toBe(false);
    expect(matches('(orientation: portrait)')).toBe(false);
    expect(matches('')).toBe(false);
  });
});

describe('viewport stub — discrete features', () => {
  it('derives hover and pointer from the width so a phone is coherent by default', () => {
    setViewport(375);
    expect(matches('(hover: none)')).toBe(true);
    expect(matches('(pointer: coarse)')).toBe(true);
    expect(matches('(hover: hover)')).toBe(false);

    setViewport(DESKTOP_WIDTH);
    expect(matches('(hover: hover)')).toBe(true);
    expect(matches('(pointer: fine)')).toBe(true);
  });

  it('lets a test override the derived pointer — a touchscreen laptop is a real thing', () => {
    setViewport(1280, { hover: 'none', pointer: 'coarse' });
    expect(matches('(width < 640px)')).toBe(false);
    expect(matches('(pointer: coarse)')).toBe(true);
  });

  it('carries prefers-reduced-motion, which themeContext reads', () => {
    expect(matches('(prefers-reduced-motion: reduce)')).toBe(false);
    setReducedMotion(true);
    expect(matches('(prefers-reduced-motion: reduce)')).toBe(true);
    expect(matches('(prefers-reduced-motion: no-preference)')).toBe(false);
  });
});

describe('viewport stub — change notification', () => {
  it('notifies only the lists whose answer actually flipped', () => {
    const phone = window.matchMedia('(width < 640px)');
    const compact = window.matchMedia('(width < 900px)');
    const onPhone = vi.fn();
    const onCompact = vi.fn();
    phone.addEventListener('change', onPhone);
    compact.addEventListener('change', onCompact);

    // 1280 -> 820 crosses the density line but not the structure line.
    setViewport(820);
    expect(onPhone).not.toHaveBeenCalled();
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(phone.matches).toBe(false);
    expect(compact.matches).toBe(true);

    setViewport(375);
    expect(onPhone).toHaveBeenCalledTimes(1);
    expect(onCompact).toHaveBeenCalledTimes(1); // already true; no second event
  });

  it('stops notifying after removeEventListener', () => {
    const list = window.matchMedia('(width < 640px)');
    const spy = vi.fn();
    list.addEventListener('change', spy);
    list.removeEventListener('change', spy);

    setViewport(375);
    expect(spy).not.toHaveBeenCalled();
    // The list itself still tracks — only the subscription went away.
    expect(list.matches).toBe(true);
  });

  it('exposes visualViewport, which useViewportInset subscribes to', () => {
    expect(window.visualViewport).toBeTruthy();
    setViewport(414);
    expect(window.visualViewport?.width).toBe(414);
  });
});
