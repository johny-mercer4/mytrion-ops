/**
 * Copy button on the Maintenance list view (2026-08-18).
 *
 * Previously (PR #166, QA feedback 2026-08-11) Company / Carrier ID / Unit # / Amount were
 * click-to-copy on the WHOLE cell, which meant those four columns — unlike every other column —
 * could not be clicked into the record. That read as broken, not as a feature: every column now
 * opens the record on click, and copying gets its own explicit button instead.
 *
 * The two things a careless re-application of "add a copy affordance" gets wrong here:
 *   - putting the click handler on the cell/row instead of the button, which blocks opening the
 *     record from that column;
 *   - dropping `stopPropagation` on the button, so a copy click also opens the modal.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setViewport } from '../../test/viewport';
import type { MaintenanceRecord } from './live';
import { MaintenanceListView } from './MaintenanceListView';

const copy = vi.hoisted(() => vi.fn());
vi.mock('./copyToast', () => ({ copyWithToast: copy }));

const ROWS = [
  {
    id: 'm1',
    carrierId: 'CARR-4821',
    unitNumber: '302',
    status: 'In Process',
    paymentStatus: 'Pending',
    caseType: 'Tyres',
    totalAmount: '1240.55',
    ownerName: 'D. Carter',
  },
  // No carrier, no unit, no amount: the copy button must not appear at all.
  { id: 'm2', carrierId: null, unitNumber: null, status: 'Completed', totalAmount: null },
] as unknown as MaintenanceRecord[];

const cellFor = (container: HTMLElement, row: number, col: number): HTMLElement =>
  container.querySelectorAll('tbody tr')[row]!.querySelectorAll('th, td')[col] as HTMLElement;

beforeEach(() => copy.mockClear());

describe('Maintenance list — every column opens the record, copy is a separate button', () => {
  it('opens the record when a copy-enabled cell is clicked outside the button', () => {
    const onOpen = vi.fn();
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);
    fireEvent.click(cellFor(container, 0, 1)); // Carrier ID
    expect(onOpen).toHaveBeenCalledWith(ROWS[0]);
    expect(copy).not.toHaveBeenCalled();
  });

  it('still opens the record from a non-copy cell', () => {
    const onOpen = vi.fn();
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);
    fireEvent.click(cellFor(container, 0, 3)); // Status
    expect(onOpen).toHaveBeenCalledWith(ROWS[0]);
  });

  it('the copy button copies without opening the record', () => {
    const onOpen = vi.fn();
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);
    const btn = within(cellFor(container, 0, 1)).getByRole('button', { name: 'Copy Carrier ID' });
    fireEvent.click(btn);
    expect(copy).toHaveBeenCalledWith('CARR-4821', expect.anything());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers no copy button when there is nothing to copy', () => {
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={vi.fn()} />);
    const emptyCarrier = cellFor(container, 1, 1);
    expect(within(emptyCarrier).queryByRole('button')).toBeNull();

    fireEvent.click(emptyCarrier);
    expect(copy).not.toHaveBeenCalled();
  });

  it('covers all four columns the request named', () => {
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={vi.fn()} />);
    for (const [col, label] of [
      [0, 'Company'],
      [1, 'Carrier ID'],
      [2, 'Unit #'],
      [9, 'Amount'],
    ] as const) {
      expect(within(cellFor(container, 0, col)).getByRole('button', { name: `Copy ${label}` })).toBeInTheDocument();
    }
  });

  it('drops the copy button on a phone, where the card is already the tap target', () => {
    // A second click target nested inside the card's button is ambiguous under a thumb. The values
    // are all in the record the card opens.
    setViewport(375);
    const onOpen = vi.fn();
    render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);

    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(copy).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith(ROWS[0]);
  });
});
