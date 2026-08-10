import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Icon } from '../Icon/Icon';
import styles from './StructuredOutput.module.css';

/** A column of a rendered table. `numeric` is what buys tabular alignment, not a guess from the data. */
export interface StructuredTableColumn {
  /** Key into each row object. */
  key: string;
  /** Header label. */
  label: string;
  /**
   * Right-aligns the column, switches it to the numeric face and turns on `tabular-nums`, so digits
   * line up vertically down the column. A money or count column that does not align cannot be
   * scanned, only read.
   */
  numeric?: boolean;
}

/** A fenced code block. Gets the copy control; `pre` does not. */
export interface StructuredCodeBlock {
  kind: 'code';
  /** The exact text. Copied verbatim — no re-indentation, no trailing-newline trimming. */
  code: string;
  /** Shown in the block header, e.g. `sql`. Not a highlighter directive; this component does not highlight. */
  language?: string;
  /** Shown instead of the language when the output names a file or a query. */
  filename?: string;
}

/** Preformatted output that is NOT source: tool stdout, a stack trace, a raw payload dump. */
export interface StructuredPreBlock {
  kind: 'pre';
  text: string;
  /** Names the region for screen readers and labels the block, e.g. "stderr". */
  label?: string;
}

export interface StructuredTableBlock {
  kind: 'table';
  columns: StructuredTableColumn[];
  /** One object per row, keyed by `column.key`. Values may be nodes — a cell can hold a Badge. */
  rows: Array<Record<string, ReactNode>>;
  /** Rendered as a real `<caption>`; also the scroll region's accessible name. */
  caption?: string;
}

export interface StructuredQuoteBlock {
  kind: 'quote';
  text: ReactNode;
  /** Who or what is being quoted — a policy name, a document title. */
  attribution?: string;
}

export interface StructuredListBlock {
  kind: 'list';
  items: ReactNode[];
  /** Ordered when the sequence carries meaning (steps). Unordered otherwise. */
  ordered?: boolean;
}

export type StructuredBlock =
  | StructuredCodeBlock
  | StructuredPreBlock
  | StructuredTableBlock
  | StructuredQuoteBlock
  | StructuredListBlock;

export interface StructuredOutputProps {
  /** The blocks, in order. An empty array renders nothing at all — not an empty frame. */
  blocks: StructuredBlock[];
  /**
   * Height of the collapsed state, in lines of body text. The expand control appears only when the
   * content actually exceeds it. Pass `0` to disable clamping — do that only when the output is
   * already bounded by construction.
   */
  maxLines?: number;
  /** Label on the expand control. Defaults to "Show more" / "Show less". */
  expandLabel?: string;
  collapseLabel?: string;
  /**
   * Overrides the clipboard write. Return a promise; a rejection is announced as "Copy failed".
   * Default is `navigator.clipboard.writeText`, which needs a secure context — pass this when the
   * host cannot guarantee one.
   */
  onCopy?: (text: string) => void | Promise<void>;
  className?: string;
  style?: CSSProperties;
}

/** How long "Copied" stays up. Long enough to read, short enough not to linger past the next action. */
const COPIED_MS = 1600;

/**
 * Structured model output — the part of an answer that is not prose.
 *
 * An agent's turn is rarely a paragraph. It is a query it ran, a table of rows it got back, a policy
 * it quoted, a list of steps it proposes. Those are DATA, and rendering them as data is what makes
 * the answer checkable. This component is the renderer for that layer: code, preformatted output,
 * tables, blockquotes and lists, from a typed array — no markdown parsing, so a stray backtick in a
 * carrier name cannot restructure the page.
 *
 * TABLES USE THE APP'S OWN TABLE LANGUAGE. Flat and opaque, uppercase muted header with no tinted
 * band, 1px rules, hover wash, numeric columns right-aligned in the numeric face with `tabular-nums`
 * — the same four rules as `ds/Table`. This is not decoration: output that looks
 * different from the tables the user trusts elsewhere reads as untrustworthy, and a model's table is
 * the last place you want to spend credibility.
 *
 * CLAMPING. Output is bounded by default (`maxLines`, 24). The control appears only when content
 * genuinely overflows, measured — a "Show more" on output that is already complete teaches people to
 * ignore it. The fade is a hint; the button is the signal, because a reduced-motion or high-contrast
 * user may never see the fade.
 *
 * ANNOUNCEMENTS. ONE polite live region for the whole surface, and it fires on TRANSITIONS only —
 * "Copied", "Showing full output". Nothing here announces content: a live region that narrates
 * output as it arrives is a screen reader reading gibberish, which is worse than silence.
 *
 * KEYBOARD
 * - Copy / expand: native `<button>` — Tab to reach, Enter or Space to activate.
 * - Any block that scrolls sideways (code, pre, a wide table) is a focusable `region` with a name,
 *   so a keyboard user can reach the scrollbar with arrow keys. A scroll container that only a mouse
 *   can move hides its own content.
 * - The component traps nothing and takes no focus on mount.
 *
 * WHEN NOT TO USE IT
 * - Prose. Sentences with inline emphasis and links are markdown; render them with the answer body.
 *   This is for the blocks BETWEEN the sentences.
 * - A real data grid. No sorting, no column resize, no virtualisation, no selection. Past a few dozen
 *   rows, the honest answer is a link into the workspace that owns that data.
 * - A diff, or anything awaiting approval. Those carry `--diff-*` / `--approve-*` semantics and an
 *   action the user must take; a read-only renderer would hide the decision.
 * - An editor. Nothing here is editable, and styling a `<textarea>` to look like this block would be
 *   a lie about whether the text can be changed.
 */
