import {
  memo,
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useDataTableMode } from '../_internal/useMediaQuery';
import { Drawer } from '../Drawer/Drawer';
import { Icon } from '../Icon/Icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
  type TableAlign,
  type TableColumnPriority,
  type TableDensity,
  type TableLayout,
  type TableScroller,
  type TableSortDirection,
} from '../Table/Table';
import styles from './DataTable.module.css';

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

/**
 * The identity column is never droppable. `Table`'s sticky-column rule falls back to `:first-child`,
 * and `display: none` does not change which element is first — a hidden identity column would leave
 * the pin on an invisible cell. Enforced here rather than documented, so a caller cannot get it
 * wrong from a distance.
 */
function effectivePriority<T>(column: DataColumn<T>): TableColumnPriority | undefined {
  return column.rowHeader ? undefined : column.priority;
}

/**
 * Where a column lands in the card row below the structure line.
 *
 *   `leading`    the 40px slot before the text — a selection checkbox, an avatar, a status glyph.
 *                At most one. Takes precedence over the `leading` prop.
 *   `primary`    the line that identifies the row. Exactly one per table.
 *   `secondary`  joined with `·` into one muted line under it. Any number; they truncate together.
 *   `value`      one right-aligned token — an amount, a status Badge. At most one.
 *   `hidden`     (default) not on the card. Still in the detail sheet.
 */
export type DataColumnMobile = 'leading' | 'primary' | 'secondary' | 'value' | 'hidden';

export interface DataColumn<T> {
  /** Stable identity: the React key, the sort key, and the `<dt>` anchor in the detail sheet. */
  id: string;
  header: ReactNode;
  /**
   * The ONE renderer, used by the table cell, the card line AND the detail sheet.
   *
   * It must return INLINE content — never a `<td>`. That single constraint is what makes a
   * migration cheap: a `cell` that already returns a `<span>` works in all three renderings
   * untouched, and one that returns a `<td>` works in none of them.
   */
  cell: (row: T) => ReactNode;

  /* ── card mode ─────────────────────────────────────────────────────────── */
  /** Default `hidden`. */
  mobile?: DataColumnMobile | undefined;
  /**
   * Override for the card only, when `cell` is too heavy for a 44px row — a checkbox, a button
   * group, a three-line block. Return `null` to drop it from the card while keeping it in the sheet.
   */
  mobileCell?: ((row: T) => ReactNode) | undefined;
  /** `false` removes the column from the detail sheet. Default true. */
  detail?: boolean | undefined;

  /* ── table mode ────────────────────────────────────────────────────────── */
  /** Drops the column below a viewport band. Never applied to the `rowHeader` column. */
  priority?: TableColumnPriority | undefined;
  numeric?: boolean | undefined;
  align?: TableAlign | undefined;
  truncate?: boolean | undefined;
  /** Column width, e.g. `'12rem'`. Needs `layout="fixed"` to bind. */
  width?: string | undefined;
  sortable?: boolean | undefined;
  /**
   * Renders `<th scope="row">` and carries the sticky-column pin. Exactly one per table, and it is
   * what lets a screen reader answer "which invoice is this $18,420 on?".
   */
  rowHeader?: boolean | undefined;
}

export interface DataTableSort {
  /** `id` of the sorted column, or null when nothing is sorted. */
  by: string | null;
  direction: TableSortDirection;
  onSort: (columnId: string, next: TableSortDirection) => void;
}

export interface DataTableDetail<T> {
  title: (row: T) => ReactNode;
  subtitle?: ((row: T) => ReactNode) | undefined;
  footer?: ((row: T) => ReactNode) | undefined;
  /** Replaces the automatic `<dl>`. */
  render?: ((row: T) => ReactNode) | undefined;
}

export interface DataTableProps<T> {
  /** The table's accessible name. Required for the same reason `Table` requires it. */
  caption: ReactNode;
  captionVisible?: boolean | undefined;
  rows: readonly T[];
  /**
   * Stable key per row. The index is supplied for datasets with no natural id — a generic dump over
   * a vendor payload, say — but prefer a real id: an index key re-uses a row's DOM (and its memo)
   * for a different record when the list reorders.
   */
  rowKey: (row: T, index: number) => string;
  columns: readonly DataColumn<T>[];

