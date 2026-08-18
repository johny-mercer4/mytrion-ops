/**
 * Pins the stats-reload debounce fix: mapping several transactions in a row used to fire one
 * uncancelled fetchTransactionStats() call PER mapping action (useLoad's reload() has no
 * cancellation/de-dup), piling up concurrent DB-bound requests that starved the actual mapping
 * writes on the same connection pool. Real mapping now goes through TransactionModal (stubbed
 * here to a single onPatch button so this stays a container-level test of Transactions.tsx's own
 * effect, not an end-to-end exercise of the modal's CMP calls).
 */
import { act } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  fetchTransactions: vi.fn(),
  fetchTransactionStats: vi.fn(),
  searchTransactions: vi.fn(),
  broadcastMapping: vi.fn(),
}));
vi.mock('@/api/billing', () => api);

vi.mock('../../access/resolveAccess', () => ({ canWriteMytrion: () => true }));
vi.mock('../../context/UserContextProvider', () => ({
  useUserContext: () => ({ userName: 'Test Agent' }),
  useRealUserContext: () => ({ userName: 'Test Agent' }),
}));
vi.mock('./autoMapFlag', () => ({
  computeAutoMapFlag: () => null,
  getCarrierMemoryIndex: () => Promise.resolve(new Map()),
}));
vi.mock('./useMappingSocket', () => ({ useMappingSocket: () => undefined }));
vi.mock('./TransactionModal', () => ({
  // Stand-in for the real modal: one button fires the exact onPatch shape a successful
  // map produces, so the test can drive N "mappings" without touching CMP/search/etc.
  TransactionModal: ({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) => (
    <button
      onClick={() => onPatch({ isInvoiceMapped: true, carrierId: 'C1', mappingType: 'Invoice' })}
    >
      fake-map
    </button>
  ),
}));

import { Transactions } from './Transactions';

function rawTx(recordId: string) {
  return {
    record_id: recordId,
    source: 'zelle',
    sender_name: `Sender ${recordId}`,
    amount: 100,
    posting_date: '2026-08-01',
    isInvoiceMapped: false,
  };
}

describe('Transactions — stats reload debounce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTransactions.mockResolvedValue({
      transactions: [rawTx('t1'), rawTx('t2'), rawTx('t3')],
      has_more: false,
      total_fetched: 3,
      page: 1,
    });
    api.fetchTransactionStats.mockResolvedValue({
      total: 3,
      mapped: 0,
      unmapped: 3,
      totalAmount: 300,
      bySource: { zelle: 3 },
    });
  });

  it('collapses a burst of 3 mapping actions into a single stats reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Transactions />);

    await waitFor(() => expect(screen.getAllByTitle('Click to view details').length).toBe(3));
    // Initial mount load — not part of what we're pinning.
    const baseline = api.fetchTransactionStats.mock.calls.length;

    for (const title of screen.getAllByTitle('Click to view details')) {
      await user.click(title);
      await user.click(screen.getByText('fake-map'));
    }

    // Still within the 500ms debounce window — none of the 3 patches should have reloaded yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(api.fetchTransactionStats.mock.calls.length).toBe(baseline);

    // Past the debounce window — exactly ONE reload for the whole burst, not 3.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(api.fetchTransactionStats.mock.calls.length).toBe(baseline + 1);

    vi.useRealTimers();
  });
});
