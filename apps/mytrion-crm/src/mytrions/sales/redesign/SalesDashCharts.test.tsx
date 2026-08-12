/** Card Activity tooltip parity with CRM Mytrion: point tracking, scroll compensation and edges. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SalesDashCharts } from './SalesDashCharts';
import { msdActivityTooltipPosition } from './dashActivityGeom';
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
  it('uses a relative activity area outside the horizontal scroller', () => {
    const css = readFileSync(MSD_CSS, 'utf8');
    const areaRule = css.match(/\.ss-root\s+\.msd-chart-activity-area\s*\{[^}]+\}/);
    const scrollerRule = css.match(/\.ss-root\s+\.msd-activity-scroller\s*\{[^}]+\}/);
    expect(areaRule?.[0]).toMatch(/position:\s*relative/);
    expect(scrollerRule?.[0]).toMatch(/overflow-x:\s*auto/);
    expect(scrollerRule?.[0]).toMatch(/overflow-y:\s*hidden/);
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
  });

  it('tracks horizontal scrolling and the hovered transaction Y coordinate', () => {
    const shared = {
      index: 6, len: 20, chartWidth: 920, renderedWidth: 920, viewportWidth: 480,
      transactions: 80, maxTransactions: 160, svgHeight: 110,
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
