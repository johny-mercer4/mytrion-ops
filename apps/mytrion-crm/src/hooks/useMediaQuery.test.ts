/**
 * The hook half of the breakpoint contract. `src/styles/breakpoints.test.ts` pins the CSS half and
 * asserts the two agree; this pins the behaviour a component actually observes.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setViewport } from '../test/viewport';
import { BREAKPOINT, useBelow, useHasHover, useIsCompact, useIsPhone, useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('reads the real value on the FIRST render, with no correcting second pass', () => {
    // The useState+useEffect shape renders once with a guess and again with the truth, which is a
    // visible flash of the desktop layout on a phone. useSyncExternalStore has no such window.
    setViewport(375);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
  });

  it('re-renders when the viewport crosses the query', () => {
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => setViewport(375));
    expect(result.current).toBe(true);

    act(() => setViewport(1280));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { result, unmount } = renderHook(() => useIsPhone());
    unmount();
    // A live listener on an unmounted component would warn or, worse, keep the tree alive.
    expect(() => act(() => setViewport(375))).not.toThrow();
    expect(result.current).toBe(false);
  });

  it('answers false when matchMedia is unavailable', () => {
    // The `ds` library build ships into a design-tool sandbox with no CSSOM view module. Returning
    // false there means the canonical DESKTOP rendering, never a card list nothing can measure.
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    try {
      const { result } = renderHook(() => useMediaQuery('(width < 640px)'));
      expect(result.current).toBe(false);
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    }
  });
});

describe('the ladder', () => {
  it('is exactly four rungs, ordered', () => {
    expect(BREAKPOINT).toEqual({ xs: 480, sm: 640, md: 900, lg: 1200 });
    const values = Object.values(BREAKPOINT);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  /**
   * The bug this closes: the shell switched at `max-width: 768px` while every ds/* field guarded at
   * `max-width: 767px`, so a viewport exactly 768px wide got the mobile shell AND 13px inputs — and
   * iOS answers a sub-16px focused field by zooming the whole page. Range syntax makes the boundary
   * unambiguous, so assert it at the boundary rather than near it.
   */
  it('excludes its own boundary', () => {
    setViewport(640);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => setViewport(639));
    expect(result.current).toBe(true);
  });

  it('separates the structure line from the density line', () => {
    // 820px is an iPad in portrait. It must get the tablet treatment (compact) and NOT the phone
    // shell — forcing a phone layout onto every tablet and split-screen laptop is the whole reason
    // the ladder has two lines instead of one.
    setViewport(820);
    const phone = renderHook(() => useIsPhone());
    const compact = renderHook(() => useIsCompact());
    expect(phone.result.current).toBe(false);
    expect(compact.result.current).toBe(true);
  });

  it('exposes every rung through useBelow', () => {
    setViewport(400);
    expect(renderHook(() => useBelow('xs')).result.current).toBe(true);
    expect(renderHook(() => useBelow('lg')).result.current).toBe(true);

    act(() => setViewport(1000));
    expect(renderHook(() => useBelow('xs')).result.current).toBe(false);
    expect(renderHook(() => useBelow('md')).result.current).toBe(false);
    expect(renderHook(() => useBelow('lg')).result.current).toBe(true);
  });
});

describe('useHasHover', () => {
  it('is about the pointer, not the width', () => {
    // A touchscreen laptop is wide AND coarse. Anything deciding whether an affordance may be
    // hover-only has to ask this, not the breakpoint.
    setViewport(1280, { hover: 'none', pointer: 'coarse' });
    const { result } = renderHook(() => useHasHover());
    expect(result.current).toBe(false);

    act(() => setViewport(1280, { hover: 'hover', pointer: 'fine' }));
    expect(result.current).toBe(true);
  });
});
