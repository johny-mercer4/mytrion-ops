import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './ConfidenceMeter.module.css';

/**
 * `unknown` IS NOT `low`.
 *
 * Low confidence means the system produced a number and the number is bad. Unknown means no number
 * was produced at all — nothing scored the answer. Those are different facts, they lead to
 * different actions ("double-check this" vs "there is nothing to check against"), and merging them
 * is how an interface starts lying. They never share a colour and never share a word.
 */
export type ConfidenceLevel = 'high' | 'med' | 'low' | 'unknown';

export interface ConfidenceMeterProps extends HTMLAttributes<HTMLDivElement> {
  level: ConfidenceLevel;
  /** 0–100. Clamped. Ignored when `level` is `unknown` — an unscored answer has no number. */
  value?: number;
  /** Leading word. Pass `null` to drop it only when the surrounding row already says "confidence". */
  caption?: ReactNode;
  /** Hides the bar, leaving the words. The text is the primary channel; the bar is the glance. */
  bar?: boolean;
}

const WORD: Record<ConfidenceLevel, string> = {
  high: 'High',
  med: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

// Where the bar sits when no number was given: a BAND POSITION, not a score — which is why the
// unscored bar is drawn hollow (see the stylesheet) and no percentage appears beside it.
// `unknown` has no fill at all; a half-full bar there would be a fabricated measurement.
const IMPLIED: Record<ConfidenceLevel, number | null> = {
  high: 88,
  med: 58,
  low: 26,
  unknown: null,
};

/**
 * How much the system trusts its own answer: a word, a number, and a short bar.
 *
 * THE TEXT IS THE COMPONENT; the bar is an accelerator. A bar on its own encodes the whole meaning
 * in length and hue, which fails colour-blind readers, fails greyscale, and gives a screen reader
 * nothing at all to read. So the word ("High") and the number ("82%") are always real text in the
 * DOM, and the track is `aria-hidden` decoration over the top of them.
 *
 * FOUR LEVELS, and the fourth is the point — see `ConfidenceLevel`. `unknown` renders a hatched,
 * unfilled track and the word "Unknown" with no percentage: there is no measurement to draw, so
 * nothing is drawn. Every other meter in this class quietly renders unknown as a short red bar,
 * which tells the reader the system is unsure when the truth is that the system never looked.
 *
 * KEYBOARD — none. It is a readout, not a control. If a value needs explaining, put the meter in a
 * `Provenance` row where the grounding state supplies the context.
 *
 * NO LIVE REGION. Confidence resolves once, at the end of a turn; the streaming surface's single
 * polite region already announces that transition.
 *
 * WHEN NOT TO USE IT
 * - For progress. A confidence score is not a percentage complete — use a progress bar, which has
 *   entirely different semantics (it always reaches 100).
 * - For a probability the user should act on numerically (a forecast, a match score). Ship the
 *   number in a table; a 60px bar is not a place to read data from.
 * - As a quality badge on non-generated content. Confidence is a property of a model's output.
 * - Anywhere you would have to invent the value. If nothing scored the answer, that is `unknown` —
 *   which this component renders honestly. Do not pass `low` to mean "we did not check".
 */
export function ConfidenceMeter({
  level,
  value,
  caption = 'Confidence',
  bar = true,
  className,
  style,
  ...rest
}: ConfidenceMeterProps) {
  const scored = level !== 'unknown' && value != null && Number.isFinite(value);
  const pct = scored ? Math.round(Math.max(0, Math.min(100, value))) : null;
  const fill = pct ?? IMPLIED[level];

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-level={level}
      data-scored={scored || undefined}
      // The fill length is data, so it cannot live in the stylesheet. It travels as a custom
      // property rather than an inline `inline-size`, which keeps the sizing rule in CSS where the
      // rest of the geometry is. The cast is React's — CSSProperties has no index signature for
      // custom properties.
      style={{ ...style, ['--conf-value']: fill == null ? '0%' : `${fill}%` } as CSSProperties}
      {...rest}
    >
      {caption != null ? <span className={styles.caption}>{caption}</span> : null}

      {bar ? (
        // Decoration only: every value it encodes is spelled out in .value beside it, so hiding it
        // from assistive tech removes a redundant reading, not information.
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} />
        </span>
      ) : null}

      <span className={styles.value}>
        <span className={styles.word}>{WORD[level]}</span>
        {pct != null ? (
          <>
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
            <span className={styles.number}>{pct}%</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
