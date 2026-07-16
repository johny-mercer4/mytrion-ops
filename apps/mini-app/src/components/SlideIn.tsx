import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * Wraps tab content so a switch slides in from the direction of travel (+1 right, -1 left, 0 no
 * horizontal motion) instead of popping in place — pairs with `useSlideDirection`. Relies on the
 * caller re-mounting this per tab (conditional branches / a `key` change) so the CSS animation
 * actually re-triggers; it does not remount anything itself.
 */
export function SlideIn({ dir, children }: { dir: number; children: ReactNode }): ReactElement {
  return (
    <div style={{ ['--slide-dir' as string]: dir, animation: 'octslide .3s cubic-bezier(.32,.72,0,1)' } as CSSProperties}>
      {children}
    </div>
  );
}
