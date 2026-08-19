/**
 * Loading states for the desk, SHAPED like the thing that is coming.
 *
 * WHY THESE EXIST rather than the defaults. `ds/DataTable` in table mode renders its loading state
 * as ONE thin line in a single message row (card mode gets real shaped cards — the table does
 * not). Every Collection surface is a wide table on a desk monitor, so every one of them flashed
 * a single grey line and then jumped to eleven rows of content. The rest of the module was worse:
 * a `<Skeleton variant="rect" height="420px">` is a grey slab that shares no geometry at all with
 * the worklist it stands in for.
 *
 * The rule here is the one already written on `DataTable.module.css`'s own card skeleton: shaped
 * like the real row, so nothing shifts when the data lands. Row heights and column widths are the
 * real ones, taken from the same density the table renders at.
 */
import { Skeleton, SkeletonRegion } from '@/ds';

/** What a column looks like while it is empty. Mirrors the cell kinds the desk actually renders. */
export type SkelCol =
  | { kind: 'ident'; w: string }
  | { kind: 'text'; w: string; chars?: number }
  | { kind: 'num'; w: string; chars?: number }
  | { kind: 'chip'; w: string }
  | { kind: 'meter'; w: string }
  | { kind: 'stack'; w: string };

function Cell({ col, seed }: { col: SkelCol; seed: string }) {
  switch (col.kind) {
    case 'ident':
      return (
        <span className="ck-ident">
          <Skeleton variant="rect" width="34px" height="34px" radius="control" />
          <span className="ck-lines">
            <Skeleton variant="rect" width="72%" height="14px" radius="control" />
            <Skeleton variant="rect" width="46%" height="10px" radius="control" />
          </span>
        </span>
      );
    case 'chip':
      return <Skeleton variant="rect" width="82px" height="20px" radius="control" />;
    case 'meter':
      return (
        <span className="ck-lines">
          <Skeleton variant="rect" width="38px" height="12px" radius="control" />
          <Skeleton variant="rect" width="46px" height="4px" radius="control" />
        </span>
      );
    case 'stack':
      return (
        <span className="ck-lines ck-end">
          <Skeleton variant="rect" width="64%" height="13px" radius="control" />
          <Skeleton variant="rect" width="86%" height="10px" radius="control" />
        </span>
      );
    case 'num':
      return (
        <span className="ck-end">
          <Skeleton variant="rect" width={`${(col.chars ?? 7) * 8}px`} height="13px" radius="control" />
        </span>
      );
    default:
      return (
        <Skeleton
          variant="rect"
          width={`${(col.chars ?? 9) * 8}px`}
          height="13px"
          radius="control"
          seed={seed}
        />
      );
  }
}

/**
 * A table inside its panel: header rule, N rows, footer bar. `density` picks the row height so
 * the panel is the same height before and after the data arrives.
 */
