/** Card Activity tooltip parity with CRM Mytrion: point tracking, scroll compensation and edges. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SalesDashCharts } from './SalesDashCharts';
import { MSD_TOOLTIP_WIDTH, msdActivityTooltipPosition, msdPointY } from './dashActivityGeom';
import type { SalesActivityPoint } from './dashSalesData';

const MSD_CSS = join(process.cwd(), 'src/mytrions/sales/redesign/msd.css');

const POINTS: SalesActivityPoint[] = [
  { date: '2026-07-26', label: 'Jul 26', transactions: 100, activeCards: 90, newCards: 1, volume: 9000 },
  { date: '2026-07-27', label: 'Jul 27', transactions: 110, activeCards: 91, newCards: 0, volume: 9500 },
  { date: '2026-07-30', label: 'Jul 30', transactions: 112, activeCards: 94, newCards: 0, volume: 10000 },
];

function renderChart(hoverIdx: number | null = 2) {
  return render(
    <div className="ss-root">
      <SalesDashCharts
        bars={[]}
        maxBar={0}
        barFilter="all"
        setBarFilter={vi.fn()}
        companyQ=""
        setCompanyQ={vi.fn()}
        statusFilter={null}
        setStatusFilter={vi.fn()}
        selectedDates={null}
        dailyByCarrier={[]}
        actPoints={POINTS}
        activityRange="recent"
        setActivityRange={vi.fn()}
        selStart={null}
        selEnd={null}
        hoverIdx={hoverIdx}
        setHoverIdx={vi.fn()}
        onActivityClick={vi.fn()}
        clearSelection={vi.fn()}
        selectionLabel={null}
      />
    </div>,
  );
}

describe('Card Activity hover card positioning', () => {
  it('keeps the tooltip out of every containing block on its path', () => {
    const css = readFileSync(MSD_CSS, 'utf8');
    const blockRule = css.match(/\.ss-root\s+\.msd-chart-block\s*\{[^}]+\}/);
    const areaRule = css.match(/\.ss-root\s+\.msd-chart-activity-area\s*\{[^}]+\}/);
    const scrollerRule = css.match(/\.ss-root\s+\.msd-activity-scroller\s*\{[^}]+\}/);
    const cardRule = css.match(/\.ss-root\s+\.msd-activity-card\s*\{[^}]+\}/);
    // The card is taller than the plot, so it is fixed and floats clear of the chart. A `relative`
    // anywhere above it pulls it back into a box it does not fit in.
    expect(cardRule?.[0]).toMatch(/position:\s*fixed/);
    expect(blockRule?.[0]).not.toMatch(/position:\s*relative/);
    expect(areaRule?.[0]).not.toMatch(/position:\s*relative/);
    expect(scrollerRule?.[0]).toMatch(/overflow-x:\s*auto/);
    expect(scrollerRule?.[0]).toMatch(/overflow-y:\s*hidden/);
  });

  it('dresses the tooltip in theme tokens, with no second blur layer', () => {
    const css = readFileSync(MSD_CSS, 'utf8');
    const cardRule = css.match(/\.ss-root\s+\.msd-activity-card\s*\{[^}]+\}/)?.[0] ?? '';
    expect(cardRule).toMatch(/background:\s*var\(--hz-modal-surface\)/);
    expect(cardRule).toMatch(/border:\s*1px solid var\(--glass-bd-hi\)/);
    expect(cardRule).not.toMatch(/backdrop-filter/);
    expect(cardRule).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    // The card width the edge clamp assumes has to be the width the card actually renders at.
    expect(cardRule).toMatch(new RegExp(`width:\\s*${MSD_TOOLTIP_WIDTH}px`));
    // The series colours have to live on `.ss-root`, since the portalled card is not inside the chart.
    const rootRule = css.match(/\.ss-root\s*\{[^}]*--msd-series-tx:[^}]+\}/);
    expect(rootRule).toBeTruthy();
  });

  it('portals the hover card to the module root, clear of the glass card', () => {
    const { container } = renderChart(2);
    const root = container.querySelector('.ss-root');
    const block = container.querySelector('.msd-right-col .msd-chart-block');
    const scroller = container.querySelector('.msd-activity-scroller');
    const card = container.querySelector('.msd-activity-card');
    expect(card).toBeTruthy();
    // Anywhere inside the chart card, `backdrop-filter` captures the fixed positioning and the
    // tooltip lands off by the page's scroll offset.
    expect(card!.parentElement).toBe(root);
    expect(block!.contains(card!)).toBe(false);
    expect(scroller!.contains(card!)).toBe(false);
    expect(card!.querySelector('.msd-activity-card__day')?.textContent).toBe('Jul 30');
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(card!.textContent).toContain('112');
    expect(card!.textContent).toContain('10k');
    expect(screen.getByTestId('msd-activity-crosshair')).toBeInTheDocument();
    expect(screen.getByTestId('msd-activity-glow')).toBeInTheDocument();
  });

  it('centres the tooltip on the point and clamps it to the window edges', () => {
    // A 480-unit chart rendered 800px wide, starting 100px into a 1000px window.
    const shared = {
      len: 3, chartWidth: 480, transactions: 100, maxTransactions: 112,
      svgLeft: 100, svgTop: 300, svgWidth: 800, svgHeight: 110,
      viewportWidth: 1000, viewportHeight: 900,
    };
    // Middle point: dead centre of the plot, untouched by either clamp.
    expect(msdActivityTooltipPosition({ ...shared, index: 1 }).left).toBe(500);
    // Ends track their own point while the window still has room for half a card.
    expect(msdActivityTooltipPosition({ ...shared, index: 0 }).left).toBeCloseTo(123.33);
    expect(msdActivityTooltipPosition({ ...shared, index: 2 }).left).toBeCloseTo(876.67);
    // Plot flush against the window edge: the first point's card would hang off, so it is held in.
    expect(msdActivityTooltipPosition({ ...shared, index: 0, svgLeft: 0 }).left)
      .toBe(MSD_TOOLTIP_WIDTH / 2 + 8);
    // Narrower than the card: centred, since there is no clamp that can satisfy both edges.
    expect(msdActivityTooltipPosition({ ...shared, index: 0, viewportWidth: 190 }).left).toBe(95);
  });

  it('lifts the tooltip above the point without leaving the window', () => {
    const shared = {
      index: 4, len: 10, chartWidth: 480, maxTransactions: 160,
      svgLeft: 0, svgWidth: 480, svgHeight: 110,
      viewportWidth: 1000, viewportHeight: 900, tooltipHeight: 140,
    };
    // Mid-window: the card's bottom edge sits 10px above the point it describes.
    const point = 300 + (msdPointY(80, 160) / 90) * 110;
    expect(msdActivityTooltipPosition({ ...shared, svgTop: 300, transactions: 80 }).top)
      .toBeCloseTo(point - 10);
    // Chart scrolled up under the header: clamped so the card stays on screen.
    expect(msdActivityTooltipPosition({ ...shared, svgTop: 20, transactions: 160 }).top).toBe(148);
    // And it cannot fall off the bottom either.
    expect(msdActivityTooltipPosition({ ...shared, svgTop: 1400, transactions: 0 }).top).toBe(892);
  });

  it('follows the point as the chart and the page scroll', () => {
    const shared = {
      index: 6, len: 20, chartWidth: 920, transactions: 80, maxTransactions: 160,
      svgTop: 400, svgWidth: 920, svgHeight: 110,
      viewportWidth: 1000, viewportHeight: 900, tooltipHeight: 140,
    };
    // Both scroll axes reach the geometry the same way: the plot's client rect has already moved.
    const atStart = msdActivityTooltipPosition({ ...shared, svgLeft: 40 });
    const scrolledRight = msdActivityTooltipPosition({ ...shared, svgLeft: -60 });
    const scrolledDown = msdActivityTooltipPosition({ ...shared, svgLeft: 40, svgTop: 300 });
    expect(scrolledRight.left).toBeCloseTo(atStart.left - 100);
    expect(scrolledDown.top).toBeCloseTo(atStart.top - 100);
    // A taller day pushes the card further up.
    expect(msdActivityTooltipPosition({ ...shared, svgLeft: 40, transactions: 160 }).top)
      .toBeLessThan(atStart.top);
  });

  it('labels Card Activity as warehouse txn data (not live EFS status)', () => {
    renderChart(null);
    expect(screen.getByText(/warehouse txn activity/i)).toBeInTheDocument();
  });

  it('labels Cards by Company Active as warehouse (not live EFS)', () => {
    renderChart(null);
    expect(screen.getByText(/Active from warehouse/i)).toBeInTheDocument();
  });
});
