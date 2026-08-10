import { forwardRef, useState, type HTMLAttributes } from 'react';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
export type AvatarStatus = 'online' | 'busy' | 'away' | 'offline';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * The fallback glyph — one or two characters, already computed by the caller.
   *
   * WHY A PROP AND NOT A `name` THIS COMPONENT SPLITS: "first letter of the first word, first letter
   * of the last word" is an English/Latin assumption wearing a general-purpose coat. It produces the
   * wrong initials for a Hungarian or Japanese name (family name first), for a Spanish double
   * surname, for a mononym, for "van der Berg", and for any script without a Latin uppercase.
   * Locale and name-order policy is a product decision that belongs where the name comes from, not
   * inside a 32px circle. The primitive renders what it is handed.
   */
  initials: string;
  /** Photo URL. Falls back to `initials` if it fails to load — see the docblock. */
  src?: string;
  /** `md` (32px) is the default. `xs` (20px) inline in a table cell, `lg` (40px) on a profile header. */
  size?: AvatarSize;
  /**
   * Presence indicator. Each status has a distinct SHAPE as well as a colour (filled disc / barred
   * disc / crescent / hollow ring), so presence is legible without colour vision.
   */
  status?: AvatarStatus;
  /**
   * The accessible name for the status dot ("Online", "Do not disturb"). Provide it when the dot is
   * the ONLY place that information appears. Omit it when the row already says "Alice — Online" in
   * text, so a screen reader hears it once.
   */
  statusLabel?: string;
}

/**
 * A person (or company) mark: a photo, or their initials when there is no photo or the photo 404s.
 *
 * IT HAS NO ACCESSIBLE NAME, ON PURPOSE. The `<img>` carries `alt=""` and the initials are
 * `aria-hidden`, so the whole component contributes nothing to the accessibility tree. That is the
 * correct behaviour for a decorative mark that sits beside the name it depicts:
 *   - beside a name in a row, announcing it would repeat the name;
 *   - as the entire content of a button or link, the NAME BELONGS ON THAT CONTROL
 *     (`<button aria-label="Open Alice Nowak">`), which is where a screen-reader user's focus lands;
 *   - in an `AvatarGroup`, the GROUP announces "Alice, Bob and 3 others" as one image.
 * Never announce the initials themselves. "AN" is not a name, it is a rendering artefact, and a
 * screen reader will spell it or mispronounce it as a word.
 *
 * IMAGE FALLBACK — a broken `src` is the common case here (deleted Zoho photo, expired signed URL,
 * an offline laptop), not the exception. `onError` records the URL that failed rather than a bare
 * `failed` boolean, so a later render with a DIFFERENT `src` retries automatically instead of being
 * stuck on the initials for the lifetime of the element. No effect, no key hack.
 *
 * KEYBOARD — none. It is a `<span>`: not focusable, not in the tab order, no activation. When an
 * avatar needs to be clickable, wrap it in a `<button>`; that button owns the focus ring, the key
 * handling and the accessible name.
 *
 * WHEN NOT TO USE IT
 * - As a button. Wrap it; do not add `onClick` here. A clickable span is unreachable by keyboard.
 * - For a logo or a product icon. Those are images with real alt text, not initial-fallback marks.
 * - As the only identification of a person in a dense table. Two people with the same initials and
 *   no photo render identically; the name column is what identifies them, the avatar only helps
 *   the eye find the row again.
 * - As a status-only indicator. If presence is the point and the person is not, render a labelled
 *   Badge — a 6px dot on a 20px circle is below any reasonable hit and legibility floor.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { initials, src, size = 'md', status, statusLabel, className, ...rest },
  ref,
) {
  // The URL that failed, not a boolean: when the caller passes a new src the comparison below goes
  // false again and the image is retried, so a corrected photo appears without remounting.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <span
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      {...rest}
    >
      {showImage ? (
        <img
          className={styles.image}
          src={src}
          // Empty alt, never the person's name — see the docblock. An avatar that announces itself
          // beside the name it depicts makes every row read twice.
          alt=""
          // Decoding off the main thread keeps a long list of avatars from janking the scroll.
          decoding="async"
          loading="lazy"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initials}
        </span>
      )}

      {status ? (
        <span
          className={styles.status}
          data-status={status}
          // Labelled when the dot is the only carrier of the information, decorative otherwise.
          // role="img" is what makes an empty element announce its aria-label at all.
          {...(statusLabel ? { role: 'img', 'aria-label': statusLabel } : { 'aria-hidden': true })}
        />
      ) : null}
    </span>
  );
});
