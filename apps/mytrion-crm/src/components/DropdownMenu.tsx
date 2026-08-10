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
 *
 * THE PANEL IS PORTALLED TO <body> AND POSITIONED IN VIEWPORT COORDINATES. It used to be
 * `position: absolute` inside the trigger's own box, which is simpler and was also a real bug: the
 * sidebar sets `overflow: hidden` (it has to — it animates its own width, and the labels must be
 * clipped while it does), so a menu opened from the collapsed 68px rail was sliced off at the rail's
 * edge and Profile / Sign out were unreachable. No ancestor can clip a portalled panel, and the
 * position is clamped to the viewport so a trigger hard against an edge still gets a whole menu.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './DropdownMenu.module.css';

/** Gap between the trigger and the panel, matching the old `calc(100% + 6px)`. */
const OFFSET = 6;
/** Keep the panel off the viewport edge when a trigger sits right against it. */
const EDGE = 8;

/**
 * First-render placeholder, before the trigger has been measured.
 *
 * The panel MUST be in the DOM on the very first render, not gated behind the measurement: the
 * keyboard-open path focuses the first item from an effect, and an effect cannot focus an element
 * that has not mounted yet. (The original keyboard tests caught exactly that when this was gated.)
 * `visibility: hidden` keeps it unpainted for the one frame before the layout effect measures — and
 * a layout effect runs before paint, so that frame never reaches the screen.
 */
const UNMEASURED: CSSProperties = {
  position: 'fixed',
  insetBlockStart: 0,
  insetInlineStart: 0,
  visibility: 'hidden',
};

/**
 * Where the panel goes, in VIEWPORT coordinates.
 *
 * It is measured rather than declared because the panel is now portalled to <body> — see the
 * component docblock. `position: absolute` inside the trigger's own box was simpler, and it was
 * also the bug: the sidebar clips its overflow, so a menu opened from the collapsed rail was cut
 * off at the rail's edge with Profile and Sign out unreachable.
 */
function panelPosition(
  trigger: HTMLElement,
  placement: 'down' | 'up',
  align: 'start' | 'end',
): CSSProperties {
  const r = trigger.getBoundingClientRect();
  const style: CSSProperties = { position: 'fixed' };

  if (placement === 'up') style.bottom = `${Math.round(window.innerHeight - r.top + OFFSET)}px`;
  else style.top = `${Math.round(r.bottom + OFFSET)}px`;

  // Clamped to the viewport: the rail is 68px wide when collapsed, so an end-aligned panel anchored
  // to it would otherwise start at a negative left and hang off the screen.
  if (align === 'end') {
    style.right = `${Math.max(EDGE, Math.round(window.innerWidth - r.right))}px`;
  } else {
    style.left = `${Math.max(EDGE, Math.round(r.left))}px`;
  }
  return style;
}

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
  const [position, setPosition] = useState<CSSProperties | null>(null);

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

  /**
   * Measure before paint, so the panel never renders at 0,0 and jumps.
   *
   * Re-measured on scroll (capture: an ancestor scroller does not bubble) and on resize, because a
   * fixed panel does not travel with a trigger that moves. Closing on those would also be defensible;
   * following is friendlier and costs one rect read.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const measure = (): void => {
      if (triggerRef.current) setPosition(panelPosition(triggerRef.current, placement, align));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, placement, align]);

  useEffect(() => {
    if (!open) return undefined;
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      items()[0]?.focus();
    }
    const onPointerDown = (ev: PointerEvent): void => {
      // A press outside dismisses WITHOUT pulling focus back — the pointer is already going somewhere
      // else, and yanking focus to the trigger would fight whatever the user just clicked.
      // BOTH refs: the panel is portalled to <body>, so it is no longer inside rootRef and a press
      // on a menu item would otherwise read as "outside" and close the menu before it fired.
      const target = ev.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
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

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={`${id}-menu`}
              role="menu"
              aria-label={label}
              className={`${styles.menu} ${placement === 'up' ? styles.up : styles.down}${
                menuClassName ? ` ${menuClassName}` : ''
              }`}
              style={position ?? UNMEASURED}
              onKeyDown={onMenuKeyDown}
            >
              {children(() => close())}
            </div>,
            document.body,
          )
        : null}
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
