import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Table.module.css';

export type TableDensity = 'comfortable' | 'compact';
export type TableLayout = 'auto' | 'fixed';
/** The three values `aria-sort` actually takes here. Same strings, so they pass straight through. */
export type TableSortDirection = 'ascending' | 'descending' | 'none';
export type TableAlign = 'start' | 'center' | 'end';

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

/**
 * The sort glyph, in all three states.
 *
 * The icon subset (src/styles/icon-map.json) has no `arrow_upward`/`arrow_downward` and no
 * `expand_less`, so the ascending/descending pair is the diagonal arrows — which do read as up and
 * down — and the unsorted state is `swap_vert`, the conventional "sortable, currently unsorted"
 * double arrow. `none` having a real glyph rather than a blank is the point: an empty slot makes a
 * sortable column look inert until someone happens to hover it.
 */
const SORT_ICON: Record<TableSortDirection, IconName> = {
  none: 'swap_vert',
  ascending: 'north_east',
  descending: 'south_east',
};

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Table
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface TableProps extends Omit<TableHTMLAttributes<HTMLTableElement>, 'children'> {
  /**
   * The table's accessible name, rendered as a real `<caption>`. REQUIRED, and visually hidden by
   * default — a table with no name is announced as "table, 9 columns" and nothing else, which in a
   * screen with four tables on it is unusable. Set `captionVisible` to show it as a heading.
   */
  caption: ReactNode;
  /** Show the caption above the table instead of hiding it visually. It is always announced. */
  captionVisible?: boolean;
  /** `comfortable` (default) for reading. `compact` for scanning a long ledger. */
  density?: TableDensity;
  /**
   * `fixed` takes column widths from the first row instead of from content. Required for `truncate`
   * on a cell, and it is what stops a sticky first column resizing as rows stream in.
   */
  layout?: TableLayout;
  /**
   * Pins the header row. It only sticks if the scroller is also the VERTICAL scroll container, so
   * pass a bounded height through `scrollerStyle` / `scrollerClassName` alongside it.
   */
  stickyHeader?: boolean;
  /** Pins the first cell of every row — the identity column — while the rest scrolls sideways. */
  stickyFirstColumn?: boolean;
  /** `<thead>` / `<tbody>` — normally `TableHead` and `TableBody`. */
  children: ReactNode;
  /** Class for the SCROLL CONTAINER, which is where a height or a max-height belongs. */
  scrollerClassName?: string;
  /** Style for the SCROLL CONTAINER — `{ maxBlockSize: '60vh' }` is the common one. */
  scrollerStyle?: CSSProperties;
  /** Ref to the scroll container, for scroll restoration or a virtualiser. */
  scrollerRef?: Ref<HTMLDivElement>;
}

