import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DateField } from '../DateField/DateField';
import { DatePicker } from './DatePicker';
import { DateRangePicker } from './DateRangePicker';

/*
 * The behaviours that are expensive to notice by looking. Every case below is one that a plausible
 * "small" refactor would silently break — segment ORDER, the day clamp, the null-on-incomplete
 * contract, focus restoration, and the range swap.
 *
 * `today` is passed everywhere rather than mocked, which is why the component accepts it: a test
 * that stubs the clock is testing the stub.
 */
describe('DateField', () => {
  it('lays the segments out in the LOCALE order, not the type order', () => {
    render(<DateField aria-label="Invoice date" locale="en-US" />);
    expect(screen.getAllByRole('spinbutton').map((s) => s.getAttribute('aria-label'))).toEqual([
      'month',
      'day',
      'year',
    ]);
  });

  it('fills segments from digits and advances when no further digit can fit', async () => {
    const onChange = vi.fn();
    render(<DateField aria-label="d" locale="en-US" onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('spinbutton')[0]!);
    // `3` can only be March, so focus moves without waiting for a second keystroke.
    await userEvent.keyboard('3152026');
    expect(onChange).toHaveBeenLastCalledWith('2026-03-15');
  });

  it('clamps the day when the month shrinks under it', async () => {
    const onChange = vi.fn();
    render(<DateField aria-label="d" locale="en-US" defaultValue="2026-01-31" onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('spinbutton')[0]!);
    await userEvent.keyboard('{ArrowUp}');
    // 31 February is not a date; the value must not vanish because of one ArrowUp.
    expect(onChange).toHaveBeenLastCalledWith('2026-02-28');
  });

  it('reports null the moment the entry stops being a whole date', async () => {
    const onChange = vi.fn();
    render(<DateField aria-label="d" locale="en-US" defaultValue="2026-01-31" onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('spinbutton')[2]!);
    await userEvent.keyboard('{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('shows an out-of-range value rather than correcting it, and says which bound it broke', () => {
    render(<DateField aria-label="d" locale="en-US" defaultValue="2020-01-01" min="2026-01-01" />);
    expect(screen.getAllByRole('spinbutton')[0]!).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Earliest allowed date/)).toBeTruthy();
  });
});

describe('DatePicker', () => {
  it('selects a day from the grid and returns focus to the trigger', async () => {
    const onChange = vi.fn();
    render(<DatePicker aria-label="d" locale="en-US" today="2026-03-10" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /calendar/i });
    await userEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('grid')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /March 12, 2026/ }));

    expect(onChange).toHaveBeenLastCalledWith('2026-03-12');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('escape restores the value the field held when the panel opened', async () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        aria-label="d"
        locale="en-US"
        defaultValue="2026-03-01"
        today="2026-03-10"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /calendar/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /March 12, 2026/ }),
    );
    expect(onChange).toHaveBeenLastCalledWith('2026-03-12');

    await userEvent.click(screen.getByRole('button', { name: /calendar/i }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith('2026-03-12');
  });

  it('moves the roving focus a week at a time', async () => {
    render(<DatePicker aria-label="d" locale="en-US" defaultValue="2026-03-10" today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: /calendar/i }));
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      expect.stringContaining('March 10, 2026'),
    );
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      expect.stringContaining('March 17, 2026'),
    );
  });

  it('keeps an unavailable day in the grid, refused rather than removed', async () => {
    render(
      <DatePicker
        aria-label="d"
        locale="en-US"
        defaultValue="2026-03-10"
        today="2026-03-10"
        isDateUnavailable={(iso) => iso === '2026-03-12'}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /calendar/i }));
    const day = within(screen.getByRole('dialog')).getByRole('button', { name: /March 12, 2026/ });
    // aria-disabled, never the native attribute: knowing WHICH days are closed is the information.
    expect(day).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('DateRangePicker', () => {
  it('swaps a range chosen backwards instead of refusing it', async () => {
    const onChange = vi.fn();
    render(<DateRangePicker aria-label="span" locale="en-US" today="2026-03-10" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /calendar/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /March 20, 2026/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /March 5, 2026/ }));
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-03-05', end: '2026-03-20' });
  });

  it('names both halves, so six spinbuttons are two dates and not one', () => {
    render(<DateRangePicker aria-label="span" locale="en-US" />);
    expect(screen.getByRole('group', { name: 'Start date' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'End date' })).toBeTruthy();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(6);
  });
});
