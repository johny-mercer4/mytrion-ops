import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardState } from './DashboardState';

/**
 * Regression cover for two reported defects on the analyst dashboards:
 *   1. the loading panel rendered a "Coming soon" badge on a dashboard that IS built, and also
 *      showed a second spinner in the header for the same wait;
 *   2. "no data in this window" was rendered with that same Coming-soon panel.
 */
describe('DashboardState', () => {
  it('never says "Coming soon" — these dashboards are built', () => {
    for (const kind of ['loading', 'error', 'empty'] as const) {
      const { container, unmount } = render(<DashboardState kind={kind} detail="x" />);
      expect(container.textContent).not.toMatch(/coming soon/i);
      unmount();
    }
  });

  it('uses the shared Mytrion page loader — one mark, same as HR/Recruit', () => {
    const { container } = render(<DashboardState kind="loading" detail="fetching" />);
    // The shared loader's animated mark: a single element holding three pulsing bars.
    const marks = container.querySelectorAll('[aria-hidden="true"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.children).toHaveLength(3);
    // ...and none of the analyst's own spinner, which would be a second indicator.
    expect(container.querySelectorAll('.an-spin')).toHaveLength(0);
    expect(screen.getByText('Loading analytics…')).toBeTruthy();
    expect(screen.getByText('fetching')).toBeTruthy();
  });

  it('shows no loading indicator at all once loading has resolved', () => {
    for (const kind of ['error', 'empty'] as const) {
      const { container, unmount } = render(<DashboardState kind={kind} detail="x" />);
      expect(container.querySelectorAll('.an-spin')).toHaveLength(0);
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      unmount();
    }
  });

  it('distinguishes an empty window from a failed fetch', () => {
    const { unmount } = render(<DashboardState kind="empty" detail="nothing here" />);
    expect(screen.getByText('No activity in this range')).toBeTruthy();
    // An empty window is not an error — it offers no Retry.
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    unmount();

    render(<DashboardState kind="error" detail="timed out" onRetry={vi.fn()} />);
    expect(screen.getByText('Analytics unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('exposes the loading panel to assistive tech as a status', () => {
    render(<DashboardState kind="loading" detail="fetching" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