/**
 * The one table.
 *
 * Replaces 35 raw `<table>` elements across 24 files, and the 22 stylesheets that each re-derived
 * their own row height, header band, hairline and hover wash.
 *
 * A REAL TABLE. `<table>`/`<caption>`/`<thead>`/`<tbody>`/`<th scope>`, not divs with
 * `role="table"`. The native element gives row/column announcement, "column 3 of 9" position, the
 * header-to-cell association that lets a screen reader read "Amount, $18,420.00" instead of
 * "$18,420.00", and browser find-in-page across cells. An ARIA re-implementation gets none of that
 * for free and most of it not at all.
 *
 * FLAT AND OPAQUE. The ground is `--surface-data` / `--surface-data-alt` via the `--ui-table-*`
 * aliases. No glass and no gradient behind data — that decision is the reason those tokens exist.
 *
 * EMPTY, LOADING AND ERROR ARE THE CALLER'S. The Table owns the box, never the words. Render them
 * through `TableMessageRow`, which spans the grid and keeps the header — and therefore the column
 * widths — in place, so the table does not collapse and re-expand as data arrives:
 *
 * ```tsx
 * <Table caption="Open invoices" stickyHeader density="compact">
 *   <TableHead>
 *     <TableRow>
 *       <TableHeaderCell>Carrier</TableHeaderCell>
 *       <TableHeaderCell numeric sortable sortDirection={dir} onSort={setDir}>Amount</TableHeaderCell>
 *     </TableRow>
 *   </TableHead>
 *   <TableBody>
 *     {loading ? (
 *       <TableMessageRow colSpan={2}><Spinner /> Loading invoices…</TableMessageRow>
 *     ) : rows.length === 0 ? (
 *       <TableMessageRow colSpan={2}>No open invoices.</TableMessageRow>
 *     ) : (
 *       rows.map((r) => (
 *         <TableRow key={r.id} selected={r.id === activeId}>
 *           <TableCell rowHeader>{r.carrier}</TableCell>
 *           <TableCell numeric>{r.amount}</TableCell>
 *         </TableRow>
 *       ))
 *     )}
 *   </TableBody>
 * </Table>
 * ```
 *
 * KEYBOARD — the table is CONTENT, not a widget, so it takes no roving tabindex and steals no keys.
 * Tab / Shift+Tab move through the interactive things inside it in DOM order: sort buttons,
 * selection checkboxes, row actions. Enter and Space activate a sort button; Space toggles a
 * checkbox. Screen-reader users navigate cells with their own table-mode keys, which is exactly what
 * the native element enables and what a `role="grid"` would take away.
 *
 * OVERFLOW — wide tables scroll inside their own container. The page body never scrolls sideways.
 *
 * WHEN NOT TO USE IT
 * - Layout. If the content is not tabular data, it is not a table; use grid or flex.
 * - A spreadsheet. Cell-level arrow-key navigation, an inline editor, range selection and a focus
 *   cage are `role="grid"` / `role="treegrid"` semantics, and bolting them onto this would break the
 *   native table reading mode this component exists to preserve.
 * - Key–value detail pairs ("Status: Active"). That is a `<dl>`; a two-column table announces a
 *   phantom header row that says nothing.
 * - Tens of thousands of rows unvirtualised. This renders exactly the rows you hand it; the
 *   windowing is the caller's, and `layout="fixed"` is what keeps the columns still while it works.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  {
    caption,
    captionVisible = false,
    density = 'comfortable',
    layout = 'auto',
    stickyHeader = false,
    stickyFirstColumn = false,
    children,
    className,
    scrollerClassName,
    scrollerStyle,
    scrollerRef,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={scrollerRef}
      className={cx(styles.scroller, scrollerClassName)}
      style={scrollerStyle}
    >
      <table
        ref={ref}
        className={cx(styles.table, className)}
        data-density={density}
        data-layout={layout}
        data-sticky-header={stickyHeader || undefined}
        data-sticky-col={stickyFirstColumn || undefined}
        {...rest}
      >
        {/* Always rendered, only ever visually hidden — see the .caption comment for why
            display:none and visibility:hidden are both wrong here. */}
        <caption className={styles.caption} data-visible={captionVisible}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Sections
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

export type TableHeadProps = HTMLAttributes<HTMLTableSectionElement>;

/**
 * `<thead>`. Exists so the section is explicit in the tree and so sticky-column selectors have a
 * predictable shape to target; it adds no styling of its own.
 *
 * WHEN NOT TO USE IT — outside a `Table`. A bare `<thead>` is invalid HTML and the browser will
 * discard it.
 */
export const TableHead = forwardRef<HTMLTableSectionElement, TableHeadProps>(function TableHead(
  { className, ...rest },
  ref,
) {
  return <thead ref={ref} className={className} {...rest} />;
});

export type TableBodyProps = HTMLAttributes<HTMLTableSectionElement>;

/**
 * `<tbody>`. Carries the class that suppresses the last row's hairline, so the table's bottom edge
 * is drawn once by whatever panel wraps it rather than twice.
 *
 * WHEN NOT TO USE IT — for a totals or summary row. That is `<tfoot>`, which browsers and print
 * stylesheets treat differently.
 */
