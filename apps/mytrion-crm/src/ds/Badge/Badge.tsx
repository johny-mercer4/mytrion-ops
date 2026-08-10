import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Badge.module.css';

export type BadgeIntent = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * What the badge MEANS, not what colour it is — the tokens are `--intent-*`, so the badge asks
   * for "danger" and the theme decides the hue in both modes.
   *
   * `neutral` — a fact with no valence: a count, a type, a queue name.
   * `success` — settled, paid, approved, live.
   * `warning` — needs attention but nothing is broken yet: expiring, pending review.
   * `danger`  — failed, declined, overdue, suspended.
   * `info`    — in progress / informational: running, syncing, queued.
   * `accent`  — EMPHASIS, not status. "New", "Beta", an unread count. It is the only filled
   *   treatment here, which is why it is separated from `info` even though both are brand-tinted:
   *   a filled brand chip next to five tinted status chips reads as "look at me", and that is the
   *   entire job. Do not use it to mean "good".
   */
  intent?: BadgeIntent;
  /** `md` (20px) is the default. `sm` (16px) is for table cells and inside dense list rows. */
  size?: BadgeSize;
  /**
   * Leading icon. THIS IS THE ACCESSIBILITY CHANNEL, not decoration — see the docblock. Pass a
   * name; the icon family is not the caller's choice.
   */
  icon?: IconName;
  /**
   * A small leading disc in the intent's colour. Ignored when `icon` is set — two leading marks in
   * a 20px chip is noise, and the icon is the one that survives a colour-blind reader.
   *
   * The dot is REDUNDANT decoration on an already-labelled badge. It is not, and can never be, the
   * thing that distinguishes success from danger.
   */
  dot?: boolean;
  /**
   * The label. Required, deliberately: a badge whose only content is a colour is a badge that means
   * nothing to a colour-blind user, to a screen reader, and to anyone printing the page in
   * greyscale. There is no icon-only badge — an icon-only status mark is `Icon` with a `label`.
   */
  children: ReactNode;
}

/**
 * A status/metadata chip. Static, inline, non-interactive.
 *
 * NEVER MEANING BY COLOUR ALONE — the rule this component exists to enforce.
 * Three channels carry the meaning, in this order:
 *   1. the LABEL, which is required by the type and is the only channel that works everywhere;
 *   2. the ICON, which is what makes two badges distinguishable at a glance for the ~8% of men with
 *      a red/green deficiency, for whom `--intent-success-fg` and `--intent-danger-fg` are close to
 *      the same muddy tone. Pass one on any badge whose whole purpose is to be scanned in a column
 *      (`check_circle` / `warning` / `error` / `info` / `schedule` / `block`);
 *   3. the COLOUR, which is the fastest channel for everyone else and the only optional one.
 * A badge that drops (1) or (2) and keeps (3) is a defect, not a style.
 *
 * KEYBOARD — none, and that is the design. A Badge is a `<span>`: it is not focusable, not in the
 * tab order, and has no activation behaviour. If you find yourself wanting a key map here, you want
 * a different component (see below).
 *
 * WIDTH — the badge hugs its label and never wraps (`white-space: nowrap`, `flex: none`), so a
 * status column stays a column instead of reflowing into two lines at a narrow viewport. If the
 * label is long enough to need wrapping, it is a sentence, and a sentence is not a badge.
 *
 * WHEN NOT TO USE IT
 * - Anything clickable. A badge you can click or toggle is a Chip/filter token and belongs in a
 *   `<button>` with hover, active, focus-visible and `aria-pressed` — the full interactive state
 *   matrix, none of which this component has. Putting `onClick` on this span produces a control
 *   that a keyboard user cannot reach and a screen reader never announces as actionable. There is
 *   no `onClick` story here on purpose.
 * - Anything dismissible. A badge with an × is a Tag/token; the × is a real button with its own
 *   accessible name ("Remove Denver").
 * - Free-form emphasis inside a paragraph. That is `<strong>`, or the `link` Button variant.
 * - A count hanging off an icon in the rail. That is a notification dot on the control itself, not
 *   a labelled chip — this component always renders a label, which is wrong in 16px of chrome.
 * - Long text. See WIDTH.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { intent = 'neutral', size = 'md', icon, dot = false, children, className, ...rest },
  ref,
) {
  // The icon and the dot compete for the same leading slot, and the icon wins because it is the
  // channel that survives a colour-blind reader — the dot is pure colour.
  const showDot = dot && !icon;

  return (
    <span
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-intent={intent}
      data-size={size}
      {...rest}
    >
      {icon ? (
        // No `label` on the Icon: the badge's own text already says what this is, and a labelled
        // icon here would make a screen reader announce the meaning twice ("error error Declined").
        <Icon name={icon} size="sm" />
      ) : null}
      {showDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      <span className={styles.label}>{children}</span>
    </span>
  );
});
