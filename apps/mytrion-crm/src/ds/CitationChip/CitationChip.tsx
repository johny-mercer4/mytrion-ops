import { useId, useRef, useState, forwardRef, type ButtonHTMLAttributes } from 'react';
import styles from './CitationChip.module.css';

/** Everything a chip can say about the source it points at. */
export interface CitationChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  /** The inline marker — `1`, `2`, `a`. Rendered between brackets by the stylesheet, not by you. */
  marker: string | number;
  /**
   * Title of the cited source. Shown in the preview and folded into the accessible name.
   * Omit only when the source genuinely has no title; the chip then previews the URL alone.
   */
  sourceTitle?: string;
  /** Absolute URL of the source. Its host is shown under the title as a provenance hint. */
  sourceUrl?: string;
  /**
   * The model cited a source that does not exist in the turn's source set. This is a TRUST BUG,
   * not a cosmetic one: rendering it as a normal chip tells the reader the claim is backed when it
   * is not. An invalid chip is dashed, struck through, says so in its preview, and refuses to fire
   * `onClick`.
   */
  invalid?: boolean;
  /** The matching row in the `SourceList` is currently revealed. Keeps chip and list in sync. */
  active?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    // A malformed URL is the model's problem, not the reader's — show the raw string rather than
    // dropping provenance on the floor.
    return url;
  }
}

/**
 * An inline citation marker — `[1]` — as a real `<button>` that reveals the source it points at.
 *
 * It is a button because it DOES something: the caller scrolls to, expands, or highlights the
 * matching `SourceList` row. Superscript text with a click handler on a `<span>` would be
 * unreachable by keyboard, which is how citations quietly become decoration.
 *
 * THE PREVIEW IS NOT A MOUSE FEATURE. Hover and `focus` both reveal it, and it is wired as the
 * button's `aria-describedby` target, so a screen-reader user hears the source title on focus
 * without the popover ever being painted. It is never `display: none` — a hidden-from-the-tree
 * description is a description that does not exist.
 *
 * STATES — rest · hover · active(pressed) · focus-visible · `data-active` (its list row is open) ·
 * `data-invalid`. `invalid` recolours AND dashes AND strikes the marker: three signals, so it
 * survives greyscale, low vision, and a screen reader.
 *
 * KEYBOARD
 *   Tab            — focus the chip; the preview reveals on focus
 *   Enter / Space  — activate (`onClick`); suppressed while `invalid`
 *   Escape         — dismiss the preview without moving focus
 *
 * NO LIVE REGION. Citations land mid-stream, and a chip that announced itself would fire once per
 * marker inside an already-streaming turn. The streaming surface owns the single polite region and
 * announces transitions ("Answering", "Done") — see the chat panel's `liveStatus`.
 *
 * WHEN NOT TO USE IT
 * - As a footnote INDEX at the bottom of an answer. That is `SourceList`, which is scannable and
 *   expandable; a row of bare chips is not.
 * - As a generic badge or count. It carries citation semantics and `--cite-*` colour; a count is
 *   a neutral badge.
 * - As a plain external link in prose. If the only behaviour is "open this URL", render an `<a>` —
 *   a button breaks middle-click, cmd-click and "copy link address".
 * - For a source the caller cannot reveal. A chip that goes nowhere on click is a dead control;
 *   render the marker as text.
 */
export const CitationChip = forwardRef<HTMLButtonElement, CitationChipProps>(function CitationChip(
  {
    marker,
    sourceTitle,
    sourceUrl,
    invalid = false,
    active = false,
    className,
    onClick,
    onFocus,
    onBlur,
    onPointerEnter,
    onPointerLeave,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const previewId = useId();
  const [revealed, setRevealed] = useState(false);
  // Focus and hover are independent reveal sources; tracked separately so blurring while the
  // pointer is still over the chip does not yank the preview out from under the cursor.
  const focused = useRef(false);
  const hovered = useRef(false);

  const sync = () => setRevealed(focused.current || hovered.current);

  const host = sourceUrl ? hostOf(sourceUrl) : '';
  const titleText = invalid ? 'Source not found' : (sourceTitle ?? host) || 'Untitled source';

  return (
    <span
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-invalid={invalid || undefined}
      data-active={(active && !invalid) || undefined}
      data-revealed={revealed || undefined}
    >
      <button
        ref={ref}
        type="button"
        className={styles.chip}
        // The description is ALWAYS in the accessibility tree — the popover is only its visual
        // form. This is the line that makes a keyboard user's experience equal to a mouse user's.
        aria-describedby={previewId}
        aria-label={
          invalid
            ? `Citation ${marker}: source not found`
            : `Source ${marker}: ${titleText}`
        }
        // aria-disabled, not disabled: the chip must stay focusable so the reader can reach the
        // explanation of WHY it is broken. `disabled` would delete that explanation from the page.
        aria-disabled={invalid || undefined}
        aria-invalid={invalid || undefined}
        onClick={(e) => {
          if (invalid) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        onFocus={(e) => {
          focused.current = true;
          sync();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          focused.current = false;
          sync();
          onBlur?.(e);
        }}
        onPointerEnter={(e) => {
          hovered.current = true;
          sync();
          onPointerEnter?.(e);
        }}
        onPointerLeave={(e) => {
          hovered.current = false;
          sync();
          onPointerLeave?.(e);
        }}
        onKeyDown={(e) => {
          // Escape dismisses without moving focus — the tooltip pattern's one required key.
          if (e.key === 'Escape' && revealed) {
            focused.current = false;
            hovered.current = false;
            setRevealed(false);
          }
          onKeyDown?.(e);
        }}
        {...rest}
      >
        <span className={styles.marker}>{marker}</span>
      </button>

      <span className={styles.preview} id={previewId} role="tooltip">
        <span className={styles.previewTitle}>{titleText}</span>
        {!invalid && host ? <span className={styles.previewMeta}>{host}</span> : null}
        {invalid ? (
          <span className={styles.previewMeta}>Not in this answer&rsquo;s sources</span>
        ) : null}
      </span>
    </span>
  );
});