export const TableBody = forwardRef<HTMLTableSectionElement, TableBodyProps>(function TableBody(
  { className, ...rest },
  ref,
) {
  return <tbody ref={ref} className={cx(styles.body, className)} {...rest} />;
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Row
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /**
   * Marks the row as chosen. Pair it with a checked `TableSelectCell`: the tint is never the only
   * signal, and this prop also emits `aria-selected`, which `role="row"` supports.
   */
  selected?: boolean;
  /**
   * Recolours the row and suppresses its hover. It does NOT swallow clicks — disable the controls
   * inside the row yourself (`TableSelectCell disabled`, `Button disabled`). A row that eats events
   * silently also eats the tooltip explaining why it is inert.
   */
  disabled?: boolean;
}

/**
 * `<tr>`, with the three row states: hover (automatic), selected, disabled.
 *
 * KEYBOARD — none of its own. The row is not focusable; the controls inside it are. Making a row a
 * tab stop puts a stop on every one of 400 rows and buries the actions after them.
 *
 * WHEN NOT TO USE IT — as a click target for navigation. A row that navigates on click breaks
 * middle-click, cmd-click and "copy link address"; put a real `<a>` in the identity cell instead.
 */
export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { selected, disabled, className, ...rest },
  ref,
) {
  return (
    <tr
      ref={ref}
      className={cx(styles.row, className)}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      // `aria-selected` is a supported state of role=row. Only emitted when the caller is actually
      // running a selection model — on a plain read-only table, announcing "not selected" on every
      // row is noise, not information.
      aria-selected={selected === undefined ? undefined : selected}
      {...rest}
    />
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Header cell
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// `align` is omitted from the native attributes and redefined: the HTML presentational attribute
// takes left/center/right, which is deprecated, physical (wrong under RTL) and a different union
// from the logical start/center/end this component styles with.
export interface TableHeaderCellProps
  extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  /** Right-aligns the heading so it sits over the digits it labels. */
  numeric?: boolean;
  /** Explicit alignment. Wins over `numeric`. */
  align?: TableAlign;
  /** Renders the sort control and puts `aria-sort` on the cell. */
  sortable?: boolean;
  /** Current state of THIS column. `none` means sortable but not currently sorted. */
  sortDirection?: TableSortDirection;
  /**
   * Called with the direction to move to. The cycle is ascending → descending → ascending: once a
   * user has sorted a column, "unsorted" is an arbitrary order they almost never want back. Clearing
   * a sort is the caller's business — it usually happens by sorting a different column.
   */
  onSort?: (next: TableSortDirection) => void;
  children?: ReactNode;
}

/**
 * `<th scope="col">` — a column heading, optionally sortable.
 *
 * `scope="col"` is what binds the heading to every cell beneath it, so a screen reader reads
 * "Amount, $18,420.00" rather than a bare number nine columns into a row. It defaults to `col`; pass
 * `scope="colgroup"` for a spanning group heading.
 *
 * SORTING — the state lives on the cell as `aria-sort` (the one attribute assistive tech reads for
 * this) and the control is a real `<button>` filling the cell, so the whole heading is the click
 * target. The glyph is present in all three states.
 *
 * KEYBOARD — Tab reaches the sort button; Enter and Space activate it, because it is a `<button>`
 * and not a styled `<div>`.
 *
 * WHEN NOT TO USE IT — for a row's identity cell. That is `TableCell rowHeader`, which renders
 * `<th scope="row">`.
 */
export const TableHeaderCell = forwardRef<HTMLTableCellElement, TableHeaderCellProps>(
  function TableHeaderCell(
    {
      numeric,
      align,
      sortable = false,
      sortDirection = 'none',
      onSort,
      children,
      className,
      scope = 'col',
      ...rest
    },
    ref,
  ) {
    const next: TableSortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending';

    return (
      <th
        ref={ref}
        scope={scope}
        className={cx(styles.headCell, className)}
        data-num={numeric || undefined}
        data-align={align}
        data-sortable={sortable || undefined}
        // Only on a sortable column. `aria-sort="none"` on a column that cannot be sorted tells the
        // user a control exists where there is none.
        aria-sort={sortable ? sortDirection : undefined}
        {...rest}
      >
        {sortable ? (
          <button type="button" className={styles.sortButton} onClick={() => onSort?.(next)}>
            <span>{children}</span>
            {/* Unlabelled on purpose: the button's text already names the column, and aria-sort on
                the cell already announces the direction. A label here would say both twice. */}
            {/* `cx` and not `styles.sortIcon` directly: under noUncheckedIndexedAccess a CSS-module
                lookup is `string | undefined`, and `exactOptionalPropertyTypes` refuses undefined
                for IconProps.className. cx collapses it to a string. */}
            <Icon name={SORT_ICON[sortDirection]} size="sm" className={cx(styles.sortIcon)} />
          </button>
        ) : (
          children
        )}
      </th>
    );
  },
);

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Cell
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// `align` omitted for the same reason as on TableHeaderCell — see the note there.
export interface TableCellProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  /**
   * The `.num` treatment: right-aligned, Space Mono, tabular figures. This is what makes a money
   * column scannable instead of merely readable, and it is not optional in Billing, Finance or
   * Analytics — a column whose digits jitter by glyph width cannot be compared down its length.
   */
  numeric?: boolean;
  /** Explicit alignment. Wins over `numeric`. */
  align?: TableAlign;
  /**
   * Renders `<th scope="row">` instead of `<td>` — the cell that IDENTIFIES the row. One per row,
   * and it is what lets a screen reader answer "which invoice is this $18,420 on?".
   */
  rowHeader?: boolean;
  /** Single-line with an ellipsis. Inert unless the column has a width — see `Table layout="fixed"`. */
  truncate?: boolean;
}

