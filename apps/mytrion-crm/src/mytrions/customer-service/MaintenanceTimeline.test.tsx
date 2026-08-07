/**
 * QA 2026-08-07: the Timeline lumped every field a save touched under one shared timestamp block,
 * unlike Zoho's audit log (one row per field change, own timestamp/editor). The backend already
 * stores per-field granularity (`entry.changes: {field,label,from,to}[]`) — this guards the
 * flatten-to-one-row-per-change rendering fix.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/api/cs', () => ({
  listMaintenanceHistory: vi.fn(),
}));

import { listMaintenanceHistory } from '@/api/cs';
import { MaintenanceTimeline } from './MaintenanceTimeline';

describe('MaintenanceTimeline', () => {
  it('renders one row per field change instead of lumping a save into one block', async () => {
    vi.mocked(listMaintenanceHistory).mockResolvedValue({
      history: [
        {
          id: 'h1',
          caseId: 'c1',
          action: 'updated',
          changedByName: 'Charlotte Birmingham',
          changedAt: '2026-08-07T12:32:00Z',
          changes: [
            { field: 'totalAmount', label: 'Total Amount', from: null, to: '$246.29' },
            { field: 'paymentStatus', label: 'Payment Status', from: null, to: 'Pending' },
            { field: 'status', label: 'Status', from: 'In Process', to: 'Completed' },
          ],
        },
      ],
    });

    render(<MaintenanceTimeline caseId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/was updated from/)).toHaveLength(3));

    expect(screen.getByText('Total Amount')).toBeInTheDocument();
    expect(screen.getByText('Payment Status')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    // Status is a badge-mapped field — the "to" value renders as a colored badge, not plain <em>.
    expect(screen.getByText('Completed').className).toContain('cs-badge');
  });

  it('renders the creation marker plus one row per initial field, not one lumped block', async () => {
    vi.mocked(listMaintenanceHistory).mockResolvedValue({
      history: [
        {
          id: 'h0',
          caseId: 'c1',
          action: 'created',
          changedByName: 'Mason Mickdale',
          changedAt: '2026-08-07T08:00:00Z',
          changes: [
            { field: 'name', label: 'Company Name', from: null, to: 'NOHCHO INC' },
            { field: 'carrierId', label: 'Carrier ID', from: null, to: '5887597' },
          ],
        },
      ],
    });

    render(<MaintenanceTimeline caseId="c1" />);
    await waitFor(() => expect(screen.getByText('Maintenance Case Created')).toBeInTheDocument());
    expect(screen.getAllByText(/was updated from/)).toHaveLength(2);
  });
});