export function StructuredOutput({
  blocks,
  maxLines = 24,
  expandLabel = 'Show more',
  collapseLabel = 'Show less',
  onCopy,
  className,
  style,
}: StructuredOutputProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // The single live-region message, plus a parity counter. Setting the region to the SAME string
  // twice announces nothing (the node did not change), so a second copy of the same block would be
  // silent; the zero-width space flips each time and makes the text genuinely new.
  const [announce, setAnnounce] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const say = useCallback((text: string) => setAnnounce((prev) => ({ text, n: prev.n + 1 })), []);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const clampable = maxLines > 0;

  // Measure rather than guess. Skipped while expanded, so `overflowing` holds the value that made us
  // expand and the control can still say "Show less".
  useLayoutEffect(() => {
    if (!clampable || expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [blocks, clampable, expanded]);

  const clamped = clampable && !expanded && overflowing;
  const showToggle = clampable && (overflowing || expanded);

  const handleCopy = async (text: string, index: number, what: string) => {
    try {
      if (onCopy) await onCopy(text);
      else await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      say(`Copied ${what}`);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedIndex(null), COPIED_MS);
    } catch {
      // Say it out loud. A copy button that silently does nothing is the most common broken control
      // in this class of UI.
      setCopiedIndex(null);
      say('Copy failed');
    }
  };

  if (blocks.length === 0) return null;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} style={style}>
      <div
        ref={bodyRef}
        className={styles.body}
        data-collapsed={clampable && !expanded ? 'true' : undefined}
        data-faded={clamped || undefined}
        // Collapsing is a VISUAL crop, not a truncation: the remainder stays in the DOM and in the
        // accessibility tree, so a screen-reader user is never gated behind a control whose only
        // purpose is to undo a layout decision made for sighted readers.
        style={{ '--so-lines': String(maxLines) } as CSSProperties}
      >
        {blocks.map((block, i) => (
          <Block
            key={i}
            block={block}
            copied={copiedIndex === i}
            onCopy={(text, what) => void handleCopy(text, i, what)}
          />
        ))}
      </div>

      {showToggle ? (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            say(next ? 'Showing full output' : 'Output collapsed');
          }}
        >
          <Icon name={expanded ? 'close_fullscreen' : 'open_in_full'} size="sm" />
          {expanded ? collapseLabel : expandLabel}
        </button>
      ) : null}

      {/* THE one live region for this surface. Transitions only — never content, never per token. */}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announce.text ? `${announce.text}${announce.n % 2 ? '\u200B' : ''}` : ''}
      </p>
    </div>
  );
}

function Block({
  block,
  copied,
  onCopy,
}: {
  block: StructuredBlock;
  copied: boolean;
  onCopy: (text: string, what: string) => void;
}) {
  if (block.kind === 'code') {
    const name = block.filename ?? block.language ?? 'code';
    return (
      <figure className={styles.block} data-kind="code">
        <div className={styles.blockHead}>
          <span className={styles.blockLabel}>{name}</span>
          <button
            type="button"
            className={styles.copy}
            data-copied={copied || undefined}
            onClick={() => onCopy(block.code, name)}
          >
            {/* Icon AND word: the state change must not be carried by colour or glyph alone. */}
            <Icon name={copied ? 'check' : 'content_copy'} size="sm" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className={styles.pre} tabIndex={0} role="region" aria-label={`${name} code`}>
          <code className={styles.code}>{block.code}</code>
        </pre>
      </figure>
    );
  }

  if (block.kind === 'pre') {
    const name = block.label ?? 'Output';
    return (
      <figure className={styles.block} data-kind="pre">
        {block.label ? (
          <div className={styles.blockHead}>
            <span className={styles.blockLabel}>{block.label}</span>
          </div>
        ) : null}
        <pre className={styles.pre} data-plain="true" tabIndex={0} role="region" aria-label={name}>
          {block.text}
        </pre>
      </figure>
    );
  }

  if (block.kind === 'table') {
    return (
      <div
        className={styles.scroller}
        tabIndex={0}
        role="region"
        aria-label={block.caption ?? 'Table'}
      >
        <table className={styles.table}>
          {block.caption ? <caption className={styles.caption}>{block.caption}</caption> : null}
          <thead>
            <tr>
              {block.columns.map((col) => (
                <th key={col.key} scope="col" data-num={col.numeric || undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {block.columns.map((col) => (
                  <td key={col.key} data-num={col.numeric || undefined}>
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.kind === 'quote') {
    return (
      <figure className={styles.block} data-kind="quote">
        <blockquote className={styles.quote}>{block.text}</blockquote>
        {block.attribution ? (
          <figcaption className={styles.attribution}>{block.attribution}</figcaption>
        ) : null}
      </figure>
    );
  }

  const List = block.ordered ? 'ol' : 'ul';
  return (
    <List className={styles.list} data-ordered={block.ordered || undefined}>
      {block.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </List>
  );
}
