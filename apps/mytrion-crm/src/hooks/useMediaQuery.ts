/**
 * The viewport, as a hook — the app's entry point to it.
 *
 * The implementation and the ladder itself live in `ds/_internal/useMediaQuery.ts`, because `ds/` is
 * built as a standalone library and may not import app code: if the four numbers lived here, `ds`
 * would need a second copy of them. One definition, re-exported. `src/styles/breakpoints.test.ts`
 * pins it against the stylesheets and against `docs/design/FOUNDATIONS.md`.
 *
 * Import from HERE in app code (`mytrions/`, `components/`, `features/`), not from `ds/_internal` —
 * that path is ds's own business and the two named rungs below are the app's vocabulary for it.
 */
export {
  BREAKPOINT,
  useBelow,
  useHasHover,
  useMediaQuery,
  type Breakpoint,
} from '../ds/_internal/useMediaQuery';

import { useBelow } from '../ds/_internal/useMediaQuery';

/**
 * Below the STRUCTURE line (640). The page changes shape: no rail, no centred modals, no tables.
 * This is the one to branch on when the answer is a different layout.
 */
export function useIsPhone(): boolean {
  return useBelow('sm');
}

/**
 * Below the DENSITY line (900). Collapsed rail, compact gutters, 16px inputs — nothing moves.
 * Includes every phone, and every iPad in portrait.
 */
export function useIsCompact(): boolean {
  return useBelow('md');
}
