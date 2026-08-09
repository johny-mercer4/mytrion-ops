import type { ReactNode } from 'react';
import { Button } from '../Button/Button';
import styles from './ModalChrome.module.css';

export interface ModalChromeProps {
  /** Id of the `<h2>`, so the surrounding surface can point `aria-labelledby` at it. */
  titleId: string;
  title: ReactNode;
  /** One line of context under the title. Not a paragraph — that belongs in the body. */
  subtitle?: ReactNode;
  dismissible: boolean;
  closeLabel: string;
  onDismiss: () => void;
  /** Action row. Pinned: it must never scroll away — see the note on `.body` in the stylesheet. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The header / body / footer slots shared by `Dialog` and `Drawer`. Internal — not exported from
 * `src/ds`, because it is not usable on its own: it renders a FRAGMENT of three siblings that must
 * land as direct children of a `display: grid` panel, and the panel owns the row template that
 * makes the body — and only the body — scroll.
 *
 * Splitting it out is what keeps a drawer and a dialog looking like the same product. The two
 * surfaces genuinely differ (anchor, entrance, radius) and each owns that; the chrome inside them
 * has no reason to differ at all, and duplicating it is how "the drawer's title is 2px smaller"
 * happens.
 */
export function ModalChrome({
  titleId,
  title,
  subtitle,
  dismissible,
  closeLabel,
  onDismiss,
  footer,
  children,
}: ModalChromeProps) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          {/* h2, not h3 or a styled div: the page owns the h1, and a dialog title that is not a
              heading is unreachable by the "next heading" navigation every screen-reader user
              actually uses to orient inside a new surface. */}
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {dismissible ? (
          <Button
            className={styles.dismiss}
            variant="ghost"
            size="sm"
            icon="close"
            aria-label={closeLabel}
            onClick={onDismiss}
          />
        ) : null}
      </header>

      {/* The scroll owner. No tabIndex: browsers make overflowing regions keyboard-focusable on
          their own now, and hard-coding a tab stop would add one to every dialog whose body does
          not scroll — which is most of them. */}
      <div className={styles.body}>{children}</div>

      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </>
  );
}
