import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ClientCombobox } from './ClientCombobox';
import { searchClients, type DwhClient } from '../../api/carrierUsers';

vi.mock('../../api/carrierUsers', () => ({ searchClients: vi.fn() }));

const searchClientsMock = vi.mocked(searchClients);

const CLIENTS: DwhClient[] = [
  { companyName: 'Acme Transport', stage: 'Won', carrierId: '111', applicationId: null, applicationDate: null, ownerZohoUserId: null },
  { companyName: 'Globex Freight', stage: 'Won', carrierId: '222', applicationId: null, applicationDate: null, ownerZohoUserId: null },
  { companyName: 'Initech Haulage', stage: 'New', carrierId: '333', applicationId: null, applicationDate: null, ownerZohoUserId: null },
];

// userEvent deadlocks against fake timers, and the search is debounced — drive it with fireEvent.
async function search(term = 'acme') {
  const input = screen.getByRole('combobox');
  act(() => void fireEvent.change(input, { target: { value: term } }));
  await act(async () => void vi.advanceTimersByTime(300));
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchClientsMock.mockResolvedValue(CLIENTS);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClientCombobox', () => {
  it('starts collapsed and expands once results land', async () => {
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');

    const input = await search();

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  // The list carried listbox/option roles from the start, which promises arrow-key selection —
  // but nothing listened for the keys, so it was mouse-only.
  it('moves the active option with the arrows and keeps focus on the input', async () => {
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);
    const input = await search();
    input.focus();

    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Acme Transport/ })).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Globex Freight/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /Acme Transport/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('points aria-activedescendant at the highlighted option', async () => {
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);
    const input = await search();

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const active = screen.getByRole('option', { name: /Acme Transport/ });
    expect(input).toHaveAttribute('aria-activedescendant', active.id);
  });

  it('picks the highlighted option on Enter', async () => {
    const onPick = vi.fn();
    render(<ClientCombobox onPick={onPick} onManual={vi.fn()} />);
    const input = await search();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith(CLIENTS[1]);
  });

  it('does not swallow Enter when nothing is highlighted', async () => {
    const onPick = vi.fn();
    render(<ClientCombobox onPick={onPick} onManual={vi.fn()} />);
    const input = await search();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);
    const input = await search();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click outside', async () => {
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);
    await search();

    act(() => void fireEvent.mouseDown(document.body));

    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('waits for a second character before searching at all', async () => {
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);

    act(() => void fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } }));
    await act(async () => void vi.advanceTimersByTime(300));

    expect(searchClientsMock).not.toHaveBeenCalled();
  });

  it('says so when nothing matches', async () => {
    searchClientsMock.mockResolvedValue([]);
    render(<ClientCombobox onPick={vi.fn()} onManual={vi.fn()} />);
    await search();

    expect(screen.getByText(/No clients match/)).toBeInTheDocument();
  });
});
