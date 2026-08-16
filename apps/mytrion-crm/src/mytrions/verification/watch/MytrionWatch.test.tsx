/**
 * Switching a filter must not blank the list.
 *
 * `useCachedLoad` keys its cache on the filter, so Worsened -> Improved is a cache MISS: `data`
 * drops to null and `loading` goes true. The desk used to render skeletons for the length of one
 * request — a visible flicker on every filter click, and the exact thing the house rule forbids
 * ("keep the content and mark it stale; do not blank a populated panel back to a skeleton").
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listWatchScores = vi.fn();
vi.mock('@/api/mytrionWatch', async () => {
  const actual = await vi.importActual<typeof import('@/api/mytrionWatch')>('@/api/mytrionWatch');
  return { ...actual, listWatchScores: (...a: unknown[]) => listWatchScores(...a) };
});

const { MytrionWatch } = await import('./MytrionWatch');
const { invalidateSwrCache } = await import('../../_shared/swrCache');

const row = (id: string, name: string) => ({
  id: `mws_${id}`,
  scoringDate: '2026-08-11',
  carrierId: id,
  modelVersion: 'forward_all_clean_v1',
  companyName: name,
  agentName: 'Dana Reed',
  creditLimit: 3000,
  sumContribution: 0.1,
  logit: -2.7,
  pdScore: 0.06,
  creditScore: 540,
  band: 'elevated' as const,
  prevCreditScore: 560,
  scoreDelta: -20,
  features: {},
  riskDrivers: [],
});

const payload = (items: ReturnType<typeof row>[]) => ({
  scoringDate: '2026-08-11',
  items,
  total: items.length,
  aggregates: {
    total: 728, low: 106, watch: 406, elevated: 204, high: 12,
    worsened: 241, improved: 315, avgScore: 598.4, exposureAtRisk: 2433699,
  },
  lastRun: null,
});

beforeEach(() => {
  /**
   * The SWR cache is module state and survives between tests. Clearing it is also what makes these
   * assertions honest: the flicker only ever happened on the FIRST visit to a filter, because the
   * second one is a cache hit that swaps instantly. A warm cache would let the fix look unnecessary.
   */
  invalidateSwrCache('verification:watch:queue');
  listWatchScores.mockReset();
  // Every call resolves on a later tick, so the "loading a new key" window is real.
  listWatchScores.mockImplementation(
    (f: { movement?: string }) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(payload([row('1', f?.movement === 'improved' ? 'IMPROVED CO' : 'WORSENED CO')])), 20),
      ),
  );
});

describe('filter switching', () => {
  it('keeps the previous rows on screen instead of falling back to skeletons', async () => {
    const user = userEvent.setup();
    render(<MytrionWatch />);
    await waitFor(() => expect(screen.getByText('WORSENED CO')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Improved/i }));

    // THE ASSERTION: mid-switch the old row is still rendered. Before the fix this was gone and a
    // skeleton stood in its place.
    expect(screen.getByText('WORSENED CO')).toBeInTheDocument();
    expect(screen.queryByText(/Loading the watchlist/i)).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('IMPROVED CO')).toBeInTheDocument());
  });

  it('never flashes the "nothing scored yet" empty state while switching', async () => {
    const user = userEvent.setup();
    render(<MytrionWatch />);
    await waitFor(() => expect(screen.getByText('WORSENED CO')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Improved/i }));
    // The guard used to read `data`, which is null mid-switch — so it rendered "Nothing scored yet"
    // over a desk that plainly had 728 carriers in it.
    expect(screen.queryByText(/Nothing scored yet/i)).not.toBeInTheDocument();
  });

  it('holds the aggregate tiles steady — they describe the whole snapshot, not the filter', async () => {
    const user = userEvent.setup();
    render(<MytrionWatch />);
    await waitFor(() => expect(screen.getByText('728')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Improved/i }));
    expect(screen.getByText('728')).toBeInTheDocument();
  });

  it('marks the carried-over rows stale so they do not look interactive', async () => {
    const user = userEvent.setup();
    const { container } = render(<MytrionWatch />);
    await waitFor(() => expect(screen.getByText('WORSENED CO')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Improved/i }));
    expect(container.querySelector('.mw-rows[data-stale]')).not.toBeNull();

    await waitFor(() => expect(container.querySelector('.mw-rows[data-stale]')).toBeNull());
  });
});
