import { useEffect, useRef } from 'react';

/**
 * +1/-1 slide direction for a tab switch, from each key's index in `order` — the previous index
 * is tracked across renders so a later tab enters from the right, an earlier one from the left.
 * 0 on first render (nothing to compare against yet) and while active/prev resolve to the same tab.
 */
export function useSlideDirection<T extends string>(activeKey: T, order: readonly T[]): number {
  const activeIndex = order.indexOf(activeKey);
  const prevIndexRef = useRef(activeIndex);
  const direction = Math.sign(activeIndex - prevIndexRef.current);
  useEffect(() => {
    prevIndexRef.current = activeIndex;
  }, [activeIndex]);
  return direction;
}