  /**
   * Makes a row activatable — selection, or opening the caller's own detail view.
   *
   * Applies in BOTH modes: a table row becomes clickable and keyboard-activatable, and a card
   * becomes a button. Use it for SELECTION, not navigation — a row that navigates on click breaks
   * middle-click, cmd-click and "copy link address", so put a real `<a>` in the identity cell for
   * that.
   */
  onRowActivate?: ((row: T) => void) | undefined;
  /**
   * The record, as a bottom sheet DataTable owns.
   *
   * PRECEDENCE, and it is per-mode rather than absolute:
   *   table mode  `onRowActivate` wins. On a desktop the detail is usually already on screen beside
   *               the table, so opening a modal over it would cover the thing it describes.
   *   card mode   `detail` wins. There is no "beside" on a phone, and the columns that dropped off
   *               the card have nowhere else to be — without a sheet they are simply unreachable,
   *               which is exactly what `expectDataParity` fails on.
   * A table with both gets row-selection on a desktop and a record sheet on a phone, which is the
   * right answer for each and the reason this is not one global rule.
   */
  detail?: DataTableDetail<T> | undefined;
  /**
   * Card-mode leading slot, for something derived from the row rather than from a column — an
   * avatar, a status glyph. A column can claim the slot instead with `mobile: 'leading'`, which
   * wins over this.
   *
   * NOT automatically `aria-hidden`. Decorative content must carry its own — but the slot also
   * legitimately holds a selection checkbox, and hiding a FOCUSABLE control from assistive tech is
   * an accessibility violation rather than a tidy-up.
   */
  leading?: ((row: T) => ReactNode) | undefined;

  loading?: boolean | undefined;
  skeletonRows?: number | undefined;
  /** Shown when `rows` is empty and `loading` is false. Say what happened and what to try next. */
  empty?: ReactNode;
  selected?: ((row: T) => boolean) | undefined;
  sort?: DataTableSort | undefined;

  density?: TableDensity | undefined;
  layout?: TableLayout | undefined;
  stickyHeader?: boolean | undefined;
  stickyFirstColumn?: boolean | undefined;
  scroller?: TableScroller | undefined;
  scrollerClassName?: string | undefined;
  scrollerStyle?: CSSProperties | undefined;
  className?: string | undefined;
}

/**
 * One column definition, two renderings: a real table on a desktop, a tap-to-detail card list on a
 * phone.
 *
 * WHY THIS IS A NEW COMPONENT AND NOT A PROP ON `Table`. `Table` is a children-composition API — the
 * caller writes `<TableHead><TableRow><TableHeaderCell>` and the component never sees a column
 * definition at all. You cannot restructure a caller's JSX children into a card, and you cannot read
 * a column's mobile role off a `<td>` somebody else built. `Table` stays exactly as it is and
 * remains the right escape hatch for the handful of tables too irregular to describe as data.
 *
 * THREE BANDS, TWO MECHANISMS:
 *
 *   ≥ 900px    table, every column
 *   640–900    table, `priority: 1` only — CSS ONLY, via `data-priority`. Dropping columns is pure
 *              visibility, so it costs no JS, no reflow and no second render path, and the
 *              `<th scope>` association survives intact.
 *   < 640px    card list, tap opens the record — a JS branch, because CSS genuinely cannot do it.
 *
 * Why the bottom band must be JS. The card's secondary line concatenates text from three *different*
 * columns with `·` separators, and no CSS selector joins the content of sibling cells. Turning a
 * `<table>` into cards otherwise means `display: block` on table/tr/td, which destroys the native
 * table reading mode — the thing `Table`'s docblock spends five lines defending — trading
 * "Amount, $18,420.00" for a worse announcement. And the whole row has to become one tap target
 * opening a sheet, which a `<td>`-scoped click is not and a `<button>` inside `<tbody>` cannot be.
 * The doubled path is bounded: one `if` in one component, with both branches calling the same
 * `cell(row)` functions.
 *
 * The mode hook resolves to `table` wherever `matchMedia` is unavailable (SSR, the design-tool
 * sandbox the ds library build ships into), so those environments always get the canonical
 * rendering rather than a card list nothing can measure.
 *
 * WHEN NOT TO USE IT
 * - A table whose cells are not describable as `(row) => ReactNode` — a rowspan, a nested table, a
 *   spreadsheet editor. That is `Table` directly.
 * - Key–value pairs for ONE record. That is a `<dl>`, which is what this renders *into* the sheet.
 * - A list that was never tabular. A card list is the mobile rendering of a table here, not a
 *   general-purpose list primitive.
 */
