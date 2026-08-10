/**
 * Click-to-copy on the Maintenance list view.
 *
 * This behaviour came from another developer (PR #166, QA feedback 2026-08-11: Company / Carrier ID
 * / Unit # / Amount opened the record modal instead of copying, because those cells had no handler
 * at all) and had to be re-applied by hand when this branch replaced the hand-written table with
 * `ds/DataTable`. A behaviour that survives a merge by hand is exactly the kind that quietly does
 * not, so it is pinned here.
 *
 * The two things a careless re-application gets wrong:
 *   - putting the handler on the rendered TEXT rather than the CELL, which leaves the cell's padding
 *     still opening the record — so a click does one thing or the other depending on the pixel;
 *   - dropping `stopPropagation`, so a copy also opens the modal.
 */
import { fireEvent, render, screen } from '@testing-library/react';
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
  // No carrier, no unit, no amount: the copy affordance must not appear at all.
  { id: 'm2', carrierId: null, unitNumber: null, status: 'Completed', totalAmount: null },
] as unknown as MaintenanceRecord[];

const cellFor = (container: HTMLElement, row: number, col: number): HTMLElement =>
  container.querySelectorAll('tbody tr')[row]!.querySelectorAll('th, td')[col] as HTMLElement;

beforeEach(() => copy.mockClear());

describe('Maintenance list — click to copy', () => {
  it('copies from the WHOLE cell, not just its text', () => {
    const onOpen = vi.fn();
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);

    const carrier = cellFor(container, 0, 1);
    expect(carrier).toHaveClass('cs-mt-cell-copyable');
    expect(carrier).toHaveAttribute('title', 'Click to copy Carrier ID');

    fireEvent.click(carrier);
    expect(copy).toHaveBeenCalledWith('CARR-4821', expect.anything());
  });

  it('does not open the record when a copy cell is clicked', () => {
    // The whole point of the original fix. Without stopPropagation the row's onOpen fires too and
    // the user gets the modal they were trying not to open.
    const onOpen = vi.fn();
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);
    fireEvent.click(cellFor(container, 0, 0));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('still opens the record from a non-copy cell', () => {
    const onOpen = vi.fn();
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={onOpen} />);
    fireEvent.click(cellFor(container, 0, 3)); // Status
    expect(onOpen).toHaveBeenCalledWith(ROWS[0]);
  });

  it('offers no copy affordance when there is nothing to copy', () => {
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={vi.fn()} />);
    const emptyCarrier = cellFor(container, 1, 1);
    expect(emptyCarrier).not.toHaveClass('cs-mt-cell-copyable');
    expect(emptyCarrier).not.toHaveAttribute('title');

    fireEvent.click(emptyCarrier);
    expect(copy).not.toHaveBeenCalled();
  });

  it('covers all four cells the QA feedback named', () => {
    const { container } = render(<MaintenanceListView rows={ROWS} onOpen={vi.fn()} />);
    for (const [col, label] of [
      [0, 'Company'],
      [1, 'Carrier ID'],
      [2, 'Unit #'],
      [9, 'Amount'],
    ] as const) {
      expect(cellFor(container, 0, col)).toHaveAttribute('title', `Click to copy ${label}`);
    }
  });

  it('drops the copy handler on a phone, where the card is already the tap target', () => {
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
