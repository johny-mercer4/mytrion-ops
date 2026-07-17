import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableSkeleton } from './table-skeleton';
import { CarrierInvitations } from '@/mytrions/admin/CarrierInvitations';

const WIDTHS = ['58%', '64px', '52%'] as const;

describe('TableSkeleton', () => {
  it('renders one bar per column, per row', () => {
    const { container } = render(<TableSkeleton colsClassName="cols" widths={WIDTHS} rows={4} />);

    expect(container.querySelectorAll('[data-slot="table-skeleton"] > div')).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(12);
  });

  it('applies the per-column widths so the bars are ragged like real content', () => {
    const { container } = render(<TableSkeleton colsClassName="cols" widths={WIDTHS} rows={1} />);

    const bars = [...container.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')];
    expect(bars.map((b) => b.style.width)).toEqual(['58%', '64px', '52%']);
  });

  it('lines the bars up under the real headers via the table column class', () => {
    const { container } = render(<TableSkeleton colsClassName="tInvite" rowClassName="row" widths={WIDTHS} rows={1} />);

    expect(container.querySelector('[data-slot="table-skeleton"] > div')?.className).toContain('tInvite');
  });

  // A shimmer carries nothing to a screen reader — the caller's aria-busy and sr-only text do.
  it('hides itself from assistive tech', () => {
    const { container } = render(<TableSkeleton colsClassName="cols" widths={WIDTHS} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('table loading state', () => {
  const props = {
    invitations: [],
    error: '',
    busyId: null,
    onRefresh: vi.fn(),
    onCopy: vi.fn(),
    onCancel: vi.fn(),
    onReissue: vi.fn(),
  };

  it('marks the table busy and announces it while loading', () => {
    const { container } = render(<CarrierInvitations {...props} loading />);

    expect(screen.getByRole('table', { name: 'Carrier invitations' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading invitations…');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  // The empty state is a different claim from "still loading" — it must not show mid-flight.
  it('shows neither the skeleton nor the empty state once loaded', () => {
    const { container } = render(<CarrierInvitations {...props} loading={false} />);

    const table = screen.getByRole('table', { name: 'Carrier invitations' });
    expect(table).toHaveAttribute('aria-busy', 'false');
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    expect(screen.getByText(/No invitations yet\./)).toBeInTheDocument();
  });

  it('does not claim the table is empty while it is still loading', () => {
    render(<CarrierInvitations {...props} loading />);

    expect(screen.queryByText(/No invitations yet\./)).not.toBeInTheDocument();
  });
});
