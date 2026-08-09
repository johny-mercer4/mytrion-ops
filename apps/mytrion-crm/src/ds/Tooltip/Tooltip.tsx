import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  chain,
  mergeRefs,
  refOfElement,
  useAnchoredLayer,
  type AnchorInjectedProps,
  type OverlayPlacement,
} from '../Overlay/anchoring';
import styles from './Tooltip.module.css';

export type TooltipPlacement = OverlayPlacement;

export interface TooltipProps {
  /**
   * The hint. A phrase, not a paragraph — a tooltip is read in a glance, and anything that needs a
   * heading or a link is a `Popover`.
   *
   * MUST NOT be interactive. A tooltip is `role="tooltip"`: assistive tech reads it as the
   * description OF the anchor, not as a place you can go, and a button inside one is unreachable by
   * keyboard no matter how it is styled.
   */
  content: ReactNode;
  /**
   * The single element the tooltip describes. Cloned, so it must forward its ref to a real DOM node
   * — every `src/ds` component does. `Button`, an `<a>`, or a bare `<span>` all work.
   */
  children: ReactElement;
  /** `top` (centred) is the default. Flips to the opposite side automatically when it will not fit. */
  placement?: TooltipPlacement;
  /**
   * Milliseconds of pointer dwell before it opens. 220 mirrors `--dur-slow`, and it is a JS number
   * because a timer is not a stylesheet concern. Closing has no delay at all: a hint that lingers
   * after the pointer leaves is a hint covering the thing you moved towards.
   */
  delay?: number;
  /**
   * Renders the child untouched, with no tooltip and no `aria-describedby`. For the common case of
   * "this hint only applies in one state" — cheaper and safer than conditionally swapping the
   * wrapper, which would remount the child and lose its focus.
   */
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * The one tooltip. A short, non-interactive hint attached to a control.
 *
 * The audit found ZERO canonical tooltips in this app — only `title=""` attributes, which are
 * invisible on touch, unstyleable, ~1s late, and never announced by some screen readers. This is
 * the replacement.
 *
 * OPENS ON HOVER **AND** FOCUS. Both, always. A hint that only a mouse can reach is a hint a
 * keyboard user does not have, and it is usually the hint explaining why a control is disabled.
 * Focus opening is gated on `:focus-visible`, so clicking a button does not leave a tooltip
 * hanging over the thing you just clicked.
 *
 * KEYBOARD
 *   Tab to the anchor   opens (focus-visible only — a mouse click does not)
 *   Escape              closes immediately, while the anchor keeps focus
 *   any activation      closes (you have acted; the hint has done its job)
 * There is nothing to tab INTO: the tooltip holds no focusable content by contract.
 *
 * WHY THE TOOLTIP ITSELF IS HOVERABLE — it takes pointer events and stays open while the pointer is
 * over it. WCAG 1.4.13 requires hover content to be dismissible, hoverable and persistent; the
 * usual `pointer-events: none` shortcut fails "hoverable" outright, and it is the same house rule
 * that bans `pointer-events: none` on disabled controls (CONVENTIONS §5). Non-interactive is a
 * statement about the CONTENT, not about whether the pointer may rest on it.
 *
 * ESCAPE DOES NOT STOP PROPAGATION, deliberately. If a tooltip is open over a control inside a
 * dialog, swallowing Escape leaves the user pressing the close key at a dialog that will not close
 * and no longer showing anything that explains why. The tooltip closes and the event continues.
 *
 * WHEN NOT TO USE IT
 * - Information that exists nowhere else. A tooltip is unreachable on touch and easy to miss;
 *   anything required to complete a task belongs in the layout, not behind a hover.
 * - Anything with a link, a button, a form field, or text worth selecting. That is a `Popover`.
 * - Naming an icon-only control. That is `aria-label` on the control. A tooltip DESCRIBES; it does
 *   not name, and `aria-describedby` is announced after — and sometimes instead of — the name.
 * - Error or validation text. That belongs inline, permanently, next to the field.
 * - A control disabled with the native `disabled` attribute: browsers suppress its pointer and
 *   focus events, so neither trigger fires. Use `aria-disabled` when a tooltip owes an explanation
 *   — the same split `Button` documents.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 220,
  disabled = false,
  className,
  style,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  // An empty `content` must not produce an `aria-describedby` pointing at an element that will
  // never exist — a dangling reference is worse than no description, because it is silent.
  const inert = disabled || content === null || content === undefined || content === '';

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const openAfterDelay = useCallback(() => {
    cancelTimer();
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }, [cancelTimer, delay]);

  const openNow = useCallback(() => {
    cancelTimer();
    setOpen(true);
  }, [cancelTimer]);

  const close = useCallback(() => {
    cancelTimer();
    setOpen(false);
  }, [cancelTimer]);

  // A pending timer outliving the component would fire setState on an unmounted tree — the classic
  // way a table that re-renders on every poll accumulates warnings.
  useEffect(() => cancelTimer, [cancelTimer]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const { style: layerStyle, side } = useAnchoredLayer({
    anchorRef,
    layerRef,
    open,
    placement,
  });

  if (inert) return children;

  const anchorProps: AnchorInjectedProps = {
    ref: mergeRefs<HTMLElement>(anchorRef, refOfElement(children)),
    // Only while open. `aria-describedby` is a live pointer; when the tooltip is unmounted there is
    // nothing at that id, and a stale reference makes some screen readers announce nothing at all.
    'aria-describedby': open ? id : undefined,
    onMouseEnter: chain(children.props.onMouseEnter, openAfterDelay),
    onMouseLeave: chain(children.props.onMouseLeave, close),
    onFocus: chain(children.props.onFocus, (event: FocusEvent<HTMLElement>) => {
      // Keyboard focus only. A click focuses the button too, and a tooltip that pops up over the
      // control you just pressed hides the result of pressing it. `:focus-visible` is exactly the
      // "the browser thinks this user is navigating by keyboard" signal, so ask the browser rather
      // than tracking key/pointer state by hand. Wrapped because jsdom and older engines throw on
      // an unsupported selector, and a tooltip must not take the app down with it.
      let keyboard = true;
      try {
        keyboard = event.currentTarget.matches(':focus-visible');
      } catch {
        keyboard = true;
      }
      if (keyboard) openNow();
    }),
    onBlur: chain(children.props.onBlur, close),
    // Acting on the control dismisses the hint: the user has committed, and the tooltip is now
    // covering whatever changed as a result.
    onClick: chain(children.props.onClick, close),
  };

  return (
    <>
      {cloneElement(children as ReactElement<AnchorInjectedProps>, anchorProps)}
      {open
        ? createPortal(
            <div
              ref={layerRef}
              id={id}
              role="tooltip"
              className={[styles.layer, className].filter(Boolean).join(' ')}
              data-side={side}
              style={{ ...layerStyle, ...style }}
              // Keeps the tooltip open while the pointer rests on it — the "hoverable" half of
              // WCAG 1.4.13. Re-opening on enter matters because the pointer crosses the gap
              // between anchor and tooltip, which already fired the anchor's mouseleave.
              onMouseEnter={openNow}
              onMouseLeave={close}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
