import { forwardRef, useId, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import styles from './InlineDiff.module.css';

export type DiffLineKind = 'add' | 'del' | 'changed' | 'context';

export interface DiffLine {
  /**
   * `add` — present only in the proposal. `del` — present only in the current record.
   * `changed` — the same line, different content (use it when you have already paired the two
   *   sides and rendering `del`+`add` back to back would be misleading).
   * `context` — unchanged, shown for orientation. Carries no marker and no tint.
   */
  kind: DiffLineKind;
  /** The line, verbatim. Rendered as-is with `white-space: pre` — leading indentation survives. */
  text: string;
  /** Line number in the BEFORE document. There is none on an `add` line, so omit it. */
  before?: number;
  /** Line number in the AFTER document. There is none on a `del` line, so omit it. */
  after?: number;
}

export interface InlineDiffProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The lines, already paired and ordered by the caller. This component does not compute a diff. */
  lines: readonly DiffLine[];
  /**
   * What is being changed — a file path, a record id, a field name. Shown in the header and used as
   * the accessible name of the diff, so "the diff" is never anonymous in a screen reader's list.
   */
  label?: ReactNode;
  /** Show BEFORE/AFTER line-number columns. Off by default: a five-line field diff has no lines. */
  lineNumbers?: boolean;
  /**
   * Soft-wrap long lines instead of scrolling horizontally. Off by default — for code and JSON,
   * horizontal scroll keeps indentation readable; for prose, wrapping does.
   */
  wrap?: boolean;
  /**
   * Render at most this many lines, with a disclosure for the rest. Omit to always render all of
   * them. A 400-line diff inline in a transcript buries the message that follows it.
   */
  maxLines?: number;
  /** Replaces the derived "3 added, 1 removed" line. Pass one when the counts need context. */
  summary?: ReactNode;
}

/** The non-colour channel. This is the part that must survive a greyscale print. */
const MARKER: Record<DiffLineKind, string> = {
  add: '+',
  del: '-',
  changed: '~',
  context: ' ',
};

/** What a screen reader hears in the gutter column. `context` says nothing — silence is the signal. */
const SPOKEN: Record<DiffLineKind, string> = {
  add: 'Added.',
  del: 'Removed.',
  changed: 'Changed.',
  context: '',
};

/**
 * A unified, line-level diff of a proposed change.
 *
 * The surface an agent uses to show its work before a human approves it: what the record says now,
 * what it would say after. It renders what it is given — pairing and ordering are the caller's job,
 * because the meaningful pairing of a CRM field update is not the same algorithm as the meaningful
 * pairing of a file edit.
 *
 * NEVER MEANING BY COLOUR ALONE — the rule this component exists to enforce, and the one that diffs
 * across the industry get wrong. Red and green are, for a red/green-deficient reader, the same muddy
 * tint. Three channels carry each line, in this order:
 *   1. the GUTTER MARKER (`+` / `-` / `~`), which is why `--diff-gutter-fg` is in the token layer at
 *      all. It is real text in the mono column, it survives greyscale, and it is never optional;
 *   2. the SPOKEN KIND — "Added." / "Removed." / "Changed." — visually hidden, read before the line
 *      itself, so a screen-reader user hears the operation and then the content;
 *   3. the TINT, which is the fastest channel for everyone else and the only one that can be lost.
 *
 * UNIFIED ONLY. Side-by-side is deliberately out of scope: this renders inside a chat transcript, an
 * approval card and a detail drawer — surfaces 380–560px wide. Two 40-character columns at that
 * width wrap every line, and a wrapped side-by-side diff is harder to read than no diff. If a
 * full-page three-pane merge tool is ever needed, that is a different component with a different
 * layout contract, not a `variant` on this one.
 *
 * LINE LEVEL, NOT CHARACTER LEVEL. Intra-line highlighting needs a token pair this system does not
 * have, and at 12px mono a two-character sub-span highlight reads as a rendering artefact.
 *
 * KEYBOARD
 * - When the diff scrolls horizontally (`wrap` off) its viewport is a focusable `group`: Tab reaches
 *   it, then the arrow keys scroll it. A scrollable region no keyboard user can reach is a WCAG
 *   2.1.1 failure, and it is the single most common defect in embedded code viewers.
 * - With `wrap` on there is nothing to scroll, so the region is NOT a tab stop — an empty stop in a
 *   transcript of thirty messages is thirty pointless tab presses.
 * - `maxLines` adds one `Show all N lines` button carrying `aria-expanded`.
 * - No motion anywhere in this component. Nothing here changes by moving.
 *
 * WHEN NOT TO USE IT
 * - A single scalar field going from one value to another. `Stage: Negotiation → Closed Won` on one
 *   line is clearer than a two-row diff; a diff frames it as a document edit, which it is not.
 * - Showing a record that has ALREADY changed. This is a proposal viewer — past tense belongs in an
 *   audit/history component, where the actor and timestamp matter more than the gutter.
 * - Binary or very wide payloads (an image, a 200-column CSV). A diff of something nobody can read
 *   is a wall that looks like information.
 * - As the only thing in an approval. Pair it with `ApprovalBar`, whose summary states the
 *   consequence in words — a diff shows WHAT changes, never what happens when it does.
 */
