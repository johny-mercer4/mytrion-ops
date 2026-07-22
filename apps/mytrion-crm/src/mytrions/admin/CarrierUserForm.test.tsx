import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CarrierUserForm } from './CarrierUserForm';
import { listCards, searchOperators } from '../../api/carrierUsers';

vi.mock('../../api/carrierUsers', () => ({
  createCarrierInvitation: vi.fn(),
  listCards: vi.fn(async () => []),
  searchClients: vi.fn(async () => []),
  searchOperators: vi.fn(async () => []),
}));
vi.mock('../../api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('../../api/session', () => ({ getSession: () => null }));

const listCardsMock = vi.mocked(listCards);
const searchOperatorsMock = vi.mocked(searchOperators);

// userEvent deadlocks against fake timers here (its async wrapper awaits a real macrotask), and
// these tests are all about the debounce window — so drive the input with fireEvent instead.
function manualCarrierField(): HTMLElement {
  render(<CarrierUserForm onInviteCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /enter the details manually instead/i }));
  return screen.getByPlaceholderText('5758544');
}

/** One change event per character, the way the field actually reruns the lookup effects. */
function typeCarrier(field: HTMLElement, value: string): void {
  for (let i = 1; i <= value.length; i++) {
    act(() => void fireEvent.change(field, { target: { value: value.slice(0, i) } }));
  }
}

const settle = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('carrier id lookups', () => {
  it('debounces the card list rather than firing one request per keystroke', async () => {
    const field = manualCarrierField();

    typeCarrier(field, '575854');
    expect(listCardsMock).not.toHaveBeenCalled();

    await settle(300);

    expect(listCardsMock).toHaveBeenCalledOnce();
    expect(listCardsMock).toHaveBeenCalledWith('575854', 100, expect.any(AbortSignal));
  });

  // The stale-response race: both effects guard their state writes on `signal.aborted`, so the
  // cleanup actually aborting is what stops a reply for a previous carrier id from landing.
  it('aborts an in-flight card list once the carrier id moves on', async () => {
    const field = manualCarrierField();

    typeCarrier(field, '111');
    await settle(300);

    const firstSignal = listCardsMock.mock.calls[0]?.[2];
    expect(firstSignal?.aborted).toBe(false);

    act(() => void fireEvent.change(field, { target: { value: '1112' } }));
    await settle(300);

    expect(firstSignal?.aborted).toBe(true);
    expect(listCardsMock).toHaveBeenLastCalledWith('1112', 100, expect.any(AbortSignal));
  });

  it('debounces and aborts the servercrm operator lookup the same way', async () => {
    const field = manualCarrierField();

    typeCarrier(field, '111');
    await settle(300);

    expect(searchOperatorsMock).toHaveBeenCalledOnce();
    const firstSignal = searchOperatorsMock.mock.calls[0]?.[2];
    expect(firstSignal?.aborted).toBe(false);

    act(() => void fireEvent.change(field, { target: { value: '1112' } }));
    await settle(300);

    expect(firstSignal?.aborted).toBe(true);
  });

  it('does not report an aborted request as a lookup failure', async () => {
    listCardsMock.mockImplementation(async (_id, _limit, signal) => {
      await new Promise((r) => setTimeout(r, 50));
      // What transport does to an aborted fetch: wraps it as a NETWORK ApiError.
      if (signal?.aborted) throw new Error('Could not reach the backend. The operation was aborted.');
      return [];
    });
    const field = manualCarrierField();

    typeCarrier(field, '111');
    await settle(300);
    act(() => void fireEvent.change(field, { target: { value: '1112' } }));
    await settle(400);

    expect(screen.queryByText(/couldn't read the card list/i)).not.toBeInTheDocument();
  });
});
