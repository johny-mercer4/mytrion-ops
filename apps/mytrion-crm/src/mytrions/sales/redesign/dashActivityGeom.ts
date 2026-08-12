/** SVG geometry helpers for Card Activity — matches zoho-octane msdPointX/Y/paths. */

export function msdActivityWidth(len: number): number {
  return Math.max(len * 46, 480);
}

export function msdPointX(i: number, len: number, width: number): number {
  if (len <= 1) return width / 2;
  const inset = 14;
  return inset + (i / (len - 1)) * (width - inset * 2);
}

export function msdColLeftPct(i: number, len: number, width: number): string {
  if (len <= 1) return '50%';
  const px = msdPointX(i, len, width);
  return `${(px / width) * 100}%`;
}

export function msdPointY(val: number, max: number): number {
  const p = max > 0 ? val / max : 0;
  return 85 - p * 80;
}

/** Kept in sync with `.msd-activity-card { width }` in msd.css. */
export const MSD_TOOLTIP_WIDTH = 184;
/**
 * Starting guess for the card's height, replaced by a measurement on first hover. Only the top clamp
 * reads it, and over-estimating is the safe direction: too high parks the card a few pixels lower,
 * too low lets it run off the top of the window.
 */
export const MSD_TOOLTIP_HEIGHT = 140;

/** Everything the position depends on that only the DOM can answer. */
export interface MsdActivityPlotBox {
  /** The plot's client rect. Horizontal scrolling is already baked into `svgLeft`. */
  svgLeft: number;
  svgTop: number;
  svgWidth: number;
  svgHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  tooltipHeight: number;
}

export interface MsdActivityTooltipPositionOptions extends Omit<MsdActivityPlotBox, 'tooltipHeight'> {
  index: number;
  len: number;
  /** viewBox width, i.e. the chart's own coordinate space. */
  chartWidth: number;
  transactions: number;
  maxTransactions: number;
  tooltipWidth?: number;
  tooltipHeight?: number;
  tooltipGap?: number;
  edgeGutter?: number;
}

/**
 * Position the floating tooltip above the rendered transaction point, in VIEWPORT coordinates — the
 * card is `position: fixed`.
 *
 * Fixed, not absolute, because the card is taller than the 110px plot: anchored inside the chart card
 * it has nowhere to go, and clamping it to the card drops it back over the point it is describing.
 * Floating free is also the interaction being matched. The window is the only boundary, so the card
 * cannot be clipped by the page scroller and cannot leave the screen.
 *
 * `top` is the card's BOTTOM edge — CSS lifts it with `translateY(-100%)`.
 */
export function msdActivityTooltipPosition({
  index,
  len,
  chartWidth,
  transactions,
  maxTransactions,
  svgLeft,
  svgTop,
  svgWidth,
  svgHeight,
  viewportWidth,
  viewportHeight,
  tooltipWidth = MSD_TOOLTIP_WIDTH,
  tooltipHeight = MSD_TOOLTIP_HEIGHT,
  tooltipGap = 10,
  edgeGutter = 8,
}: MsdActivityTooltipPositionOptions): { left: number; top: number } {
  const safeChartWidth = Math.max(1, chartWidth);
  const safeViewportWidth = Math.max(1, viewportWidth);
  const pointLeft = svgLeft + (msdPointX(index, len, safeChartWidth) / safeChartWidth) * Math.max(1, svgWidth);
  const pointTop = svgTop + (msdPointY(transactions, maxTransactions) / 90) * Math.max(1, svgHeight);
  const halfTooltip = tooltipWidth / 2;

  return {
    left: safeViewportWidth <= tooltipWidth + edgeGutter * 2
      ? safeViewportWidth / 2
      : Math.min(
          safeViewportWidth - halfTooltip - edgeGutter,
          Math.max(halfTooltip + edgeGutter, pointLeft),
        ),
    top: Math.min(
      Math.max(viewportHeight - edgeGutter, tooltipHeight + edgeGutter),
      Math.max(tooltipHeight + edgeGutter, pointTop - tooltipGap),
    ),
  };
}

export function msdLinePath(
  values: number[],
  max: number,
  width: number,
): string {
  if (!values.length) return '';
  return values
    .map((v, i) => {
      const x = msdPointX(i, values.length, width).toFixed(1);
      const y = msdPointY(v, max).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

export function msdAreaPath(
  values: number[],
  max: number,
  width: number,
): string {
  if (!values.length) return '';
  const len = values.length;
  const pts = values.map((v, i) => {
    const x = msdPointX(i, len, width).toFixed(1);
    const y = msdPointY(v, max).toFixed(1);
    return `${x},${y}`;
  });
  const firstX = msdPointX(0, len, width).toFixed(1);
  const lastX = msdPointX(len - 1, len, width).toFixed(1);
  return `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')} L${lastX},90 L${firstX},90 Z`;
}

export function msdSelBandX(startIdx: number, len: number, width: number): number {
  return msdPointX(startIdx, len, width) - 20;
}

export function msdSelBandW(
  startIdx: number,
  endIdx: number,
  len: number,
  width: number,
): number {
  const x0 = msdPointX(startIdx, len, width) - 20;
  const x1 = msdPointX(endIdx, len, width) + 20;
  return Math.max(40, x1 - x0);
}
