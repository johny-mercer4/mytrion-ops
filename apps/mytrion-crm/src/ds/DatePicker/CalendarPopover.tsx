import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredLayer, type OverlayPlacement } from '../Overlay/anchoring';
import styles from './DatePicker.module.css';

export interface CalendarPopoverProps {
  open: boolean;
  /** The button the panel points at, and the element focus goes back to. */
  triggerRef: RefObject<HTMLElement>;
  /**
   * `restoreFocus` is false only for an outside pointer press: the pointer has already chosen where
   * attention goes, and dragging focus back to the trigger would fight the click being made.
   * `cancelled` is true for Escape, which must also put the value back the way it was.
   */
  onClose: (options: { restoreFocus: boolean; cancelled: boolean }) => void;
  /** Accessible name of the dialog. Say what it CHOOSES, not that it is a dialog. */
  label: string;
  /** `bottom-end` is the default: the panel's trailing edge lines up with the trigger it hangs off. */
  placement?: OverlayPlacement | undefined;
  id: string;
  children: ReactNode;
}

/** Everything a Tab can land on inside the panel. Roving tabindex keeps this to about three nodes. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

/**
 * The floating shell the calendar lives in — anchoring, dismissal, and the focus contract.
 *
 * INTERNAL. It exists as its own file because `DatePicker` and `DateRangePicker` need identical
 * behaviour here and identical is the point: two overlays that differ by eight pixels and one
 * Escape handler are two overlays users have to learn separately.
 *
 * `role="dialog"`, not `aria-modal`. The page behind it is not inert — the field the panel belongs
 * to is still there and still readable, which is the whole reason the calendar is a popover rather
 * than a modal. What IS trapped is Tab, and only Tab: cycling inside the panel is what stops a
 * keyboard user from tabbing into the page behind a panel they can still see.
 *
 * KEYBOARD
 *   Escape           close, RESTORE THE PREVIOUS VALUE, and return focus to the trigger
 *   Tab / Shift+Tab  cycle within the panel
 * The grid's own arrow-key map lives in `Calendar`.
 */
export function CalendarPopover({
  open,
  triggerRef,
  onClose,
  label,
  placement = 'bottom-end',
  id,
  children,
}: CalendarPopoverProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const { style, side } = useAnchoredLayer({ anchorRef: triggerRef, layerRef, open, placement });

  // Outside press. `pointerdown` in the CAPTURE phase, not `click`: capture beats a stopPropagation
  // anywhere in the app, and reacting at press time means the panel is gone before the click lands,
  // so whatever is underneath receives it instead of having it swallowed.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (layerRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // Committed, not cancelled. Clicking away is not "undo" — the user may well have picked a
      // date and then clicked the next field, and reverting that would throw their work away.
      onClose({ restoreFocus: false, cancelled: false });
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose, triggerRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Handled here, so it must not keep travelling: a calendar open inside a dialog would
        // otherwise close both at once, and the user loses the form they were working in as the
        // price of dismissing a date picker.
        event.stopPropagation();
        onClose({ restoreFocus: true, cancelled: true });
        return;
      }
      if (event.key !== 'Tab') return;

      const layer = layerRef.current;
      if (!layer) return;
      const stops = Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // `tabIndex >= 0` rather than a `:not([tabindex="-1"])` selector, because the roving day
        // buttons carry their -1 as a PROPERTY React set, and the attribute selector reads the
        // attribute. The property is the one the browser tabs by.
        (node) => node.tabIndex >= 0,
      );
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;

      const activeElement = document.activeElement;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return createPortal(
    <div
      ref={layerRef}
      id={id}
      role="dialog"
      aria-label={label}
      className={styles.popover}
      data-side={side}
      style={style}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
