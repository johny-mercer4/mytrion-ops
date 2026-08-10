import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import styles from './StopButton.module.css';

export type StopButtonSize = 'sm' | 'md';

export interface StopButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> {
  /** Interrupt the run. Not called while `stopping` — the abort is already in flight. */
  onStop(event: MouseEvent<HTMLButtonElement>): void;
  /** `md` (32px) matches Button. `sm` (26px) is for a dense composer or an inline turn header. */
  size?: StopButtonSize;
  /**
   * The abort has been requested and the stream has not closed yet. The control stays FOCUSED and
   * visible — it does not disappear, disable-and-blur, or resize.
   */
  stopping?: boolean;
  /**
   * Visible label. Omit for the icon-only square, which is the composer's shape. The accessible
   * name is always present either way (see `stopLabel` / `stoppingLabel`).
   */
  children?: ReactNode;
  /** Accessible name at rest. Default "Stop generating". */
  stopLabel?: string;
  /** Accessible name while stopping. Default "Stopping". */
  stoppingLabel?: string;
  /** Visible label while stopping, when `children` is given. Default "Stopping". */
  stoppingChildren?: ReactNode;
}

/**
 * The interrupt control for a running generation.
 *
 * It is the one control a user reaches for when an agent is doing the wrong thing, so everything
 * here is in service of it being HITTABLE: a filled danger box, a square stop mark, no hover lift,
 * and a box whose size never changes between `rest` and `stopping`.
 *
 * RENDER IT IN A FIXED SLOT. This component keeps its OWN width stable; it cannot keep its POSITION
 * stable, because that is the caller's layout. Put it in a slot that does not participate in the
 * growing transcript — the composer's action corner, or a pinned turn header — and let the streaming
 * text reflow underneath it. A stop button laid out after the answer text walks down the screen as
 * tokens arrive, and the user chases it with the cursor. That is the defect this component exists to
 * avoid, and it is one the caller can still reintroduce.
 *
 * STOPPING is `aria-disabled`, not `disabled`. Native `disabled` on the element the user just
 * activated drops focus to `<body>` — a keyboard user pressing Stop would lose their place in the
 * chat at the exact moment they asked for control. `aria-disabled` keeps it focusable and the label
 * change explains why it no longer fires, which is the case CONVENTIONS §5 reserves it for.
 *
 * KEYBOARD — native `<button>`: Tab reaches it, Enter and Space activate it. It deliberately binds
 * NO global shortcut. The surface owns that: this app's composer already stops on Escape while the
 * textarea has focus, and a document-level listener in here would fire that handler twice.
 *
 * ANNOUNCEMENT — this button announces nothing on its own beyond its label changing. The streaming
 * surface's single polite live region announces the transition ("Generation stopped"), and the
 * StoppedNote that follows is not a live region either. One announcement, one place.
 *
 * WHEN NOT TO USE IT
 * - Cancelling a form, a dialog, or a wizard step. That is a secondary Button labelled Cancel; this
 *   is red because it kills work that is currently running.
 * - Pausing. Nothing here resumes — stopping keeps the partial answer and ends the turn. If the
 *   surface can genuinely resume, it needs a different control and a different word.
 * - Deleting the turn, the conversation, or anything persisted. Stop interrupts; it does not undo.
 * - A run the user cannot actually interrupt. Rendering a Stop that the backend ignores is worse
 *   than rendering none — do not show it before the abort path is wired.
 */
export const StopButton = forwardRef<HTMLButtonElement, StopButtonProps>(function StopButton(
  {
    onStop,
    size = 'md',
    stopping = false,
    children,
    stopLabel = 'Stop generating',
    stoppingLabel = 'Stopping',
    stoppingChildren = 'Stopping',
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconOnly = children == null;

  return (
    <button
      ref={ref}
      // "button", never the HTML default "submit": the composer wraps this in a <form>, and a
      // submit-typed Stop would send the draft message it is sitting next to.
      type={type}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      data-stopping={stopping || undefined}
      // Focusable while stopping — see the docblock. The guard below is what actually blocks it.
      aria-disabled={stopping || undefined}
      aria-busy={stopping || undefined}
      aria-label={stopping ? stoppingLabel : stopLabel}
      onClick={(event) => {
        if (stopping) {
          // A second abort is a no-op at best and a double-dispatch at worst. Swallow it here so
          // every caller does not have to remember the guard.
          event.preventDefault();
          return;
        }
        onStop(event);
      }}
      {...rest}
    >
      {/* The square stop mark. Not an Icon: "stop" is a shape, not a pictogram, and the subsetted
          Material Symbols family does not carry it. Shape + colour + label, never colour alone. */}
      <span className={styles.glyph} aria-hidden="true" />
      {!iconOnly && (
        /* Both labels live in one grid cell, so the box is sized to the WIDER of them and does not
           twitch when "Stop" becomes "Stopping". Same rule as Button's loading state, applied to a
           label swap rather than a spinner overlay. */
        <span className={styles.labels} aria-hidden="true">
          <span className={styles.label} data-on={!stopping || undefined}>
            {children}
          </span>
          <span className={styles.label} data-on={stopping || undefined}>
            {stoppingChildren}
          </span>
        </span>
      )}
    </button>
  );
});