export function TableSkeleton({
  label,
  cols,
  rows = 10,
  density = 'comfortable',
}: {
  label: string;
  cols: readonly SkelCol[];
  rows?: number;
  density?: 'comfortable' | 'compact';
}) {
  return (
    <SkeletonRegion busy label={label}>
      <div className="cc-panel ck-table" data-density={density}>
        <div className="ck-head">
          {cols.map((col, i) => (
            <span key={i} className="ck-cell" style={{ width: col.w }}>
              <Skeleton variant="rect" width="56%" height="8px" radius="control" />
            </span>
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="ck-row">
            {cols.map((col, i) => (
              <span key={i} className="ck-cell" style={{ width: col.w }}>
                <Cell col={col} seed={`${r}-${i}`} />
              </span>
            ))}
          </div>
        ))}
        <div className="ck-foot">
          <Skeleton variant="rect" width="150px" height="12px" radius="control" />
          <Skeleton variant="rect" width="180px" height="26px" radius="control" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * The KPI row. Same 4-up grid, same tile box, so the strip does not resize on arrival.
 *
 * The grid is redeclared here rather than borrowed: `KpiGrid`'s `.kpis` lives in a CSS MODULE, so
 * its real class name is hashed and a plain `className="kpis"` matches nothing — the tiles stacked
 * full width. Mirroring the four declarations is the honest fix.
 */
export function KpiRowSkeleton({ count = 4, label }: { count?: number; label: string }) {
  return (
    <SkeletonRegion busy label={label}>
      <div className="ck-kpis">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="ck-kpi">
            <Skeleton variant="rect" width="58%" height="9px" radius="control" />
            <Skeleton variant="rect" width="44%" height="24px" radius="control" />
            <Skeleton variant="rect" width="70%" height="10px" radius="control" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Today's worklist: tone rail, identity, a two-line ask, two figures, an action. */
export function WorklistSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonRegion busy label="Loading the worklist">
      <div className="cc-panel">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="wl-row ck-wl">
            <span className="wl-rail ck-rail" aria-hidden="true" />
            <Skeleton variant="rect" width="34px" height="34px" radius="control" />
            <span className="wl-why ck-lines">
              <Skeleton variant="rect" width="34%" height="15px" radius="control" />
              <Skeleton variant="rect" width={r % 2 ? '78%' : '62%'} height="12px" radius="control" />
            </span>
            <span className="ck-lines ck-end">
              <Skeleton variant="rect" width="52px" height="9px" radius="control" />
              <Skeleton variant="rect" width="68px" height="14px" radius="control" />
            </span>
            <Skeleton variant="rect" width="62px" height="26px" radius="control" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** The five-lane board. Lane heads plus a few cards, at card height. */
export function BoardSkeleton({ lanes = 4, cards = 3 }: { lanes?: number; cards?: number }) {
  return (
    <SkeletonRegion busy label="Loading the collection board">
      <div className="cc-board">
        {Array.from({ length: lanes }, (_, l) => (
          <section key={l} className="cc-col">
            <div className="cc-col-head ck-lines">
              <Skeleton variant="rect" width="52%" height="13px" radius="control" />
              <Skeleton variant="rect" width="74%" height="10px" radius="control" />
            </div>
            <div className="cc-col-body">
              {Array.from({ length: cards }, (_, c) => (
                <Skeleton key={c} variant="rect" height="96px" radius="control" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** The timeline: dot, heading, note — one block per entry. */
export function TimelineSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <SkeletonRegion busy label="Loading the case activity">
      <div className="cc-tl">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="cc-tl-item ck-tl">
            <Skeleton variant="circle" width="27px" />
            <span className="cc-tl-body ck-lines">
              <Skeleton variant="rect" width="42%" height="13px" radius="control" />
              <Skeleton variant="rect" width={r % 2 ? '86%' : '64%'} height="12px" radius="control" />
            </span>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * A record header — the shape both the case and the Array report open with: crumbs, a 48px tile
 * beside two lines, a fact strip, then the wide block under it.
 */
export function RecordHeaderSkeleton({ label, band = '96px' }: { label: string; band?: string }) {
  return (
    <SkeletonRegion busy label={label}>
      <div className="ck-record">
        <Skeleton variant="rect" width="220px" height="26px" radius="control" />
        <div className="ck-record-id">
          <Skeleton variant="rect" width="48px" height="48px" radius="panel" />
          <span className="ck-lines">
            <Skeleton variant="rect" width="260px" height="22px" radius="control" />
            <span className="ck-facts">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className="ck-lines">
                  <Skeleton variant="rect" width="52px" height="8px" radius="control" />
                  <Skeleton variant="rect" width="76px" height="12px" radius="control" />
                </span>
              ))}
            </span>
          </span>
        </div>
        <Skeleton variant="rect" height={band} radius="panel" />
      </div>
    </SkeletonRegion>
  );
}

/** A right-rail or side pane: title plus a few label/value pairs. */
export function PaneSkeleton({ rows = 4, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="cc-pane ck-lines">
      {title ? <Skeleton variant="rect" width="38%" height="9px" radius="control" /> : null}
      {Array.from({ length: rows }, (_, r) => (
        <span key={r} className="ck-lines">
          <Skeleton variant="rect" width="34%" height="9px" radius="control" />
          <Skeleton variant="rect" width={r % 2 ? '72%' : '58%'} height="12px" radius="control" />
        </span>
      ))}
    </div>
  );
}
