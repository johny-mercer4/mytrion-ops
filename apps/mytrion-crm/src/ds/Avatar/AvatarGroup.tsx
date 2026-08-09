import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AvatarProps, AvatarSize } from './Avatar';
import styles from './AvatarGroup.module.css';

export interface AvatarGroupProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * The one accessible name for the whole cluster — "Alice, Bob and 3 others". REQUIRED.
   *
   * The group announces once, as a single image; the avatars inside it announce nothing (their
   * images carry `alt=""` and their initials are `aria-hidden`). Without this prop the cluster is
   * silent, which is how "5 people are on this deal" becomes invisible to a screen-reader user.
   * Build the string from the same list you built the children from — including the overflow, since
   * the hidden faces are still people on the record.
   */
  label: string;
  /** `Avatar` elements. Anything that is not a valid element is dropped. */
  children: ReactNode;
  /**
   * How many avatars to render before collapsing the rest into `+N`. Default 4. Values below 1 are
   * clamped to 1 — a group that renders zero faces and a "+7" chip is not a group.
   *
   * Note the arithmetic: `max` counts AVATARS, and the `+N` chip is additional, so five people at
   * `max={4}` render four faces and a "+1". If you would rather show all five, raise `max`.
   */
  max?: number;
  /**
   * Applied to every avatar in the group, overriding whatever size the children were given. A
   * cluster of mismatched circles is not a cluster; uniformity is the point of the component, so it
   * is enforced here rather than trusted to five call sites.
   */
  size?: AvatarSize;
}

/**
 * An overlapping cluster of avatars with a `+N` overflow — deal watchers, ticket participants, the
 * agents on a shift.
 *
 * ACCESSIBILITY — the group is `role="img"` with `aria-label={label}`, so assistive tech announces
 * the cluster once, as one thing, and never walks into the individual faces. This is the reason
 * `Avatar` has no accessible name of its own: in a group, five silent avatars plus one honest
 * summary is dramatically better than five announcements of "AN", "BK", "image".
 * Do not put per-avatar labels back in. "A N, B K, C L, plus 3" is not a sentence anyone wants read
 * to them, and the initials are a rendering artefact, not names.
 *
 * STACKING — overlap comes from a negative inline margin, and depth comes from DOM order alone:
 * later children paint over earlier ones, and the `+N` chip, being last, sits on top. There is no
 * `z-index` in this component on purpose. A raw z-index is only legal in the -1..3 band inside an
 * already-isolated stacking context, and a group of nine avatars would need nine of them.
 *
 * KEYBOARD — none. The group is decorative markup around decorative marks. If the cluster is meant
 * to open a participant list, wrap it in a `<button>`; that button takes the focus ring, the Enter
 * and Space handling, and an accessible name describing the ACTION ("Show all 8 participants") —
 * at which point the group's own `label` becomes redundant and should be shortened.
 *
 * WHEN NOT TO USE IT
 * - As the participant list itself. This shows that there are eight people, not who they are. If
 *   the user needs to read the names, render a list; if they need to act on one, render rows.
 * - Above ~6 visible faces. Past that the overlap eats each face and the cluster is a smear — lower
 *   `max` and let the `+N` do the work.
 * - For logos or workspace marks. Overlap implies "these are peers in one set"; a row of tenant
 *   logos is a list, not a pile.
 * - Where the avatars must each be clickable. Overlapping hit areas mean the visible part of a
 *   covered avatar is not the part that receives the click. Use rows.
 */
export const AvatarGroup = forwardRef<HTMLSpanElement, AvatarGroupProps>(function AvatarGroup(
  { label, children, max = 4, size = 'md', className, ...rest },
  ref,
) {
  // toArray also drops null/undefined/false and stabilises keys, so `{cond && <Avatar/>}` in the
  // caller does not silently count as a participant in the +N arithmetic.
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<AvatarProps>[];

  const limit = Math.max(1, Math.floor(max));
  const shown = items.slice(0, limit);
  const overflow = items.length - shown.length;

  return (
    <span
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      // One announcement for the whole cluster; the faces inside stay out of the tree entirely.
      role="img"
      aria-label={label}
      {...rest}
    >
      {shown.map((child) =>
        // Size is forced, not merged: the group owns the geometry. Everything else the caller set
        // on the Avatar (src, initials, status, style) is untouched.
        cloneElement(child, { size }),
      )}
      {overflow > 0 ? (
        // aria-hidden because the group's label already accounts for these people ("and 3 others").
        // Announcing "+3" as well would double-count them.
        <span className={styles.more} aria-hidden="true">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
});
