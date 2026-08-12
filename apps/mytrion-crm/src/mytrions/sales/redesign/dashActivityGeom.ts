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

export interface MsdActivityTooltipPositionOptions {
  index: number;
  len: number;
  chartWidth: number;
  renderedWidth: number;
  viewportWidth: number;
  scrollLeft: number;
  transactions: number;
  maxTransactions: number;
  svgHeight: number;
  tooltipWidth?: number;
  edgeGutter?: number;
}

/**
 * Position the floating tooltip against the rendered transaction point. The SVG can stretch wider
 * than its viewBox because the chart wrap has min-width:100%, so scale X before removing scroll.
 */
export function msdActivityTooltipPosition({
  index,
  len,
  chartWidth,
  renderedWidth,
  viewportWidth,
  scrollLeft,
  transactions,
  maxTransactions,
  svgHeight,
  tooltipWidth = 184,
  edgeGutter = 8,
}: MsdActivityTooltipPositionOptions): { left: number; top: number } {
  const safeChartWidth = Math.max(1, chartWidth);
  const safeRenderedWidth = Math.max(1, renderedWidth);
  const safeViewportWidth = Math.max(1, viewportWidth);
  const pointLeft = (msdPointX(index, len, safeChartWidth) / safeChartWidth) * safeRenderedWidth - scrollLeft;
  const halfTooltip = tooltipWidth / 2;
  const left = safeViewportWidth <= tooltipWidth + edgeGutter * 2
    ? safeViewportWidth / 2
    : Math.min(
        safeViewportWidth - halfTooltip - edgeGutter,
        Math.max(halfTooltip + edgeGutter, pointLeft),
      );

  return {
    left,
    top: (msdPointY(transactions, maxTransactions) / 90) * Math.max(1, svgHeight),
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
