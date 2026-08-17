/**
 * Frontend mirror of `src/modules/verification/killSwitches.ts`.
 *
 * Read independently of the backend flag on purpose: hiding a tab is a UI decision, refusing a route
 * is a security one, and the UI hide is never the boundary. Both must be flipped to bring the legacy
 * credit-platform desk back, which is the point — a half-restored desk that renders but 503s on
 * every action is worse than either state.
 */
export const LEGACY_VERIFICATION_DESK_ENABLED = false;
