import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/dataLoader', () => ({
  getDataLoaderConfig: vi.fn(),
  listDataLoaderBatches: vi.fn(),
  getDataLoaderBatch: vi.fn(),
  revertDataLoaderBatch: vi.fn(),
}));

vi.mock('./toast', () => ({
  adminToast: { success: vi.fn(), error: vi.fn() },
}));

import {
  getDataLoaderBatch,
  getDataLoaderConfig,
  listDataLoaderBatches,
  revertDataLoaderBatch,
} from '../../api/dataLoader';
import { DataLoader } from './DataLoader';

const configMock = vi.mocked(getDataLoaderConfig);
const listMock = vi.mocked(listDataLoaderBatches);
const detailMock = vi.mocked(getDataLoaderBatch);
const revertMock = vi.mocked(revertDataLoaderBatch);

const batch = {
  batchId: 'auto:mytrion_loader:scope_risk_items:202607290101',
  tableName: 'scope_risk_items',
  dbUser: 'mytrion_loader',
  insertCount: 0,
  updateCount: 1,
  deleteCount: 0,
  rowCount: 1,
  createdAt: '2026-07-29T01:01:00.000Z',
  revertedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  configMock.mockResolvedValue({
    baseUrl: 'http://127.0.0.1:8080',
    tables: ['scope_risk_items'],
  });
  listMock.mockResolvedValue({ batches: [], total: 0, limit: 10, offset: 0 });
});

describe('DataLoader states', () => {
  it('shows a skeleton while the journal is loading', () => {
    configMock.mockReturnValue(new Promise(() => undefined));
    listMock.mockReturnValue(new Promise(() => undefined));
    render(<DataLoader />);
    expect(screen.getByText('Loading Data Loader batches…')).toBeInTheDocument();
  });

  it('shows an actionable error with retry', async () => {
    configMock.mockRejectedValue(new Error('database offline'));
    render(<DataLoader />);
    expect(await screen.findByText('Data Loader is unavailable')).toBeInTheDocument();
    expect(screen.getByText('database offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the empty state after a successful empty load', async () => {
    render(<DataLoader />);
    expect(await screen.findByText('No bulk changes yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open NocoDB' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:8080',
    );
  });

  it('loads field diffs and confirms a revert from the populated state', async () => {
    listMock.mockResolvedValue({ batches: [batch], total: 1, limit: 10, offset: 0 });
    detailMock.mockResolvedValue({
      batchId: batch.batchId,
      rows: [
        {
          id: 'bcl_1',
          tenantId: 'octane',
          audience: null,
          batchId: batch.batchId,
          tableName: batch.tableName,
          rowPk: 'ri_1',
          op: 'update',
          before: { label: 'Before' },
          after: { label: 'After' },
          dbUser: 'mytrion_loader',
          revertedAt: null,
          revertedBy: null,
          createdAt: batch.createdAt,
        },
      ],
    });
    revertMock.mockResolvedValue({
      batchId: batch.batchId,
      rowCount: 1,
      tables: ['scope_risk_items'],
    });

    render(<DataLoader />);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect' }));
    expect((await screen.findAllByText('Before')).length).toBeGreaterThan(1);
    expect(screen.getAllByText('After').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Restore 1 row in scope_risk_items',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revert batch' }));
    await waitFor(() => {
      expect(revertMock).toHaveBeenCalledWith(batch.batchId);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });
});
