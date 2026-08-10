import { forwardRef, useId, type HTMLAttributes } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import styles from './Pagination.module.css';

export type PaginationSize = 'sm' | 'md';

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange'> {
  /** Current page, 1-BASED. One-based because it is a label the user reads, not an array index. */
  page: number;
  /** Total number of pages. Values below 1 are clamped to 1 — an empty result set is still page 1. */
  pageCount: number;
  onPageChange: (page: number) => void;
  /**
   * Rows per page. Required for the "showing X–Y of Z" line; without it the live region falls back
   * to "Page X of Y", because a range cannot be computed from a page number alone.
   */
  pageSize?: number;
  /** Renders the page-size select. Pass `onPageSizeChange` with it or the control does nothing. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  /** Total row count across all pages. Enables the range summary. */
  total?: number;
  /**
   * Plural noun for the summary — "results", "carriers", "invoices". It is the only string in this
   * component a caller normally needs to change.
   */
  itemLabel?: string;
  /** Pages either side of the current one before an ellipsis takes over. Default 1. */
  siblingCount?: number;
  /** Pages pinned at each end. Default 1, i.e. first and last are always reachable in one click. */
  boundaryCount?: number;
  /** `md` (32px) is the default. `sm` (26px) matches a dense table footer. */
  size?: PaginationSize;
  /** Freezes every control — use while the page behind it is refetching. */
  disabled?: boolean;
}

type PageSlot = number | 'gap-start' | 'gap-end';

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let n = start; n <= end; n += 1) out.push(n);
  return out;
}

/**
 * The truncation. The window is a FIXED width — boundaries + siblings + the current page + two gap
 * slots — so the control never changes size as you page through it. A paginator whose buttons move
 * under the cursor between clicks is how you end up on page 47.
 *
 * The two `Math.min`/`Math.max` clamps are what keep that width constant near the ends: at page 1
 * the sibling window cannot extend left, so it is pushed right instead of collapsing.
 */
function buildSlots(page: number, pageCount: number, siblings: number, boundaries: number): PageSlot[] {
  // Everything fits: boundaries at both ends, the sibling window, the current page, and the two
  // pages an ellipsis would have to replace to be worth drawing at all.
  const windowSize = boundaries * 2 + siblings * 2 + 3;
  if (pageCount <= windowSize + 2) return range(1, pageCount);

  const startPages = range(1, Math.min(boundaries, pageCount));
  const endPages = range(Math.max(pageCount - boundaries + 1, boundaries + 1), pageCount);

  const siblingsStart = Math.max(
    Math.min(page - siblings, pageCount - boundaries - siblings * 2 - 1),
    boundaries + 2,
  );
  const siblingsEnd = Math.min(
    Math.max(page + siblings, boundaries + siblings * 2 + 2),
    endPages.length > 0 ? (endPages[0] as number) - 2 : pageCount - 1,
  );

  return [
    ...startPages,
    // A gap that would hide exactly ONE page is not a gap — render the page instead. An ellipsis
    // standing in for a single number costs the same width and one extra click.
    ...(siblingsStart > boundaries + 2
      ? (['gap-start'] as PageSlot[])
      : boundaries + 1 < pageCount - boundaries
        ? [boundaries + 1]
        : []),
    ...range(siblingsStart, siblingsEnd),
    ...(siblingsEnd < pageCount - boundaries - 1
      ? (['gap-end'] as PageSlot[])
      : pageCount - boundaries > boundaries
        ? [pageCount - boundaries]
        : []),
    ...endPages,
  ];
}

/**
 * The one paginator. A `<nav>` wrapping a page list, prev/next, an optional page-size select, and a
 * live range summary.
 *
 * PREV AND NEXT ARE DISABLED AT THE ENDS, NEVER HIDDEN. Hiding them re-flows the whole control the
 * moment you reach page 1 or the last page, so the button that was under your cursor moves and the
 * next click lands on a page number. They use `aria-disabled` rather than the native attribute:
 * that keeps them focusable, so a keyboard user who tabs to "Previous" at page 1 hears that it is
 * unavailable instead of finding it silently absent from the tab order. The guard against the click
 * is therefore ours, in the handler.
 *
 * THE SUMMARY IS THE LIVE REGION. `aria-live=polite` + `aria-atomic`, so changing page announces
 * "Showing 51–75 of 340 results" as one sentence. This is the only announcement of the page change
 * a screen-reader user gets — the page buttons themselves are not a live region, and `aria-current`
 * is only read when focus happens to be on that button. The element is rendered from the first
 * paint, not inserted on change, because a live region added to the DOM after the fact does not
 * announce in most screen readers.
 *
 * KEYBOARD — every control is a native `<button>` or `<select>`: Tab moves between them,
 * Enter/Space activates a button, the select opens with its platform keys. There is deliberately no
 * roving tabindex and no arrow-key handling. A paginator is a short list of independent controls,
 * not a composite widget, and stealing the arrow keys here would break the select sitting next to it.
 *
 * WHEN NOT TO USE IT
 * - A feed, a log, or anything ordered by time that grows at the head. Page 2 of a live feed is a
 *   different set of rows every time you open it; use infinite scroll or a cursor "load more".
 * - A data source with no total. Without `total` you get no range summary, and a page list whose
 *   last page is unknown is a lie — offer prev/next alone, or a cursor.
 * - Fewer rows than one page. Render nothing rather than a single disabled page button.
 */