/**
 * A data cell. `<td>`, or `<th scope="row">` when `rowHeader` is set.
 *
 * WHEN NOT TO USE IT — for the selection checkbox. That is `TableSelectCell`, which owns the
 * shrink-to-fit column width and the indeterminate state.
 */
export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { numeric, align, rowHeader = false, truncate, className, ...rest },
  ref,
) {
  const cls = cx(styles.cell, className);
  const num = numeric || undefined;
  const trunc = truncate || undefined;

  // Two real elements rather than a `<td role="rowheader">`: the native th/scope pair is what
  // browsers build their header-association table from, and an ARIA role alone does not populate it.
  return rowHeader ? (
    <th
      ref={ref}
      scope="row"
      className={cls}
      data-row-header="true"
      data-num={num}
      data-align={align}
      data-truncate={trunc}
      {...rest}
    />
  ) : (
    <td
      ref={ref}
      className={cls}
      data-num={num}
      data-align={align}
      data-truncate={trunc}
      {...rest}
    />
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Selection cell
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface TableSelectCellProps {
  /**
   * Accessible name for the checkbox — REQUIRED, because the checkbox has no visible label. "Select
   * all rows" in the header; "Select Ridgeline Transport" in a row. Never just "Select": in a list
   * of 400 identical announcements, the name is the only thing telling the user which row they are
   * on.
   */
  label: string;
  /** Renders `<th scope="col">` instead of `<td>` — the select-all cell in the header row. */
  header?: boolean;
  checked?: boolean;
  /**
   * The header checkbox's third state: SOME rows selected. It is a DOM property, not an attribute,
   * so it cannot be expressed in JSX and is applied through a ref below.
   */
  indeterminate?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The selection cell — a native checkbox in a shrink-to-fit column.
 *
 * It is a real `<input type="checkbox">`, recoloured with `accent-color`, not a drawn box. The
 * indeterminate dash, the checkmark, forced-colors mode and the platform focus behaviour all come
 * free and all four would otherwise have to be re-implemented, one of them (indeterminate) with no
 * CSS expression at all.
 *
 * KEYBOARD — Tab reaches it, Space toggles it. Native, and therefore correct in every locale and
 * every assistive tech without a keydown handler.
 *
 * INDETERMINATE is the header's state when SOME rows are selected. It is not "checked": clicking an
 * indeterminate select-all must resolve to a definite decision, which is why `onChange` reports the
 * checkbox's resulting `checked` value and the caller decides whether that means all or none.
 *
 * WHEN NOT TO USE IT — for a boolean data value in a row ("Active: ✓"). A checkbox invites a click;
 * render a read-only glyph or a Badge instead.
 */
export function TableSelectCell({
  label,
  header = false,
  checked = false,
  indeterminate = false,
  disabled,
  onChange,
  className,
  style,
}: TableSelectCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // `indeterminate` has no HTML attribute — it exists only as a property on the element — so React
  // cannot set it declaratively and it has to be written after every render that could change it.
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const control = (
    <input
      ref={inputRef}
      type="checkbox"
      className={styles.checkbox}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange?.(event.currentTarget.checked)}
    />
  );

  return header ? (
    <th
      scope="col"
      className={cx(styles.headCell, styles.selectCell, className)}
      style={style}
    >
      {control}
    </th>
  ) : (
    <td className={cx(styles.cell, styles.selectCell, className)} style={style}>
      {control}
    </td>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Message row
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface TableMessageRowProps extends Omit<HTMLAttributes<HTMLTableRowElement>, 'children'> {
  /** Must equal the table's column count, selection column included, or the row will not span. */
  colSpan: number;
  /** The empty state, the error, the skeleton — whatever the caller decides this moment means. */
  children: ReactNode;
}

/**
 * A full-width row for an empty state, an error, or a loading placeholder.
 *
 * THE TABLE DOES NOT OWN THESE MESSAGES. There is no `empty` prop and no built-in spinner, because
 * "No results" and "No invoices match this filter — clear the date range?" are different products,
 * and the second one needs a button. This component owns only the box: a spanning cell that keeps
 * the header, and therefore the column widths, on screen so the table does not collapse and snap
 * back as data arrives.
 *
 * WHEN NOT TO USE IT — for a totals row. Totals are data; they belong in `<tfoot>` with real cells
 * so they stay aligned under the columns they sum.
 */
export const TableMessageRow = forwardRef<HTMLTableRowElement, TableMessageRowProps>(
  function TableMessageRow({ colSpan, children, className, ...rest }, ref) {
    return (
      <tr ref={ref} className={className} {...rest}>
        <td className={styles.messageCell} colSpan={colSpan}>
          {children}
        </td>
      </tr>
    );
  },
);
