/**
 * Manager Mytrion — the ONE loading visual.
 *
 * Every tab in Manager shows a shaped skeleton on first paint, never a spinner and never a spinner
 * followed by a skeleton (the "double loader"). Each skeleton below is laid out in the SAME
 * containers the real content uses — `.mg-rf-kpis`, `.mg-rf-grid`, `.mg-lty-tiles`, `.mg-lty-grid`,
 * `.mg-tasks-layout` — so the placeholder occupies the real geometry and nothing jumps when the data
 * lands. Referrals previously borrowed Loyalty's `.mg-lty-grid` for its placeholder, which is a
 * 380px-track grid standing in for a 290px-track one: the whole page relaid itself on arrival.
 *
 * `Bar` is the only primitive. It renders `.mg-sk`, the single shimmer in the module
 * (managerWorkspace.css) — shape it here, never restyle it.
 *
 * Skeletons are `aria-hidden`; the surrounding region carries `role="status"` + `aria-busy` and the
 * human-readable label, because a shimmer says nothing to a screen reader.
 */

/** One placeholder bar. `w`/`h` are any CSS length. `line` drops the border for text-shaped bars. */
function Bar({
  w = '100%',
  h = '12px',
  line = true,
  delay = 0,
  style,
}: {
  w?: string;
  h?: string;
  line?: boolean;
  delay?: 0 | 1 | 2;
  style?: React.CSSProperties;
}) {
  const cls = ['mg-sk', line ? 'mg-sk-line' : '', delay ? `mg-sk-d${delay}` : '']
    .filter(Boolean)
    .join(' ');
  return <span className={cls} style={{ width: w, height: h, ...style }} />;
}

/**
 * A block placeholder standing in for a whole card — keeps the card's footprint, not its innards.
 * Rounds at --mg-r-md, the radius every card in the module uses, so the placeholder grid has the
 * same silhouette as the grid that replaces it.
 */
function Block({ h, delay = 0 }: { h: string; delay?: 0 | 1 | 2 }) {
  return <Bar w="100%" h={h} line={false} delay={delay} style={{ borderRadius: 'var(--mg-r-md)' }} />;
}

/* ── Referrals ─────────────────────────────────────────────────────────────── */

/**
 * Referrals body placeholder: the KPI row, the controls panel, then a grid of card-shaped blocks at
 * the real 278px card height. The page header above it is already real, so this is the body only.
 */
export function ReferralsSkeleton({ cards = 9 }: { cards?: number }) {
  return (
    <div
      className="mg-sk-stack"
      role="status"
      aria-busy="true"
      aria-label="Loading referrals"
    >
      {/* Blocks, not a mock of the tile's internals: `.mg-rf-kpis > div > span` is a hard-styled
          38px tone chip, so a placeholder rendered into that slot inherits a coloured box with no
          tone set. The grid track and the tile height are what stop the shift; reproduce those. */}
      <div className="mg-rf-kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h="92px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>

      <div className="mg-rf-controls" aria-hidden="true">
        <Bar w="100%" h="40px" line={false} />
        <div className="mg-rf-filters">
          {[92, 74, 118, 132, 128, 104].map((w, i) => (
            <Bar key={w} w={`${w}px`} h="30px" line={false} delay={(i % 3) as 0 | 1 | 2} />
          ))}
        </div>
      </div>

      <div className="mg-rf-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <Block key={i} h="278px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>
    </div>
  );
}

/* ── Loyalty Program ───────────────────────────────────────────────────────── */

/**
 * Loyalty body placeholder: the distribution panel (bar + six tier tiles), the toolbar, the track
 * chips, then the client grid. Loading used to render the client grid ALONE, so the distribution,
 * toolbar and chips all appeared above it on arrival and pushed the grid down a full panel height.
 */
export function LoyaltySkeleton({ cards = 9 }: { cards?: number }) {
  return (
    <div
      className="mg-sk-stack"
      role="status"
      aria-busy="true"
      aria-label="Loading loyalty program clients"
    >
      <div className="mg-lty-dist" aria-hidden="true">
        <Bar w="100%" h="10px" />
        <div className="mg-lty-tiles">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Block key={i} h="66px" delay={(i % 3) as 0 | 1 | 2} />
          ))}
        </div>
      </div>

      <div className="mg-toolbar" aria-hidden="true">
        <Bar w="min(320px, 60%)" h="14px" />
        <Bar w="260px" h="34px" line={false} />
      </div>

      <div className="mg-lty-chips" aria-hidden="true">
        {[84, 108, 96, 88].map((w, i) => (
          <Bar key={w} w={`${w}px`} h="28px" line={false} delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>

      <div className="mg-lty-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <Block key={i} h="304px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>
    </div>
  );
}

/* ── Department tasks ──────────────────────────────────────────────────────── */

/**
 * Tasks placeholder: the real three-column layout — new-assignment form, assignment list, detail
 * pane. This replaces a dashed "Loading tasks…" box that was both the wrong shape and, being the
 * same `.mg-tasks-empty` element used for "no assignments", the wrong semantics.
 */
export function TasksSkeleton() {
  return (
    <div
      className="mg-tasks-layout"
      role="status"
      aria-busy="true"
      aria-label="Loading department tasks"
    >
      <div className="mg-tasks-panel" aria-hidden="true">
        <Bar w="118px" h="11px" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mg-sk-col">
            <Bar w="72px" h="10px" delay={(i % 3) as 0 | 1 | 2} />
            <Bar w="100%" h="36px" line={false} delay={(i % 3) as 0 | 1 | 2} />
          </div>
        ))}
        <Bar w="100%" h="88px" line={false} delay={1} />
        <Bar w="100%" h="38px" line={false} delay={2} />
      </div>

      <div className="mg-tasks-panel" aria-hidden="true">
        <div className="mg-sk-row">
          <Bar w="104px" h="11px" />
          <Bar w="120px" h="32px" line={false} style={{ marginLeft: 'auto' }} />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <Block key={i} h="82px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>

      <div className="mg-tasks-panel" aria-hidden="true">
        <Bar w="88px" h="11px" />
        <Bar w="72%" h="18px" />
        <Bar w="100%" h="11px" delay={1} />
        <Bar w="86%" h="11px" delay={1} />
        <div className="mg-tasks-detail-grid">
          {[0, 1, 2, 3].map((i) => (
            <Block key={i} h="44px" delay={(i % 3) as 0 | 1 | 2} />
          ))}
        </div>
        <Bar w="100%" h="140px" line={false} delay={2} />
      </div>
    </div>
  );
}
