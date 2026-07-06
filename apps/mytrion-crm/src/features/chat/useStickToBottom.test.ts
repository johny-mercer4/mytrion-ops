import { describe, expect, it } from 'vitest';
import { isNearBottom } from './useStickToBottom';

describe('isNearBottom', () => {
  it('is true at the exact bottom', () => {
    expect(isNearBottom(900, 1000, 100)).toBe(true);
  });

  it('is true within the slack window', () => {
    expect(isNearBottom(870, 1000, 100)).toBe(true); // 30px from bottom
  });

  it('is false once the user scrolls up past the slack', () => {
    expect(isNearBottom(500, 1000, 100)).toBe(false);
  });

  it('is true when content fits without scrolling', () => {
    expect(isNearBottom(0, 80, 100)).toBe(true);
  });
});