export const InlineDiff = forwardRef<HTMLDivElement, InlineDiffProps>(function InlineDiff(
  {
    lines,
    label,
    lineNumbers = false,
    wrap = false,
    maxLines,
    summary,
    className,
    ...rest
  },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const baseId = useId();
  const viewportId = `${baseId}-view`;

  const counts = useMemo(() => {
    let add = 0;
    let del = 0;
    let changed = 0;
    for (const line of lines) {
      if (line.kind === 'add') add += 1;
      else if (line.kind === 'del') del += 1;
      else if (line.kind === 'changed') changed += 1;
    }
    return { add, del, changed };
  }, [lines]);

  const countText = useMemo(() => {
    const parts: string[] = [];
    if (counts.add) parts.push(`${counts.add} added`);
    if (counts.del) parts.push(`${counts.del} removed`);
    if (counts.changed) parts.push(`${counts.changed} changed`);
    return parts.length ? parts.join(', ') : 'No changes';
  }, [counts]);

  const hidden = maxLines != null && lines.length > maxLines ? lines.length - maxLines : 0;
  const shown = hidden && !expanded ? lines.slice(0, maxLines) : lines;

  // The accessible name of the table AND of the scroll region. A diff with no name is "table" in a
  // screen reader's element list, which is indistinguishable from every other table on the page.
  const name = typeof label === 'string' ? `Changes to ${label}` : 'Proposed changes';

  return (
    <div
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-wrap={wrap || undefined}
      {...rest}
    >
      <div className={styles.header}>
        {label != null ? (
          <span className={styles.label}>{label}</span>
        ) : null}
        {/* The counts are text, not a colour key: "2 added, 1 removed" is the same sentence in
            greyscale, and it is the only summary a caller reading the DOM ever needs. */}
        <span className={styles.counts}>{summary ?? countText}</span>
      </div>

      <div
        id={viewportId}
        className={styles.viewport}
        // Focusable ONLY when it can actually scroll — see the keyboard note in the docblock.
        {...(wrap ? {} : ({ tabIndex: 0, role: 'group', 'aria-label': name } as const))}
      >
        <table className={styles.table}>
          <caption className={styles.srOnly}>{`${name}. ${countText}.`}</caption>
          <tbody>
            {shown.map((line, i) => (
              <tr
                // Diff lines have no stable identity — two identical blank context lines are not
                // distinguishable — and the list is replaced wholesale, never reordered in place.
                key={i}
                className={styles.row}
                data-kind={line.kind}
              >
                {lineNumbers ? (
                  <>
                    <td className={styles.num}>{line.before ?? ''}</td>
                    <td className={styles.num}>{line.after ?? ''}</td>
                  </>
                ) : null}
                <td className={styles.gutter}>
                  <span aria-hidden="true">{MARKER[line.kind]}</span>
                  <span className={styles.srOnly}>{SPOKEN[line.kind]}</span>
                </td>
                {/* A truly empty line still needs a line box, or the row collapses to its padding
                    and the diff develops gaps where the blank lines are. */}
                <td className={styles.text}>{line.text === '' ? ' ' : line.text}</td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr className={styles.row} data-kind="context">
                <td className={styles.empty} colSpan={lineNumbers ? 4 : 2}>
                  No changes
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {hidden ? (
        <Button
          variant="ghost"
          size="sm"
          // The subset has no `expand_less`, and a rotated chevron would mean emitting a permanent
          // transform. Dropping the icon when expanded is honest and costs nothing: the LABEL is
          // what changed, and the label is the channel that works for everyone.
          icon={expanded ? undefined : 'expand_more'}
          aria-expanded={expanded}
          aria-controls={viewportId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer lines' : `Show all ${lines.length} lines`}
        </Button>
      ) : null}
    </div>
  );
});
