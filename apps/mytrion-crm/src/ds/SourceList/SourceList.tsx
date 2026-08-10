import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../Icon/Icon';
import { Button } from '../Button/Button';
import styles from './SourceList.module.css';

/** One knowledge source backing an answer. Mirrors the shape the stream already emits. */
export interface SourceItem {
  /** Stable id — the handle the caller uses to tie a `CitationChip` to this row. */
  id: string;
  title: string;
  /** The inline marker this source is cited as (`1`, `2`, `a`). Omit for an uncited source. */
  marker?: string | number;
  /** Absolute URL. Its host is shown as provenance; the row becomes a link when there is no `onSelect`. */
  url?: string;
  /** One line of context — a section heading, a table name, a document date. */
  detail?: string;
}

export interface SourceListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  sources: SourceItem[];
  /** Controlled disclosure. Pass it when a `CitationChip` click must open the list. */
  open?: boolean;
  /** Uncontrolled starting state. Collapsed is the default — sources are evidence, not content. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The row a citation currently points at. Highlighted, and marked `aria-current`. */
  activeId?: string | null;
  /** Makes each row a button. Use it to scroll the document to the source, open a drawer, etc. */
  onSelect?: (id: string) => void;
  /** Overrides the "3 sources" summary. Keep the count in it. */
  label?: ReactNode;
}

/**
 * The expandable evidence list under an answer: "3 sources" until asked, then titles, markers and
 * hosts.
 *
 * COLLAPSED BY DEFAULT, and that is a product decision rather than a space-saving one. In a dense
 * ops tool the answer is the content and the sources are the audit trail; expanding them by default
 * doubles the height of every grounded turn in a transcript and trains people to scroll past them.
 *
 * The marker on each row is rendered in `--cite-marker-*`, the same treatment `CitationChip` gives
 * the inline `[1]`, so the eye connects the two without a legend.
 *
 * ROW BEHAVIOUR — exactly one interactive element per row, never nested:
 *   `onSelect` given            → the row is a `<button>` (reveal/scroll-to), URL shown as text
 *   no `onSelect`, `url` given  → the row is an `<a>` opening in a new tab
 *   neither                     → the row is static text
 *
 * KEYBOARD
 *   Tab                — summary toggle, then each interactive row in order
 *   Enter / Space      — toggle the disclosure; activate a row
 *   Enter (on a link)  — follow the source
 *
 * NO LIVE REGION. Sources arrive mid-stream; announcing them here would be a second polite region
 * competing with the streaming surface's own. The surface announces "Ran 3 tools" / "Done"; this
 * component stays silent by design.
 *
 * WHEN NOT TO USE IT
 * - With zero sources. It renders `null` — say "not grounded" with `Provenance` instead, which is
 *   a claim about the answer rather than an empty container.
 * - As a file list, a search-results list, or any list the user picks FROM to act. This is
 *   provenance for one answer; a working list is a table.
 * - As the only citation affordance in a long answer. Inline `CitationChip`s are what attach a
 *   source to a specific sentence; this list alone attaches it to the whole turn.
 */
export function SourceList({
  sources,
  open,
  defaultOpen = false,
  onOpenChange,
  activeId = null,
  onSelect,
  label,
  className,
  ...rest
}: SourceListProps) {
  const listId = useId();
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  const isOpen = open ?? selfOpen;

  // An empty list is not a collapsed list. Rendering "0 sources" invites a click that reveals
  // nothing, which is worse than saying nothing at all.
  if (sources.length === 0) return null;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setSelfOpen(next);
    onOpenChange?.(next);
  };

  const summary = label ?? `${sources.length} source${sources.length === 1 ? '' : 's'}`;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} {...rest}>
      <Button
        variant="ghost"
        size="sm"
        className={styles.toggle}
        icon="description"
        // No rotation on the chevron: a persistent `rotate` promotes the glyph to its own
        // composited layer inside a glass surface. Swapping right→down is the same disclosure
        // language and costs nothing.
        iconEnd={isOpen ? 'expand_more' : 'chevron_right'}
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={toggle}
      >
        {summary}
      </Button>

      {isOpen ? (
        <ul className={styles.list} id={listId}>
          {sources.map((s) => {
            const host = s.url ? hostOf(s.url) : '';
            const isActive = activeId != null && s.id === activeId;
            const body = (
              <>
                {s.marker != null ? (
                  <span className={styles.marker}>{s.marker}</span>
                ) : (
                  <Icon name="description" size="sm" className={styles.icon} />
                )}
                <span className={styles.text}>
                  <span className={styles.title}>{s.title}</span>
                  {s.detail ? <span className={styles.meta}>{s.detail}</span> : null}
                  {host ? <span className={styles.meta}>{host}</span> : null}
                </span>
              </>
            );

            return (
              <li key={s.id} className={styles.item} data-active={isActive || undefined}>
                {onSelect ? (
                  <button
                    type="button"
                    className={styles.row}
                    // aria-current, not just colour: "the citation you clicked points here".
                    aria-current={isActive || undefined}
                    onClick={() => onSelect(s.id)}
                  >
                    {body}
                  </button>
                ) : s.url ? (
                  <a
                    className={styles.row}
                    href={s.url}
                    target="_blank"
                    // noreferrer implies noopener; both, because target=_blank without them hands
                    // the opened page a handle on this one.
                    rel="noreferrer noopener"
                    aria-current={isActive || undefined}
                  >
                    {body}
                    <Icon name="open_in_new" size="sm" className={styles.external} />
                  </a>
                ) : (
                  <span className={styles.row} data-static="true">
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
