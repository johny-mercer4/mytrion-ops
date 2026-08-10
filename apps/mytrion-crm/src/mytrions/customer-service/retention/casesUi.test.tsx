/**
 * CaseTimeline — the paged case history in the Retention detail pane.
 *
 * The block used to render every event, so a long-running case grew the pane without bound.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RetentionCaseEventRow } from '@/api/touchpointTypes';
import { CaseTimeline } from './casesUi';

function events(n: number): RetentionCaseEventRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `ev-${i}`,
    caseId: 'case-1',
    fromStatus: null,
    // Empty on purpose: a truthy toStatus appends " → <label>" to the title, and these tests are
    // about which events are on the page, not about how a title is composed.
    toStatus: '',
    eventType: `event-${i}`,
    actorZohoUserId: null,
    channel: null,
    notes: null,
    evidenceUrl: null,
    occurredAt: '2026-08-04T20:00:00.000Z',
  }));
}

describe('CaseTimeline', () => {
  it('shows the empty state and no pager when there are no events', () => {
    render(<CaseTimeline events={[]} />);
    expect(screen.getByText('No events yet')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders every event and no pager while they fit on one page', () => {
    render(<CaseTimeline events={events(8)} />);
    expect(screen.getByText('event-0')).toBeInTheDocument();
    expect(screen.getByText('event-7')).toBeInTheDocument();
    // A pager over a single page is chrome that does nothing.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('caps the first page and pages forward', async () => {
    const user = userEvent.setup();
    render(<CaseTimeline events={events(20)} />);

    expect(screen.getByText('event-0')).toBeInTheDocument();
    expect(screen.getByText('event-7')).toBeInTheDocument();
    // The regression this guards: the 9th event onwards rendered too, unbounded.
    expect(screen.queryByText('event-8')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(screen.getByText('event-8')).toBeInTheDocument();
    expect(screen.getByText('event-15')).toBeInTheDocument();
    expect(screen.queryByText('event-0')).not.toBeInTheDocument();
  });

  it('clamps a page that is past the end after the history shrinks', () => {
    const { rerender } = render(<CaseTimeline events={events(20)} />);
    rerender(<CaseTimeline events={events(3)} />);

    // Page state survives a prop change within one mount, so without the `safePage` clamp this
    // would slice past the end and show an empty timeline.
    expect(screen.getByText('event-0')).toBeInTheDocument();
    expect(screen.getByText('event-2')).toBeInTheDocument();
  });
});
