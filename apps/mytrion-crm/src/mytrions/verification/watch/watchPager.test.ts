/**
 * The pager window. Every carrier has to be reachable, and the last page has to be one click away —
 * "check the bottom of the book" is a real task on a credit desk.
 */
import { describe, expect, it } from 'vitest';
import { pageWindow } from './WatchPager';

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('always keeps the first and last page reachable', () => {
    const w = pageWindow(7, 15);
    expect(w[0]).toBe(0);
    expect(w[w.length - 1]).toBe(14);
  });

  it('marks the gaps rather than listing fifteen buttons', () => {
    expect(pageWindow(7, 15)).toEqual([0, null, 6, 7, 8, null, 14]);
  });

  it('does not open a gap of one page — 0 … 2 would hide a single number', () => {
    expect(pageWindow(2, 15)).toEqual([0, 1, 2, 3, null, 14]);
  });

  it('handles a single page', () => {
    expect(pageWindow(0, 1)).toEqual([0]);
  });

  it('handles an empty result', () => {
    expect(pageWindow(0, 0)).toEqual([0]);
  });
});