export function DataTable<T>({
  caption,
  captionVisible,
  rows,
  rowKey,
  columns,
  onRowActivate,
  detail,
  leading,
  loading = false,
  skeletonRows = 6,
  empty,
  selected,
  sort,
  density = 'comfortable',
  layout = 'auto',
  stickyHeader,
  stickyFirstColumn,
  scroller,
  scrollerClassName,
  scrollerStyle,
  className,
}: DataTableProps<T>) {
  const mode = useDataTableMode();
  const [detailRow, setDetailRow] = useState<T | null>(null);
  const captionId = useId();

  // Stable identity, or the row memos never bail — an inline arrow here is a new prop on every
  // render and would silently undo the memoisation the rows exist to provide.
  const openDetail = useCallback((row: T) => setDetailRow(row), []);
  // See the `detail` prop: the winner differs by mode, on purpose.
  const activateCard = detail ? openDetail : onRowActivate;
  const activateRow = onRowActivate ?? (detail ? openDetail : undefined);

  if (mode === 'card') {
    return (
      <CardList
        captionId={captionId}
        caption={caption}
        captionVisible={captionVisible}
        rows={rows}
        rowKey={rowKey}
        columns={columns}
        activate={activateCard}
        leading={leading}
        loading={loading}
        skeletonRows={skeletonRows}
        empty={empty}
        selected={selected}
        scrollerClassName={scrollerClassName}
        scrollerStyle={scrollerStyle}
        className={className}
        detail={detail}
        detailRow={detailRow}
        onCloseDetail={() => setDetailRow(null)}
      />
    );
  }

  return (
    <>
      <Table
        caption={caption}
        captionVisible={captionVisible ?? false}
        density={density}
        layout={layout}
        stickyHeader={stickyHeader ?? false}
        stickyFirstColumn={stickyFirstColumn ?? false}
        {...(scroller ? { scroller } : {})}
        {...(scrollerClassName ? { scrollerClassName } : {})}
        {...(scrollerStyle ? { scrollerStyle } : {})}
        {...(className ? { className } : {})}
      >
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableHeaderCell
                key={column.id}
                {...(column.numeric ? { numeric: true } : {})}
                {...(column.align ? { align: column.align } : {})}
                {...(column.width ? { style: { inlineSize: column.width } } : {})}
                {...(effectivePriority(column) ? { priority: effectivePriority(column) } : {})}
                {...(column.sortable && sort
                  ? {
                      sortable: true,
                      sortDirection: sort.by === column.id ? sort.direction : ('none' as const),
                      onSort: (next: TableSortDirection) => sort.onSort(column.id, next),
                    }
                  : {})}
              >
                {column.header}
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableMessageRow colSpan={columns.length}>
              <span className={styles.srOnly}>Loading…</span>
              <span className={styles.skeletonLine} aria-hidden="true" />
            </TableMessageRow>
          ) : rows.length === 0 ? (
            <TableMessageRow colSpan={columns.length}>{empty ?? 'No rows.'}</TableMessageRow>
          ) : (
            rows.map((row, index) => (
              <DataRow
                key={rowKey(row, index)}
                row={row}
                columns={columns}
                selected={selected?.(row)}
                activate={activateRow}
              />
            ))
          )}
        </TableBody>
      </Table>
      <DetailSheet
        columns={columns}
        detail={detail}
        row={onRowActivate ? null : detailRow}
        onClose={() => setDetailRow(null)}
      />
    </>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Rows — memoised
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * WHY THESE ARE MEMOISED, and why it is not premature.
 *
 * The largest table this replaces renders 200 rows x 28 columns = ~5,600 cells, and its search box
 * lives in the same component. Before the row it replaces was memoised, every keystroke re-rendered
 * all of them — measured at ~105ms per character, i.e. six dropped frames while typing. A migration
 * that dropped that memo would reintroduce a defect somebody already found and fixed.
 *
 * The bail-out depends on the CALLER handing over stable props, exactly as it did before: a
 * `columns` array built once (useMemo, or module scope) and row objects whose identity survives an
 * unrelated re-render. A `columns` array rebuilt inline on every render defeats this silently — the
 * table will still be correct, just as slow as it was before anyone measured it.
 */
