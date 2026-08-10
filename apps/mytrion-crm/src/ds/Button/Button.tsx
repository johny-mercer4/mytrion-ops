import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * `primary` — the ONE affirmative action on a surface. Two primaries on a screen means one of
   *   them is secondary.
   * `secondary` — the default bordered control.
   * `ghost` — chrome: toolbar and table-row actions, where a border per control would be a cage.
   * `danger` — destructive and irreversible only. Not "important".
   * `link` — an inline action inside prose or a cell.
   */
  variant?: ButtonVariant | undefined;
  /** `md` (32px) is the default. `sm` (26px) is for table rows and dense toolbars. */
  size?: ButtonSize | undefined;
  /** Leading icon. Pass a name — the icon family is not the caller's choice. */
  icon?: IconName | undefined;
  /** Trailing icon. Use for disclosure (`expand_more`) or direction (`arrow_forward`), not decoration. */
  iconEnd?: IconName | undefined;
  /**
   * Shows a spinner and blocks activation. The label stays measured, so the button does not resize
   * when it starts working.
   */
  loading?: boolean | undefined;
  /** Spans its container — form footers, mobile sheets. */
  fullWidth?: boolean | undefined;
  /**
   * Omit for an icon-only button and pass `aria-label` instead. Required otherwise: a button with
   * no accessible name is unusable by keyboard and screen-reader users alike.
   */
  children?: ReactNode | undefined;
}

/**
 * The one button.
 *
 * Replaces 60+ bespoke `.btn` classes across twelve workspaces (`.bm-btn-primary`, `.cs-btn-danger`,
 * `.hr-icon-btn`, `.mg-btn`, `.an-btn-ghost`, `.fi-btn-icon`, …), each of which re-derived the same
 * four variants with its own padding, radius and hover.
 *
 * KEYBOARD — it is a native `<button>`, so Enter and Space activate it and it sits in the tab order
 * for free. That is the reason it is a `<button>` and not a styled `<div>`.
 *
 * DISABLED — pass `disabled` when no explanation is owed. Pass `aria-disabled` instead when the UI
 * explains WHY (a tooltip, an inline hint): `aria-disabled` keeps the control focusable, so a
 * keyboard user can reach the explanation. `disabled` removes it from the tab order entirely.
 *
 * WHEN NOT TO USE IT
 * - Navigation. If it changes the URL it is a link; render an `<a>`. A button that navigates breaks
 *   middle-click, cmd-click, and "copy link address".
 * - A toggle with a persistent on/off state — that is `Switch`, or a button with `aria-pressed`.
 * - More than one primary per surface. Demote the others.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconEnd,
    loading = false,
    fullWidth = false,
    children,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconOnly = !children && Boolean(icon ?? iconEnd);
  const iconSize = size === 'sm' ? 'sm' : 'md';

  return (
    <button
      ref={ref}
      // Defaulting to "button" rather than the HTML default "submit" is deliberate: a button inside
      // a form that submits it by accident is one of the most common bugs in this codebase's class.
      type={type}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      data-loading={loading || undefined}
      data-full={fullWidth || undefined}
      // A loading button must not fire again. `disabled` (not aria-disabled) is right here because
      // there is nothing to explain — the spinner already says why.
      disabled={disabled ?? (loading || undefined)}
      // Tells assistive tech the control is temporarily busy rather than permanently broken.
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={styles.content}>
        {icon ? <Icon name={icon} size={iconSize} /> : null}
        {children}
        {iconEnd ? <Icon name={iconEnd} size={iconSize} /> : null}
      </span>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true">
          <span className={styles.spinnerGlyph} />
        </span>
      ) : null}
    </button>
  );
});
