import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deliverExport, requestBlob } = vi.hoisted(() => ({
  deliverExport: vi.fn(),
  requestBlob: vi.fn(),
}));

vi.mock('@/api/transport', () => ({ requestBlob }));
vi.mock('@/lib/deliverExport', () => ({ deliverExport }));

import { AutoCardLookupPanel } from './AutoCardLookupPanel';

const rows = [{
  cardId: '1001',
  cardNumber: '007378',
  unit: '995',
  driverId: '995',
  driverName: 'Driver One',
  xRef: '',
  status: 'Active',
  override: 'No',
}];

describe('AutoCardLookupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestBlob.mockResolvedValue(new Blob(['xlsx']));
  });

  it('shows the masked live roster and downloads the selected format', async () => {
    render(
      <AutoCardLookupPanel
        carrierId="5762018"
        companyName="ONZMOVE INC"
        rows={rows}
      />,
    );

    expect(screen.getByText('•••• 007378')).toBeInTheDocument();
    expect(screen.getByText('Driver One')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel Report' }));

    await waitFor(() => expect(requestBlob).toHaveBeenCalledWith(
      '/sales/cards/report?carrierId=5762018&companyName=ONZMOVE+INC&format=xlsx',
      { timeoutMs: 60_000 },
    ));
    expect(deliverExport).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringMatching(/^Octane_Card_Lookup_\d{4}-\d{2}-\d{2}\.xlsx$/),
    );
  });
});
