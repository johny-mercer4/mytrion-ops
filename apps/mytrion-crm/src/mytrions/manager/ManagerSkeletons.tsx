/**
 * Manager Mytrion — the ONE loading visual.
 *
 * Every tab in Manager shows a shaped skeleton on first paint, never a spinner and never a spinner
 * followed by a skeleton (the "double loader"). The skeleton is laid out in the SAME container the
 * real content uses — `.mg-tasks-layout` — so the placeholder occupies the real geometry and
 * nothing jumps when the data lands.
 *
 * The referral and loyalty skeletons moved to marketing/MarketingSkeletons.tsx with their cards;
 * the two primitives they shared with these now live in _shared/hub/HubSkeletonBars.tsx.
 */
import { TASK_COLUMNS } from './tasks/taskModel';
import { Bar, Block } from '../_shared/hub/HubSkeletonBars';

/**
 * ── THE HEIGHTS ARE MEASUREMENTS, NOT GUESSES ────────────────────────────────────────────────────
 * Every `h=` below is the real element's box height DERIVED from the type and space scales, and each
 * one is shown with its derivation. They were previously eyeballed and several were badly short — a
 * Loyalty tier tile stood at 66px against a real 90px and the client card at 304px against a real
 * 330px, so the distribution panel grew 24px and every grid row 26px the moment the roster landed.
 * That compounding downward shove is the "two different layouts" the surface was reported for.
 *
 * When a real element changes size, re-derive here. Line boxes are `--lh-*` (they are lengths, so
 * they do not scale), a unitless `line-height` multiplies its own `font-size`, and `box-sizing:
 * border-box` is global — so a border is INSIDE the number, never added to it.
 */

/**
 * Tasks placeholder: the real metric strip, filter bar and four-column board, in the real
 * containers. It replaces a dashed "Loading tasks…" box that was both the wrong shape and — being
 * the same `.mg-tasks-empty` element used for "no assignments match this filter" — the wrong
 * semantics: loading and empty were indistinguishable.
 *
 * Card counts per column are uneven on purpose. Four identical stacks read as a loading graphic;
 * a ragged board reads as a board whose text has not arrived.
 */
const TASK_COLUMN_CARDS = [3, 2, 3, 1];

/**
 * The four lanes, shared by both task placeholders below so the two can never come to describe
 * different boards. Iterates TASK_COLUMNS — the same source the real board reads — for two reasons:
 * the column count can only ever be right, and each lane can carry its own `--tk-col`.
 *
 * That custom property is not decoration. `.mg-tk-col-body`'s `box-shadow: inset 0 2px 0
 * var(--tk-col), var(--hz-glass-inset)` is invalid at computed-value time when `--tk-col` is unset,
 * which drops the WHOLE declaration — so the placeholder lanes lost both the column cap and the
 * glass inset and read as flat wells next to the board that replaced them.
 *
 * Card height 84px, against tasks/tasksBlock.css `.mg-tk-card`:
 *   11 pad + 18 top row (the 11/14 priority pill, taller than the 13/1.35 subject) + 6 + 12/16 who
 *   + 6 + 11/14 meta + 11 pad + 2 border. `border-left: 3px` is horizontal and adds nothing.
 * A subject long enough to wrap adds ~18px to that card; single-line is the floor and the honest
 * placeholder. Column body padding, gap and its 120px floor are the real ones — the placeholder
 * renders into `.mg-tk-col-body` itself.
 */
function TaskBoardColumns() {
  return (
    <>
      {TASK_COLUMNS.map((column, col) => (
        <div
          key={column.id}
          className="mg-tk-col"
          style={{ ['--tk-col' as string]: column.tone }}
          aria-hidden="true"
        >
          <div className="mg-tk-col-head">
            <div className="mg-sk-col">
              <Bar w="78px" h="12px" delay={(col % 3) as 0 | 1 | 2} />
              <Bar w="62px" h="9px" delay={(col % 3) as 0 | 1 | 2} />
            </div>
            <Bar w="30px" h="22px" line={false} delay={(col % 3) as 0 | 1 | 2} />
          </div>
          <div className="mg-tk-col-body">
            {Array.from({ length: TASK_COLUMN_CARDS[col] ?? 2 }, (_, card) => (
              <Block key={card} h="84px" delay={(card % 3) as 0 | 1 | 2} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * The BOARD only — used while the task list loads under chrome that is already real.
 *
 * The block's header, metric strip and filters render immediately at zero rather than behind a
 * placeholder: on a desk with no assignments those zeros are the true and final answer, and a
 * skeleton over them is a promise of content that never arrives. Only the board, which genuinely
 * does not know yet whether it has cards, waits.
 */
export function TasksBoardSkeleton() {
  return (
    <div className="mg-tk-board" role="status" aria-busy="true" aria-label="Loading assignments">
      <TaskBoardColumns />
    </div>
  );
}

/**
 * The WHOLE block — metric strip, filter bar and board together. Kept for a desk that has to wait
 * for its own chrome; TasksBlock uses the board-only variant above.
 *
 * Metric tile 82px, against `.mg-tk-metrics > div`:
 *   12 pad + (11/14 label + 2 + 22/1.1 value + 2 + 11/14 note = 56.2) + 12 pad + 2 border.
 * It stood at 72px, a 10px shortfall per tile that stepped the entire block up on arrival.
 */
export function TasksSkeleton() {
  return (
    <div
      className="mg-sk-stack"
      role="status"
      aria-busy="true"
      aria-label="Loading department tasks"
    >
      <div className="mg-tk-metrics" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h="82px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>

      <div className="mg-tk-filters" aria-hidden="true">
        <Bar w="min(320px, 100%)" h="34px" line={false} style={{ flex: '1 1 260px' }} />
        <Bar w="150px" h="34px" line={false} delay={1} />
        <Bar w="130px" h="34px" line={false} delay={2} />
      </div>

      <div className="mg-tk-board" aria-hidden="true">
        <TaskBoardColumns />
      </div>
    </div>
  );
}
