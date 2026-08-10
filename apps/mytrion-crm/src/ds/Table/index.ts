/*
 * Table ships EIGHT symbols from one folder, so per CONVENTIONS §1 the folder gets a re-export.
 *
 * They are one module and not eight because they are one mechanism: the density custom properties
 * (--tbl-cell-py / --tbl-cell-px / --tbl-head-py / --tbl-check-size) are declared once on the table
 * root and read by every descendant, and the sticky, hover, selected and disabled rules are written
 * as relationships BETWEEN the parts. Splitting Cell away from Table would mean either duplicating
 * those numbers or inventing a React context to carry them, and a context is the wrong tool for a
 * value CSS already inherits for free.
 */
export {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  TableSelectCell,
  TableMessageRow,
} from './Table';
export type {
  TableProps,
  TableHeadProps,
  TableBodyProps,
  TableRowProps,
  TableHeaderCellProps,
  TableCellProps,
  TableColumnPriority,
  TableScroller,
  TableSelectCellProps,
  TableMessageRowProps,
  TableDensity,
  TableLayout,
  TableSortDirection,
  TableAlign,
} from './Table';
