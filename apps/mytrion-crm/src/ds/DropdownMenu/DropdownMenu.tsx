import {
  cloneElement,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon/Icon';
import {
  chain,
  mergeRefs,
  refOfElement,
  useAnchoredLayer,
  type AnchorInjectedProps,
  type OverlayPlacement,
} from '../Overlay/anchoring';
import styles from './DropdownMenu.module.css';

export type DropdownMenuPlacement = OverlayPlacement;

/** A command. The ordinary row. */
export interface DropdownMenuActionItem {
  kind: 'action';
  /** Stable and unique within the menu — it keys the row and addresses it for keyboard focus. */
  id: string;
  /** Also the typeahead target: users type the first letters of this string to jump to the row. */
  label: string;
  icon?: IconName;
  /** Right-aligned qualifier — a keyboard shortcut, a count, a scope. Never a second sentence. */
  hint?: string;
  /**
   * Destructive and irreversible only, same bar as `Button`'s `danger`. The red REINFORCES; the
   * label must carry the meaning on its own ("Delete carrier", not "Confirm"), because colour is
   * never allowed to be the only signal.
   */
  destructive?: boolean;
  /**
   * Stays focusable and stays announced — it is `aria-disabled`, not `disabled`. A row a keyboard
   * user cannot reach is a row they cannot discover exists, and a menu is a list of what is
   * POSSIBLE here, which includes what is possible only later.
   */
  disabled?: boolean;
  onSelect: () => void;
  /** Defaults to `true`. Set `false` for a row that visibly mutates the menu it lives in. */
  closeOnSelect?: boolean;
}

/** A togglable option. Renders `role="menuitemcheckbox"` and keeps the menu open by default. */
export interface DropdownMenuCheckboxItem {
  kind: 'checkbox';
  id: string;
  label: string;
  /** Controlled. The menu never holds this state — the caller owns it and re-renders. */
  checked: boolean;
  hint?: string;
  disabled?: boolean;
  onSelect: (checked: boolean) => void;
  /**
   * Defaults to `false`. Column pickers and filter menus are used in bursts; closing after each
   * tick means re-opening the menu four times to tick four boxes.
   */
  closeOnSelect?: boolean;
}

/** A section heading. Not focusable, not selectable — it names the rows beneath it. */
export interface DropdownMenuLabelItem {
  kind: 'label';
  id: string;
  label: string;
}

/** A rule between groups. `role="separator"`, so it is announced as a boundary, not skipped. */
export interface DropdownMenuSeparatorItem {
  kind: 'separator';
  id: string;
}

export type DropdownMenuItem =
  | DropdownMenuActionItem
  | DropdownMenuCheckboxItem
  | DropdownMenuLabelItem
  | DropdownMenuSeparatorItem;

type FocusableItem = DropdownMenuActionItem | DropdownMenuCheckboxItem;

export interface DropdownMenuProps {
  /**
   * The control that opens the menu. Cloned, so it must forward its ref to a real DOM node, and it
   * should be a native `<button>` — that is where Enter and Space activation comes from for free.
   * `aria-haspopup`, `aria-expanded` and `aria-controls` are injected; do not pass them yourself.
   */
  trigger: ReactElement;
  /** Rendered in order. Labels open a group; separators close one. */
  items: DropdownMenuItem[];
  /** `bottom-start` is the default — the row labels line up with the trigger's leading edge. */
  placement?: DropdownMenuPlacement;
  /**
   * Accessible name for the menu itself. Omit it and the menu is labelled BY the trigger, which is
   * usually what you want ("Row actions" once, not twice).
   */
  label?: string;
  /** Fires on every open and close, whatever caused it. The menu owns its own open state. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

/** How long a typeahead buffer survives without a keystroke. The WAI-ARIA APG figure. */
const TYPEAHEAD_RESET_MS = 500;

function isFocusable(item: DropdownMenuItem): item is FocusableItem {
  return item.kind === 'action' || item.kind === 'checkbox';
}

/**
 * The one dropdown menu. A trigger, and a list of commands that appear next to it.
 *
 * WHY THE ITEMS ARE DATA AND NOT CHILDREN. Every keyboard requirement below — wraparound, Home/End,
 * typeahead, "which row is first" — needs the menu to KNOW its rows in order. A children-based API
 * forces it to query the DOM and infer that order, which quietly breaks the moment a caller wraps a
 * row in a `<div>` or maps over a fragment. An array cannot be wrapped wrong.
 *
 * KEYBOARD — the whole map, because a menu is a keyboard component that happens to accept a mouse.
 *   On the trigger
 *     Enter / Space   open, focus the first row
 *     ArrowDown       open, focus the first row
 *     ArrowUp         open, focus the LAST row — for the menu whose destructive row is at the bottom
 *   In the menu
 *     ArrowDown / Up  move one row, WRAPPING at both ends
 *     Home / End      first / last row
 *     a-z, 0-9        typeahead. Repeating one letter cycles the rows starting with it; typing
 *                     several letters narrows. The buffer clears after 500ms of silence.
 *     Enter / Space   activate the focused row
 *     Escape          close AND RETURN FOCUS TO THE TRIGGER
 *     Tab             close, return focus to the trigger, and let the tab continue from there
 *
 * FOCUS RESTORATION is the part that gets skipped, and skipping it is what makes a keyboard user
 * lose their place: closing a menu without restoring focus drops focus onto `<body>`, so the next
 * Tab starts again from the top of the document. Every keyboard-initiated close here restores.
 * Clicking outside does NOT restore — the pointer has already chosen where attention goes.
 *
 * DISABLED ROWS ARE STILL REACHABLE. Arrow keys and typeahead land on them and a screen reader
 * announces them as unavailable; only activation is refused. That is the house rule (CONVENTIONS
 * §5) applied to a list: never `pointer-events: none`, never removed from the sequence.
 *
 * WHEN NOT TO USE IT
 * - Choosing a value for a form field. That is a `Select` — it has a value, a name, and a form
 *   contract; a menu has commands and no value at all.
 * - Navigation between pages. Render links. A menu of `<button>`s that navigate breaks
 *   middle-click, cmd-click and "copy link address".
 * - Anything with an input, a slider, or free text in it. That is a `Popover`.
 * - More than about a dozen rows, or rows that need searching. That is a command palette.
 * - The primary action of a screen. If it matters, it is a `Button` on the surface, not one row of
 *   a list nobody opens.
 */
export function DropdownMenu({
  trigger,
  items,
  placement = 'bottom-start',
  label,
  onOpenChange,
  className,
  style,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemNodes = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<'first' | 'last' | null>(null);
  const typeahead = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: '',
    timer: null,
  });

  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const triggerId = `${baseId}-trigger`;

  const focusables = useMemo(() => items.filter(isFocusable), [items]);

  /**
   * The rows, arranged into groups. A section label is only announced as a group name if the rows
   * it names are actually inside a `role="group"` that points at it — a heading floating between
   * siblings is decoration, and screen-reader users hear nothing.
   */
  const blocks = useMemo(() => {
    type Block =
      | { type: 'group'; key: string; labelId?: string; label?: string; rows: FocusableItem[] }
      | { type: 'separator'; key: string };

    const out: Block[] = [];
    let current: Extract<Block, { type: 'group' }> | null = null;

    for (const item of items) {
      if (item.kind === 'separator') {
        current = null;
        out.push({ type: 'separator', key: item.id });
      } else if (item.kind === 'label') {
        current = {
          type: 'group',
          key: item.id,
          label: item.label,
          labelId: `${baseId}-${item.id}`,
          rows: [],
        };
        out.push(current);
      } else {
        if (!current) {
          current = { type: 'group', key: `group-${item.id}`, rows: [] };
          out.push(current);
        }
        current.rows.push(item);
      }
    }
    return out;
  }, [items, baseId]);

  // Reserve the leading column only when something occupies it. Otherwise every label in a
  // plain menu sits indented past an empty gutter that never fills.
  const hasLeadingSlot = useMemo(
    () => items.some((item) => item.kind === 'checkbox' || (item.kind === 'action' && item.icon)),
    [items],
  );

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const openMenu = useCallback(
    (focusTarget: 'first' | 'last') => {
      pendingFocus.current = focusTarget;
      setOpenState(true);
    },
    [setOpenState],
  );

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      setOpenState(false);
      // Imperative and synchronous, on purpose. The trigger is NOT inside the portal, so it is
      // still mounted at this instant; moving focus now (rather than in an effect after the
      // unmount) is what keeps a Tab keypress continuing from the trigger instead of from <body>.
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setOpenState],
  );

  const focusRow = useCallback(
    (index: number) => {
      const item = focusables[index];
      if (item) itemNodes.current.get(item.id)?.focus();
    },
    [focusables],
  );

  /** Where focus is right now, read from the DOM rather than mirrored in state. */
  const currentIndex = useCallback(
    () =>
      focusables.findIndex(
        (item) => itemNodes.current.get(item.id) === document.activeElement,
      ),
    [focusables],
  );

  // Declared BEFORE the landing-focus effect below, so within the opening commit the menu is
  // positioned first and focused second.
  const { style: layerStyle, side } = useAnchoredLayer({
    anchorRef: triggerRef,
    layerRef: menuRef,
    open,
    placement,
  });

  // Landing focus. useLayoutEffect so it happens before paint — a menu that appears and then takes
  // focus a frame later is a menu the first keystroke misses.
  useLayoutEffect(() => {
    if (!open || !pendingFocus.current) return;
    focusRow(pendingFocus.current === 'first' ? 0 : focusables.length - 1);
    pendingFocus.current = null;
  }, [open, focusRow, focusables.length]);

  // Outside press. `pointerdown` in the CAPTURE phase, not `click`: capture beats a stopPropagation
  // anywhere in the app, and reacting at press time means the menu is gone before the click lands,
  // so the thing underneath receives it. Closing on `click` swallows that first click instead.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // No focus restoration: the pointer has already chosen where attention goes, and yanking it
      // back to the trigger would fight the click the user is in the middle of making.
      closeMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, closeMenu]);

  useEffect(() => {
    const state = typeahead.current;
    return () => {
      if (state.timer !== null) clearTimeout(state.timer);
    };
  }, []);

  const runTypeahead = useCallback(
    (char: string) => {
      const state = typeahead.current;
      if (state.timer !== null) clearTimeout(state.timer);
      state.buffer += char.toLowerCase();
      state.timer = setTimeout(() => {
        state.buffer = '';
      }, TYPEAHEAD_RESET_MS);

      const query = state.buffer;
      // "sss" means the user is CYCLING the rows that start with s, not looking for a row called
      // "sss". Collapse a same-letter run to one letter and start the search AFTER the current row;
      // a genuine multi-letter query is a refinement, so it starts AT the current row and may well
      // match it again.
      const first = query.slice(0, 1);
      const repeated = query.split('').every((c) => c === first);
      const needle = repeated ? first : query;
      const from = Math.max(currentIndex(), 0);
      const offset = repeated ? 1 : 0;

      for (let step = 0; step < focusables.length; step += 1) {
        const index = (from + offset + step) % focusables.length;
        const candidate = focusables[index];
        if (candidate && candidate.label.toLowerCase().startsWith(needle)) {
          focusRow(index);
          return;
        }
      }
    },
    [currentIndex, focusRow, focusables],
  );

  const moveFocus = useCallback(
    (delta: number) => {
      if (focusables.length === 0) return;
      const index = currentIndex();
      // Wraparound. From nowhere, ArrowDown lands on the first row and ArrowUp on the last.
      const next =
        index < 0
          ? delta > 0
            ? 0
            : focusables.length - 1
          : (index + delta + focusables.length) % focusables.length;
      focusRow(next);
    },
    [currentIndex, focusRow, focusables.length],
  );

  const activate = useCallback(
    (item: FocusableItem) => {
      // Disabled rows are real, focusable buttons (aria-disabled, never the native attribute), so
      // this guard — not the DOM — is what refuses the activation.
      if (item.disabled) return;

      if (item.kind === 'checkbox') {
        if (item.closeOnSelect) closeMenu(true);
        item.onSelect(!item.checked);
        return;
      }
      // Close BEFORE the callback runs. If `onSelect` opens a dialog, that dialog will take focus
      // for itself a moment later; restoring focus afterwards would drag it back out of the dialog.
      if (item.closeOnSelect !== false) closeMenu(true);
      item.onSelect();
    },
    [closeMenu],
  );

  const onMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(-1);
          return;
        case 'Home':
          event.preventDefault();
          focusRow(0);
          return;
        case 'End':
          event.preventDefault();
          focusRow(focusables.length - 1);
          return;
        case 'Escape':
          event.preventDefault();
          // Escape IS handled here, so it must not keep travelling: a menu open inside a dialog
          // would otherwise close both at once, and the user would lose the dialog they were
          // working in as the price of dismissing a menu.
          event.stopPropagation();
          closeMenu(true);
          return;
        case 'Tab':
          // No preventDefault. `closeMenu(true)` puts focus back on the trigger synchronously, and
          // the browser then performs its own Tab from there — so the menu closes AND the tab does
          // what the user asked, in one keystroke.
          closeMenu(true);
          return;
        default:
          break;
      }

      // Typeahead: a single printable character, with no modifier that would make it a shortcut.
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Space is activation on a focused row, never the start of a query — the row's own button
        // will handle it.
        if (event.key === ' ') return;
        event.preventDefault();
        runTypeahead(event.key);
      }
    },
    [closeMenu, focusRow, focusables.length, moveFocus, runTypeahead],
  );

  const triggerProps: AnchorInjectedProps = {
    ref: mergeRefs<HTMLElement>(triggerRef, refOfElement(trigger)),
    id: trigger.props.id ?? triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    // Only while open: `aria-controls` may only point at an element that exists, and the menu lives
    // in a portal that is unmounted the rest of the time.
    'aria-controls': open ? menuId : undefined,
    onClick: chain(trigger.props.onClick, () => {
      if (open) closeMenu(true);
      else openMenu('first');
    }),
    onKeyDown: chain(trigger.props.onKeyDown, (event: KeyboardEvent<HTMLElement>) => {
      if (open) return;
      // Enter and Space are deliberately absent: a native <button> already turns them into a
      // click, and handling them here as well would open the menu twice.
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu('first');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu('last');
      }
    }),
  };

  const registerRow =
    (id: string) =>
    (node: HTMLButtonElement | null): void => {
      if (node) itemNodes.current.set(id, node);
      else itemNodes.current.delete(id);
    };

  const renderRow = (item: FocusableItem) => {
    const icon: IconName | undefined = item.kind === 'action' ? item.icon : undefined;
    const checked = item.kind === 'checkbox' ? item.checked : undefined;

    return (
      <button
        key={item.id}
        ref={registerRow(item.id)}
        type="button"
        role={item.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={checked}
        // aria-disabled, never the native attribute — see the docblock. A native `disabled` button
        // is removed from the sequence entirely and announces nothing.
        aria-disabled={item.disabled || undefined}
        // Roving focus: nothing inside the menu is in the document tab order, because Tab's job in
        // an open menu is to LEAVE it, not to walk it. Arrows walk it.
        tabIndex={-1}
        className={styles.row}
        data-destructive={(item.kind === 'action' && item.destructive) || undefined}
        data-checked={checked}
        onClick={() => activate(item)}
        // Pointer focus follows the cursor, so the keyboard and the mouse never disagree about
        // which row is current — arrow down after hovering continues from where the pointer was.
        onMouseEnter={(event) => event.currentTarget.focus()}
      >
        <span className={styles.rowLeading}>
          {icon ? <Icon name={icon} size="sm" /> : null}
          {/* The tick is a SHAPE, so checked/unchecked survives greyscale, colour-blindness and a
              printed screenshot. aria-checked carries it for screen readers; neither leans on hue. */}
          {checked ? <Icon name="check" size="sm" /> : null}
        </span>
        <span className={styles.rowLabel}>{item.label}</span>
        {item.hint ? <span className={styles.rowHint}>{item.hint}</span> : null}
      </button>
    );
  };

  return (
    <>
      {cloneElement(trigger as ReactElement<AnchorInjectedProps>, triggerProps)}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              aria-labelledby={label ? undefined : (trigger.props.id ?? triggerId)}
              tabIndex={-1}
              className={[styles.menu, className].filter(Boolean).join(' ')}
              data-side={side}
              data-leading={hasLeadingSlot || undefined}
              style={{ ...layerStyle, ...style }}
              onKeyDown={onMenuKeyDown}
            >
              {blocks.map((block) =>
                block.type === 'separator' ? (
                  <div key={block.key} role="separator" className={styles.separator} />
                ) : block.label ? (
                  <div key={block.key} role="group" aria-labelledby={block.labelId}>
                    <div id={block.labelId} className={styles.sectionLabel}>
                      {block.label}
                    </div>
                    {block.rows.map(renderRow)}
                  </div>
                ) : (
                  // No label, so no `role="group"`: an unnamed group is a boundary a screen reader
                  // announces and a user cannot act on. Rows sit directly under role="menu".
                  <Fragment key={block.key}>{block.rows.map(renderRow)}</Fragment>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
