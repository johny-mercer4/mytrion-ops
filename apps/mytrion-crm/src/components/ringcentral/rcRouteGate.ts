/**
 * Which routes the softphone is allowed to exist on.
 *
 * Extracted from `RingCentralPhone.tsx` so it can be tested. Importing that component runs
 * `installRcConsoleFilter()` at module scope and pulls in `ringcentralHost.css`, so the gate could
 * not be exercised in isolation while it lived there — and it is the one piece of this feature whose
 * correctness is a stated requirement rather than an implementation detail ("available only in Sales,
 * Customer Service and Collection, not in the main workspace"). `signInPrompt.ts` is the same shape
 * for the same reason.
 */

import { isMytrionId, mytrionIdFromUrlSlug, type MytrionId } from '@/access/mytrions.config';

/**
 * Softphone is only for desk-phone Mytrions (expand later as needed).
 *
 * KEEP IN STEP with `RC_SOFTPHONE_DEPARTMENTS` in `src/routes/v1/ringcentral.routes.ts`. They drifted
 * once — `collection` was added here and not there, so a Collection agent passed this gate, booted
 * the widget, and got an RBAC refusal on `/embed-config` that the caller swallows silently.
 */
export const RC_ALLOWED_MYTRIONS = new Set<MytrionId>(['sales', 'customer-service', 'collection']);

/**
 * Resolve /main/:slug (or legacy /m/:id) to a MytrionId when on a Mytrion route.
 *
 * Both patterns are deliberately PREFIX-anchored, not full-match: `/main/salesmytrion/records` is
 * still Sales. Adding `$` would silently disable the softphone on every sub-route.
 */
export function mytrionFromPath(pathname: string): MytrionId | undefined {
  const main = /^\/main\/([^/]+)/.exec(pathname);
  if (main?.[1]) return mytrionIdFromUrlSlug(main[1]);
  const legacy = /^\/m\/([^/]+)/.exec(pathname);
  if (legacy?.[1] && isMytrionId(legacy[1])) return legacy[1];
  return undefined;
}

/**
 * May the widget mount on this path?
 *
 * `/main` — the workspace launcher — is false by construction: the pattern requires a slash AND a
 * segment after `main`, so the bare launcher path never matches and resolves to `undefined`.
 */
export function isRingCentralRoute(pathname: string): boolean {
  const id = mytrionFromPath(pathname);
  return id !== undefined && RC_ALLOWED_MYTRIONS.has(id);
}
