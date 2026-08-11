/**
 * Card Activity hover card must position against `.msd-activity-wrap`. Without `position: relative`
 * on that wrap, `position: absolute` walks up to a page-level ancestor and the card paints under the
 * header search (the Jul-2026 screenshot bug).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SalesDashCharts } from './SalesDashCharts';
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
  it('keeps .msd-activity-wrap as the absolute containing block', () => {
    const css = readFileSync(MSD_CSS, 'utf8');
    const wrapRule = css.match(/\.ss-root\s+\.msd-activity-wrap\s*\{[^}]+\}/);
    expect(wrapRule?.[0]).toMatch(/position:\s*relative/);
  });

  it('anchors the hover card inside the activity wrap, not a page ancestor', () => {
    const { container } = renderChart(2);
    const wrap = container.querySelector('.msd-activity-wrap');
    const card = container.querySelector('.msd-activity-card');
    expect(wrap).toBeTruthy();
    expect(card).toBeTruthy();
    expect(wrap!.contains(card!)).toBe(true);
    expect(card!.querySelector('.msd-activity-card__day')?.textContent).toBe('Jul 30');
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(card!.textContent).toContain('112');
    expect(card!.textContent).toContain('10k');
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

