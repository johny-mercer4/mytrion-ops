/**
 * The app's menu popover — one implementation for the header and the sidebar rail.
 *
 * This is the ARIA menu-button pattern, which differs from a listbox in one important way: focus MOVES
 * INTO the menu. A listbox is a value you are picking, so focus stays on the control that holds the
 * value; a menu is a set of commands, so the commands themselves are what you arrow through.
 *
 * Opening direction is a prop rather than measured, because both call sites already know: a header menu
 * hangs down, a menu on the bottom of the sidebar hangs up. Measuring would be guesswork dressed up as
 * cleverness in a chrome whose geometry is fixed.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './DropdownMenu.module.css';

export function DropdownMenu({
  label,
  trigger,
  triggerClassName,
  menuClassName,
  align = 'end',
  placement = 'down',
  children,
}: {
  /** Accessible name for the trigger. */
  label: string;
  /** Trigger contents. The button itself, and its state wiring, belong to this component. */
  trigger: ReactNode;
  /** `| undefined` throughout: CSS-module class names are typed `string | undefined`, and this repo
   *  runs `exactOptionalPropertyTypes`, which distinguishes "absent" from "present and undefined". */
  triggerClassName?: string | undefined;
  /** Extra class on the panel, for a menu whose geometry differs from the default (the workspace
   *  switcher is a fixed 318px with two-line rows). Appended, so the base rules still apply. */
  menuClassName?: string | undefined;
  /** Which edge the panel lines up with. */
  align?: 'start' | 'end' | undefined;
  placement?: 'down' | 'up' | undefined;
  /** Items. Called with `close` so an item can dismiss the menu after doing its work. */
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** Set when the menu was opened by keyboard, which is the only case that should steal focus. */
  const focusOnOpen = useRef(false);

  const items = useCallback(
    (): HTMLElement[] =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter(
        (el) => !el.hasAttribute('disabled'),
      ),
    [],
  );

  const close = useCallback((returnFocus = true): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      items()[0]?.focus();
    }
    const onPointerDown = (ev: PointerEvent): void => {
      // A press outside dismisses WITHOUT pulling focus back — the pointer is already going somewhere
      // else, and yanking focus to the trigger would fight whatever the user just clicked.
      if (!rootRef.current?.contains(ev.target as Node)) close(false);
    };
    // Capture phase: a bubble-phase listener never fires if anything between the target and the
    // document calls stopPropagation, which leaves the menu stuck open with no way to dismiss it
    // by clicking away.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close, items]);

  const onTriggerKeyDown = (ev: React.KeyboardEvent): void => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter' || ev.key === ' ') {
      if (open) return;
      ev.preventDefault();
      focusOnOpen.current = true;
      setOpen(true);
    }
  };

  const onMenuKeyDown = (ev: React.KeyboardEvent): void => {
    const list = items();
    if (list.length === 0) return;
    const current = list.indexOf(document.activeElement as HTMLElement);

    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        list[Math.min(list.length - 1, current + 1)]?.focus();
        return;
      case 'ArrowUp':
        ev.preventDefault();
        list[Math.max(0, current - 1)]?.focus();
        return;
      case 'Home':
        ev.preventDefault();
        list[0]?.focus();
        return;
      case 'End':
        ev.preventDefault();
        list[list.length - 1]?.focus();
        return;
      case 'Escape':
        ev.preventDefault();
        close();
        return;
      case 'Tab':
        // Tab means "I am done here" — let focus travel, but never leave the panel open behind it.
        close(false);
        return;
      default:
        break;
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          className={`${styles.menu} ${align === 'start' ? styles.alignStart : styles.alignEnd} ${
            placement === 'up' ? styles.up : styles.down
          }${menuClassName ? ` ${menuClassName}` : ''}`}
          onKeyDown={onMenuKeyDown}
        >
          {children(() => close())}
        </div>
      ) : null}
    </div>
  );
}

/** One command. A real button, so Enter and Space activate it without any of our help. */
export function MenuItem({
  icon,
  children,
  hint,
  danger,
  onSelect,
}: {
  icon?: ReactNode | undefined;
  children: ReactNode;
  /** Trailing text — the current value for a toggle, a keyboard hint, a checkmark. */
  hint?: ReactNode | undefined;
  danger?: boolean | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${danger ? styles.danger : ''}`}
      onClick={onSelect}
    >
      {icon ? <span className={styles.itemIcon}>{icon}</span> : null}
      <span className={styles.itemLabel}>{children}</span>
      {hint ? <span className={styles.itemHint}>{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className={styles.separator} role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className={styles.heading}>{children}</div>;
}