export const Pagination = forwardRef<HTMLElement, PaginationProps>(function Pagination(
  {
    page,
    pageCount,
    onPageChange,
    pageSize,
    pageSizeOptions,
    onPageSizeChange,
    total,
    itemLabel = 'results',
    siblingCount = 1,
    boundaryCount = 1,
    size = 'md',
    disabled = false,
    className,
    'aria-label': ariaLabel = 'Pagination',
    ...rest
  },
  ref,
) {
  const sizeSelectId = useId();
  const pages = Math.max(1, Math.trunc(pageCount));
  const current = Math.min(Math.max(1, Math.trunc(page)), pages);
  const slots = buildSlots(current, pages, Math.max(0, siblingCount), Math.max(1, boundaryCount));

  const atStart = current <= 1;
  const atEnd = current >= pages;

  // The summary text. Two shapes, and which one you get is a property of the DATA, not a prop: a
  // range can only be stated when both the total and the page size are known.
  let summary: string;
  if (total !== undefined && pageSize !== undefined) {
    if (total === 0) {
      summary = `No ${itemLabel}`;
    } else {
      const from = (current - 1) * pageSize + 1;
      const to = Math.min(current * pageSize, total);
      summary = `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${itemLabel}`;
    }
  } else {
    summary = `Page ${current.toLocaleString()} of ${pages.toLocaleString()}`;
  }

  function goTo(next: number): void {
    if (disabled) return;
    const clamped = Math.min(Math.max(1, next), pages);
    if (clamped === current) return;
    onPageChange(clamped);
  }

  return (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      {...rest}
    >
      <div className={styles.status}>
        {/* Rendered always, even while empty of interest, so the live region exists before the first
            update. aria-atomic makes it read as one sentence instead of only the digits that changed. */}
        <p className={styles.summary} aria-live="polite" aria-atomic="true">
          {summary}
        </p>

        {pageSizeOptions && pageSizeOptions.length > 0 ? (
          <div className={styles.sizer}>
            <label className={styles.sizerLabel} htmlFor={sizeSelectId}>
              Per page
            </label>
            {/* The house focus contract: the SHELL owns the ring (:focus-within), the bare select
                never draws its own — see global.css. Do not restyle :focus-visible here. */}
            <span className={styles.selectShell} data-focus-shell="" data-disabled={disabled || undefined}>
              <select
                id={sizeSelectId}
                className={styles.select}
                value={pageSize}
                disabled={disabled}
                onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {/* Positioned by the wrapper, not by the Icon: Icon owns a 1em square and nothing
                  else, and giving it a position would make every consumer of it a layout risk. */}
              <span className={styles.selectIcon}>
                <Icon name="expand_more" size="sm" />
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.controls}>
        <Button
          variant="ghost"
          size={size}
          icon="chevron_left"
          aria-label="Previous page"
          // aria-disabled, not disabled: the control stays reachable so the reason is reachable too.
          aria-disabled={disabled || atStart || undefined}
          title={atStart ? 'You are on the first page' : 'Previous page'}
          onClick={() => {
            if (atStart) return;
            goTo(current - 1);
          }}
        />

        <ul className={styles.pages}>
          {slots.map((slot, index) =>
            typeof slot === 'number' ? (
              <li key={slot}>
                <Button
                  // The current page is the one filled control in the row. A fill plus
                  // `aria-current` — never colour on a label alone, which at 13px is the difference
                  // AA is measured on.
                  variant={slot === current ? 'primary' : 'ghost'}
                  size={size}
                  className={styles.pageBtn}
                  aria-label={`Page ${slot}`}
                  aria-current={slot === current ? 'page' : undefined}
                  aria-disabled={disabled || undefined}
                  onClick={() => goTo(slot)}
                >
                  {slot}
                </Button>
              </li>
            ) : (
              // aria-hidden: the ellipsis is a rendering artefact of truncation, not content. A
              // screen reader hears "Page 3, Page 9" and the jump is obvious from the numbers.
              <li key={`${slot}-${index}`} aria-hidden="true" className={styles.gap}>
                …
              </li>
            ),
          )}
        </ul>

        <Button
          variant="ghost"
          size={size}
          icon="chevron_right"
          aria-label="Next page"
          aria-disabled={disabled || atEnd || undefined}
          title={atEnd ? 'You are on the last page' : 'Next page'}
          onClick={() => {
            if (atEnd) return;
            goTo(current + 1);
          }}
        />
      </div>
    </nav>
  );
});
