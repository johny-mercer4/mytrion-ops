/**
 * Placeholder rows for a carrier table's first load.
 *
 * The bars are laid into a real `.tRow` with the table's own column class, so the placeholder has
 * the geometry of the thing it stands in for rather than being a generic grey block. Widths are
 * per-column and uneven on purpose: a column of identical full-width bars reads as a loading
 * graphic, while ragged ones read as a table whose text hasn't arrived.
 *
 * Entirely `aria-hidden` — a shimmer says nothing to a screen reader. The caller marks the table
 * `aria-busy` and renders the sr-only message that actually gets announced.
 */
import s from './admin.module.css';

export function TableSkeleton({
  cols,
  widths,
  rows = 6,
}: {
  /** The table's grid-template-columns class, so the bars line up under the real headers.
   * Typed loose because a CSS-module lookup is `string | undefined` under noUncheckedIndexedAccess. */
  cols: string | undefined;
  /** Bar width per column, as a CSS length — one entry per column. */
  widths: readonly string[];
  rows?: number;
}) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={`${s.tRow} ${cols} ${s.skelRow}`}>
          {widths.map((w, c) => (
            <span key={c} className={s.skelBar} style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}
