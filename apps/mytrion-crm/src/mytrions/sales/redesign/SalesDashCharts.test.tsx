/** Card Activity tooltip parity with CRM Mytrion: point tracking, scroll compensation and edges. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SalesDashCharts } from './SalesDashCharts';
import { MSD_TOOLTIP_HEIGHT, MSD_TOOLTIP_WIDTH, msdActivityTooltipPosition } from './dashActivityGeom';
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
  it('clamps the tooltip against the chart block, not the activity area', () => {
    const css = readFileSync(MSD_CSS, 'utf8');
    const blockRule = css.match(/\.ss-root\s+\.msd-chart-block\s*\{[^}]+\}/);
    const areaRule = css.match(/\.ss-root\s+\.msd-chart-activity-area\s*\{[^}]+\}/);
    const scrollerRule = css.match(/\.ss-root\s+\.msd-activity-scroller\s*\{[^}]+\}/);
    // The plot is shorter than the tooltip, so the area cannot be the containing block — see
    // `msdActivityTooltipPosition`.
    expect(blockRule?.[0]).toMatch(/position:\s*relative/);
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
  });

  it('renders the hover card as a scroller sibling inside the activity area', () => {
    const { container } = renderChart(2);
    const area = container.querySelector('.msd-chart-activity-area');
    const scroller = container.querySelector('.msd-activity-scroller');
    const card = container.querySelector('.msd-activity-card');
    expect(area).toBeTruthy();
    expect(scroller).toBeTruthy();
    expect(card).toBeTruthy();
    expect(area!.contains(card!)).toBe(true);
    expect(scroller!.contains(card!)).toBe(false);
    expect(card!.querySelector('.msd-activity-card__day')?.textContent).toBe('Jul 30');
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(card!.textContent).toContain('112');
    expect(card!.textContent).toContain('10k');
    expect(screen.getByTestId('msd-activity-crosshair')).toBeInTheDocument();
    expect(screen.getByTestId('msd-activity-glow')).toBeInTheDocument();
  });

  it('clamps the first and last points inside the visible viewport', () => {
    const shared = {
      len: 3, chartWidth: 480, renderedWidth: 800, viewportWidth: 800, scrollLeft: 0,
      transactions: 100, maxTransactions: 112, svgHeight: 110,
    };
    expect(msdActivityTooltipPosition({ ...shared, index: 0 }).left).toBe(100);
    expect(msdActivityTooltipPosition({ ...shared, index: 2 }).left).toBe(700);
    // The scroller starts inside the block's padding, and the block is what `left` resolves against.
    expect(msdActivityTooltipPosition({ ...shared, index: 0, originLeft: 14 }).left).toBe(114);
  });

  it('never lifts the tooltip out through the top of the chart block', () => {
    const shared = {
      index: 4, len: 10, chartWidth: 480, renderedWidth: 480, viewportWidth: 480, scrollLeft: 0,
      maxTransactions: 160, svgHeight: 110, originTop: 64,
    };
    // The tallest day sits ~6px below the top of a 110px plot, and the card is ~128px: there is no
    // room above its own point, so unclamped it would paint out over the page header.
    expect(msdActivityTooltipPosition({ ...shared, transactions: 160 }).top).toBe(MSD_TOOLTIP_HEIGHT + 8);
    // A flat day has room, so it still tracks its point instead of sitting on the clamp.
    expect(msdActivityTooltipPosition({ ...shared, transactions: 0 }).top)
      .toBeGreaterThan(MSD_TOOLTIP_HEIGHT + 8);
  });

  it('tracks horizontal scrolling and the hovered transaction Y coordinate', () => {
    const shared = {
      index: 6, len: 20, chartWidth: 920, renderedWidth: 920, viewportWidth: 480,
      transactions: 80, maxTransactions: 160, svgHeight: 110, originTop: 220,
    };
    const atStart = msdActivityTooltipPosition({ ...shared, scrollLeft: 0 });
    const afterScroll = msdActivityTooltipPosition({ ...shared, scrollLeft: 100 });
    const higherPoint = msdActivityTooltipPosition({ ...shared, scrollLeft: 100, transactions: 160 });
    expect(afterScroll.left).toBeCloseTo(atStart.left - 100);
    expect(higherPoint.top).toBeLessThan(afterScroll.top);
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