interface DataRowProps<T> {
  row: T;
  columns: readonly DataColumn<T>[];
  selected: boolean | undefined;
  activate: ((row: T) => void) | undefined;
}

function DataRowInner<T>({ row, columns, selected, activate }: DataRowProps<T>) {
  return (
    <TableRow
      {...(selected === undefined ? {} : { selected })}
      {...(activate
        ? {
            onClick: () => activate(row),
            // A row is not a control, so it gets no role change — but it does need to be reachable
            // and activatable without a mouse. Enter and Space, because a selectable row behaves
            // like an option and users try both.
            tabIndex: 0,
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              activate(row);
            },
          }
        : {})}
    >
      {columns.map((column) => (
        <TableCell
          key={column.id}
          {...(column.numeric ? { numeric: true } : {})}
          {...(column.align ? { align: column.align } : {})}
          {...(column.truncate ? { truncate: true } : {})}
          {...(column.rowHeader ? { rowHeader: true, pinned: true } : {})}
          {...(effectivePriority(column) ? { priority: effectivePriority(column) } : {})}
        >
          {column.cell(row)}
        </TableCell>
      ))}
    </TableRow>
  );
}

// `memo` erases the generic — its signature returns a component typed over the resolved props, so
// `<DataRow row={someRow} />` would lose T and infer `unknown`. Casting back to the original
// function's type is the standard way to keep a memoised generic component generic; it changes no
// runtime behaviour, only what the type checker can still see.
const DataRow = memo(DataRowInner) as typeof DataRowInner;

interface DataCardProps<T> {
  row: T;
  leadingColumn: DataColumn<T> | undefined;
  primary: DataColumn<T> | undefined;
  secondaries: readonly DataColumn<T>[];
  value: DataColumn<T> | undefined;
  leading: ((row: T) => ReactNode) | undefined;
  activate: ((row: T) => void) | undefined;
  hasDetail: boolean;
  selected: boolean | undefined;
}

