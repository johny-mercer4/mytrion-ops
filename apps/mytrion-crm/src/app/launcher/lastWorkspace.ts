/**
 * Which workspace the user was last in.
 *
 * Two things changed when this moved out of horizonGlass.ts:
 *
 * 1. It stores the ID, not the display label. That makes the launcher's "Last active" card a LINK
 *    to somewhere, which is what earns it the featured treatment in the design, and it survives a
 *    workspace being renamed.
 * 2. It is written from MytrionGuard — i.e. from entering a workspace by ANY route. It used to be
 *    written only by the launcher tile's onClick, so a user who auto-entered (single-workspace, or
 *    a granted home Mytrion) or switched from the header never recorded anything. "Last active"
 *    actually meant "the last tile you clicked on this screen".
 *
 * The v2 key suffix is load-bearing: v1 held a display label like "Billing", which must not be
 * read back as an id.
 */
import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';

const KEY = 'mytrion.horizon.lastWorkspace.v2';

export function rememberWorkspace(id: MytrionId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode throws. A convenience stat is never a reason for navigation to fail.
  }
}

export function readLastWorkspace(): MytrionId | null {
  try {
    const raw = localStorage.getItem(KEY);
    // Validate against the registry rather than trusting storage: a stale id from a retired
    // workspace would otherwise index MYTRIONS to undefined and crash the card.
    return raw && raw in MYTRIONS ? (raw as MytrionId) : null;
  } catch {
    return null;
  }
}
