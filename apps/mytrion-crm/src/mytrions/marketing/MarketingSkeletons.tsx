/**
 * Marketing Mytrion — the ONE loading visual.
 *
 * Both tabs show a shaped skeleton on first paint, never a spinner and never a spinner followed by
 * a skeleton (the "double loader"). Each skeleton is laid out in the SAME containers the real
 * content uses — `.mg-rf-kpis`, `.mg-rf-grid`, `.mg-lty-tiles`, `.mg-lty-grid` — so the placeholder
 * occupies the real geometry and nothing jumps when the data lands. Referrals previously borrowed
 * Loyalty's `.mg-lty-grid`, a 380px-track grid standing in for a 290px-track one: the whole page
 * relaid itself on arrival.
 */
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

/* ── Referrals ─────────────────────────────────────────────────────────────── */

/**
 * Referrals body placeholder: the KPI row, the controls panel, the result-count line, then a grid of
 * card-shaped blocks at the real card height. The page header above it is already real, so this is
 * the body only.
 *
 * Heights, against cards/referrals.css:
 *   KPI tile 92px   16 pad + (11/14 label + 22/1.25 value + 12/16 note = 57.5) + 16 pad + 2 border
 *   card    278px   `.mg-rf-card`'s own declared `min-height`
 * The controls panel needs no height: the placeholder renders INTO `.mg-rf-controls`, so its 14px
 * padding and 11px gap are the real ones and only the 40px search and 30px chips had to be restated.
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

      {/* "Showing 1–24 of 312 referrals". It looks like a throwaway line and is not: it carries
          `margin-bottom: -16px`, so between the page's two 26px gaps it contributes a net 28px that
          the placeholder was not reserving — the grid loaded 28px HIGHER than it settled. */}
      <div className="mg-rf-result-meta" aria-hidden="true">
        <Bar w="min(230px, 60%)" h="12px" />
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
 *
 * Heights, against managerLoyalty.css:
 *   bar       10px   `.mg-lty-bar`'s declared height
 *   tile      90px   12 pad + (26/1 count + 4 + 11/14 label + 4 + 12/16 pct = 64) + 12 pad + 2 border
 *   chip      28px   4 pad + 13/18 label + 4 pad + 2 border
 *   card     330px   15 pad + 39.25 identity + 11 + 142.9 periods + 11 + 28 account + 11 + 27
 *                    progress + 11 + 17 manage + 15 pad + 2 border
 * The tile and the card were the two real defects: 66px and 304px against 90px and 330px, i.e. the
 * panel jumped 24px and every grid row 26px on arrival. There is one honest approximation left — a
 * company name long enough to hit the card's 2-line clamp adds 20px to that row, so a grid whose
 * first screen is mostly long names still settles slightly taller than 330.
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
            <Block key={i} h="90px" delay={(i % 3) as 0 | 1 | 2} />
          ))}
        </div>
      </div>

      <div className="mg-toolbar" aria-hidden="true">
        <Bar w="min(320px, 60%)" h="14px" />
        <Bar w="260px" h="34px" line={false} />
      </div>

      {/* FIVE chips, not four — the track filter is All / Owner-Operator / Small Company / Fleet /
          Enterprise. Widths approximate those labels so the row wraps where the real one wraps. */}
      <div className="mg-lty-chips" aria-hidden="true">
        {[92, 122, 114, 58, 94].map((w, i) => (
          <Bar key={w} w={`${w}px`} h="28px" line={false} delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>

      <div className="mg-lty-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <Block key={i} h="330px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>
    </div>
  );
}

/* ── Department tasks ──────────────────────────────────────────────────────── */