function DataCardInner<T>({
  row,
  leadingColumn,
  primary,
  secondaries,
  value,
  leading,
  activate,
  hasDetail,
  selected,
}: DataCardProps<T>) {
  const render = (column: DataColumn<T> | undefined): ReactNode => {
    if (!column) return null;
    return column.mobileCell ? column.mobileCell(row) : column.cell(row);
  };

  // A column claiming the slot wins over the row-derived prop; a table has one leading thing.
  const leadingNode = leadingColumn ? render(leadingColumn) : leading ? leading(row) : null;

  const inner = (
    <>
      {leadingNode === null ? null : <span className={styles.leading}>{leadingNode}</span>}
      <span className={styles.text}>
        <span className={styles.primary}>{render(primary)}</span>
        {secondaries.length > 0 ? (
          <span className={styles.secondary}>
            {secondaries.map((column, i) => (
              <span key={column.id}>
                {i > 0 ? <span className={styles.sep}> · </span> : null}
                {render(column)}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {value ? <span className={styles.value}>{render(value)}</span> : null}
      {activate ? <Icon name="chevron_right" size="sm" className={cx(styles.chevron)} /> : null}
    </>
  );

  return (
    <li className={styles.item} data-selected={selected || undefined}>
      {activate ? (
        // A real <button>, not a clickable div: Enter and Space come free, and `aria-haspopup` tells
        // a screen-reader user that activating this opens a dialog rather than navigating.
        <button
          type="button"
          className={styles.card}
          {...(hasDetail ? { 'aria-haspopup': 'dialog' as const } : {})}
          onClick={() => activate(row)}
        >
          {inner}
        </button>
      ) : (
        <div className={styles.card}>{inner}</div>
      )}
    </li>
  );
}

const DataCard = memo(DataCardInner) as typeof DataCardInner;

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Card list — the rendering below the structure line
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

interface CardListProps<T> {
  captionId: string;
  caption: ReactNode;
  captionVisible: boolean | undefined;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  columns: readonly DataColumn<T>[];
  activate: ((row: T) => void) | undefined;
  leading: ((row: T) => ReactNode) | undefined;
  loading: boolean;
  skeletonRows: number;
  empty: ReactNode;
  selected: ((row: T) => boolean) | undefined;
  scrollerClassName: string | undefined;
  scrollerStyle: CSSProperties | undefined;
  className: string | undefined;
  detail: DataTableDetail<T> | undefined;
  detailRow: T | null;
  onCloseDetail: () => void;
}

/**
 * The three-slot row grammar, proven in `apps/mini-app`:
 *
 *   [leading?]  [primary + ·-joined secondary, flex:1 min-inline-size:0]  [value]  [chevron]
 *
 * Columns 4..N do not shrink to fit — they move to the detail sheet. A card that tries to show nine
 * columns is a table with worse alignment.
 */
function CardList<T>({
  captionId,
  caption,
  captionVisible,
  rows,
  rowKey,
  columns,
  activate,
  leading,
  loading,
  skeletonRows,
  empty,
  selected,
  scrollerClassName,
  scrollerStyle,
  className,
  detail,
  detailRow,
  onCloseDetail,
}: CardListProps<T>) {
  // `filter` returns a NEW array every call, so deriving these inline would hand DataCard a fresh
  // prop on every render and defeat its memo. `find` happens to be stable, but they are derived
  // together so the reason stays in one place.
  const { leadingColumn, primary, secondaries, value } = useMemo(
    () => ({
      leadingColumn: columns.find((c) => c.mobile === 'leading'),
      primary: columns.find((c) => c.mobile === 'primary'),
      secondaries: columns.filter((c) => c.mobile === 'secondary'),
      value: columns.find((c) => c.mobile === 'value'),
    }),
    [columns],
  );

  const body = loading ? (
    <li className={styles.message}>
      <span className={styles.srOnly}>Loading…</span>
      {Array.from({ length: skeletonRows }, (_, i) => (
        <span key={i} className={styles.skeletonCard} aria-hidden="true" />
      ))}
    </li>
  ) : rows.length === 0 ? (
    <li className={styles.message}>{empty ?? 'No rows.'}</li>
  ) : (
    rows.map((row, index) => (
      <DataCard
        key={rowKey(row, index)}
        row={row}
        leadingColumn={leadingColumn}
        primary={primary}
        secondaries={secondaries}
        value={value}
        leading={leading}
        activate={activate}
        hasDetail={Boolean(detail)}
        selected={selected?.(row)}
      />
    ))
  );

  return (
    <>
      <div
        className={cx(styles.scroller, scrollerClassName)}
        style={scrollerStyle}
      >
        {/* The table's name still has to exist and still has to be announced — it is just not a
            <caption> any more, because there is no <table>. */}
        <div id={captionId} className={captionVisible ? styles.caption : styles.srOnly}>
          {caption}
        </div>
        <ul className={cx(styles.list, className)} role="list" aria-labelledby={captionId}>
          {body}
        </ul>
      </div>
      <DetailSheet columns={columns} detail={detail} row={detailRow} onClose={onCloseDetail} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Detail sheet
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

interface DetailSheetProps<T> {
  columns: readonly DataColumn<T>[];
  detail: DataTableDetail<T> | undefined;
  row: T | null;
  onClose: () => void;
}

/**
 * The whole record, in a `ds/Drawer` — which below the structure line is already a bottom sheet,
 * with entrance and exit animations, a backdrop strip to dismiss against, and safe-area padding.
 * Zero new modal CSS.
 *
 * The default body is a `<dl>` over every column, which is exactly what `Table`'s own docblock
 * prescribes for key–value pairs: "That is a `<dl>`; a two-column table announces a phantom header
 * row that says nothing."
 */
function DetailSheet<T>({ columns, detail, row, onClose }: DetailSheetProps<T>) {
  // The Drawer is controlled and animates out, so it must stay mounted through the exit. Keeping the
  // LAST non-null row means the sheet does not blank its own contents mid-animation.
  const [lastRow, setLastRow] = useState<T | null>(row);
  if (row !== null && row !== lastRow) setLastRow(row);

  if (!detail || lastRow === null) return null;
  const shown = lastRow;

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={detail.title(shown)}
      size="lg"
      {...(detail.subtitle ? { subtitle: detail.subtitle(shown) } : {})}
      {...(detail.footer ? { footer: detail.footer(shown) } : {})}
    >
      {detail.render ? (
        detail.render(shown)
      ) : (
        <dl className={styles.detail}>
          {columns
            .filter((column) => column.detail !== false)
            .map((column) => (
              <div key={column.id} className={styles.detailPair}>
                <dt className={styles.detailKey}>{column.header}</dt>
                <dd className={styles.detailValue}>{column.cell(shown)}</dd>
              </div>
            ))}
        </dl>
      )}
    </Drawer>
  );
}
