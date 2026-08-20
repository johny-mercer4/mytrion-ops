/**
 * The scope the desk's stylesheet needs, as an ANCESTOR.
 *
 * Every rule in `verification/applicants/applicants{,Case}.css` is written
 * `[data-mytrion='verification'] .va-…` — a DESCENDANT combinator. Putting the attribute on the
 * `.va-case` / `.va-list` element itself, which is the obvious thing to do and what this surface did
 * first, matches none of them: a descendant selector never matches the element carrying the ancestor
 * part. The roots then lost three things at once, and the symptom did not name any of them —
 *
 *   `display: flex` + `gap`   the four case panels and the queue's tabs-over-panel sat flush against
 *                             each other, with no rhythm between them at all;
 *   `--va-r-sm/-md/-pill`     declared on `:is(.va-list, .va-case)`, so every child's
 *                             `border-radius: var(--va-r-md)` resolved to an invalid value, CSS
 *                             dropped the declaration, and every panel painted square;
 *   the 900/640 media rules   which hang off the same roots.
 *
 * One wrapper, so the attribute is always one level up. It also keeps the Sales identity intact:
 * `data-mytrion` binds `--badge-tone` and nothing else (`styles/global.css`), no `.va-*` rule and no
 * `ds/Badge` intent reads it, and the Sales badge lives in the shell header well outside this subtree.
 */
import type { ReactNode } from 'react';

export function VerificationDeskSurface({ children }: { children: ReactNode }) {
  return (
    <div data-mytrion="verification" className="ss-vf-desk-surface">
      {children}
    </div>
  );
}
