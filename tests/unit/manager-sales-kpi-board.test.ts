/**
 * Sales KPI board — the merge between two DWH sources that have no shared agent id.
 *
 * The queries themselves are exercised against the real warehouse; what this suite pins is the
 * JOIN, which is where both bugs found on 2026-08-06 lived:
 *   1. duplicate Zoho user records for one person were OVERWRITING instead of summing
 *   2. agents who fill applications but own no carrier were dropped entirely — 22 people and 263
 *      app fills invisible, which under-reports precisely the people whose only output is fills
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/dwh.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwh.js')>();
  return { ...mod, dwh: { ...mod.dwh, query: vi.fn() } };
});

import { dwh } from '../../src/integrations/dwh.js';
import { fetchSalesKpiBoard } from '../../src/modules/manager/salesKpiBoard.js';

const query = vi.mocked(dwh.query);

/** activity rows, fill rows, cycle row — in the order fetchSalesKpiBoard issues them. */
function stub(activity: unknown[], fills: unknown[]): void {
  query.mockReset();
  query
    .mockResolvedValueOnce(activity as never)
    .mockResolvedValueOnce(fills as never)
    .mockResolvedValueOnce([{ cycle_start: '2026-07-25T19:00:00.000Z' }] as never);
}

const activityRow = (agent: string, over: Record<string, unknown> = {}) => ({
  agent,
  clients: '10',
  cycle_gallons: '1000.50',
  cycle_swipes: '25',
  active_cards: '8',
  last_tx: '2026-08-05T00:00:00.000Z',
  ...over,
});

beforeEach(() => query.mockReset());

describe('sales KPI board', () => {
  it('joins fuel activity to app fills on the normalised agent name', async () => {
    stub([activityRow('Justin Williams')], [{ agent: 'justin  WILLIAMS ', app_fills: '7' }]);
    const board = await fetchSalesKpiBoard();
    expect(board.agents).toHaveLength(1);
    expect(board.agents[0]).toMatchObject({
      agent: 'Justin Williams',
      clients: 10,
      swipes: 25,
      gallons: 1000.5,
      appFills: 7,
      inWarehouse: true,
    });
  });

  it('SUMS duplicate Zoho records for one person rather than overwriting', async () => {
    // Zoho really does hold these three as separate owner ids for one agent.
    stub(
      [activityRow('Samandar Baxodirov')],
      [
        { agent: 'Samandar Baxodirov', app_fills: '12' },
        { agent: 'SAMANDAR BAXODIROV', app_fills: '12' },
        { agent: 'samandar baxodirov', app_fills: '5' },
      ],
    );
    const board = await fetchSalesKpiBoard();
    expect(board.agents[0]?.appFills).toBe(29);
    expect(board.totals.appFills).toBe(29);
  });

  it('includes agents who fill applications but own no carrier, flagged', async () => {
    stub(
      [activityRow('Justin Williams')],
      [
        { agent: 'Justin Williams', app_fills: '7' },
        { agent: 'Trevor C Cruickshank', app_fills: '60' },
      ],
    );
    const board = await fetchSalesKpiBoard();
    const trevor = board.agents.find((a) => a.agent === 'Trevor C Cruickshank');
    expect(trevor).toBeDefined();
    expect(trevor).toMatchObject({ appFills: 60, clients: 0, gallons: 0, inWarehouse: false });
    // And his fills must reach the totals — the bug was that they did not.
    expect(board.totals.appFills).toBe(67);
  });

  it('keeps an agent with clients but no fuelling this cycle, at zero', async () => {
    stub(
      [activityRow('Quiet Agent', { cycle_gallons: '0', cycle_swipes: '0', active_cards: '0', last_tx: null })],
      [],
    );
    const board = await fetchSalesKpiBoard();
    expect(board.agents[0]).toMatchObject({
      agent: 'Quiet Agent',
      clients: 10,
      gallons: 0,
      swipes: 0,
      appFills: 0,
      inWarehouse: true,
      lastTransactionAt: null,
    });
  });

  it('ignores deals whose owner could not be resolved', async () => {
    stub([activityRow('Justin Williams')], [{ agent: null, app_fills: '40' }]);
    const board = await fetchSalesKpiBoard();
    expect(board.agents).toHaveLength(1);
    expect(board.totals.appFills).toBe(0);
  });

  it('sorts by gallons, then by app fills so no-book agents rank among themselves', async () => {
    stub(
      [activityRow('Big', { cycle_gallons: '9000' }), activityRow('Small', { cycle_gallons: '10' })],
      [
        { agent: 'NoBookA', app_fills: '5' },
        { agent: 'NoBookB', app_fills: '50' },
      ],
    );
    const board = await fetchSalesKpiBoard();
    expect(board.agents.map((a) => a.agent)).toEqual(['Big', 'Small', 'NoBookB', 'NoBookA']);
  });
});
