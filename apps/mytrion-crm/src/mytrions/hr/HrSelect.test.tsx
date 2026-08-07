/**
 * A hand-rolled select has to re-earn everything the native one gave away for free. These pin the
 * behaviours that are easy to ship broken and hard to notice by clicking around: keyboard movement,
 * type-ahead, Escape, and the ARIA wiring a screen reader depends on.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HrSelect, type HrSelectOption } from './HrSelect';

const options: HrSelectOption[] = [
  { value: '', label: 'All departments' },
  { value: 'a', label: 'Analytics' },
  { value: 'b', label: 'Billing & Accounting' },
  // Two options sharing a first letter — required for the type-ahead test below to mean anything.
  { value: 'can', label: 'Canada Sales Team' },
  { value: 'c', label: 'Corporate Culture' },
];

function setup(value = '', onChange = vi.fn()) {
  render(<HrSelect label="Department" value={value} options={options} onChange={onChange} />);
  return { trigger: screen.getByRole('combobox', { name: 'Department' }), onChange };
}

const listbox = () => screen.getByRole('listbox');

describe('HrSelect', () => {
  it('is a labelled, collapsed combobox until opened', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the selected option label, not the raw value', () => {
    setup('b');
    expect(screen.getByRole('combobox').textContent).toContain('Billing & Accounting');
  });

  it('opens on click and marks the current value as selected', () => {
    const { trigger } = setup('a');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const chosen = within(listbox()).getByRole('option', { selected: true });
    expect(chosen).toHaveTextContent('Analytics');
  });

  it('moves with arrows and commits on Enter', () => {
    const { trigger, onChange } = setup('', vi.fn());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // opens, active = current (index 0)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // → Analytics
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  /** Focus never leaves the trigger, so the active option has to be announced by id. */
  it('points aria-activedescendant at the active option', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const active = trigger.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveTextContent('All departments');
  });

  it('clamps at the ends rather than wrapping', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    // Wrapping would make "am I at the end?" unanswerable without counting.
    const active = trigger.getAttribute('aria-activedescendant')!;
    expect(document.getElementById(active)).toHaveTextContent('Corporate Culture');
  });

  it('jumps to a match on type-ahead, and selects directly when closed', () => {
    const { trigger, onChange } = setup('', vi.fn());
    fireEvent.keyDown(trigger, { key: 'c' });
    // First match wins, exactly as a native select does.
    expect(onChange).toHaveBeenCalledWith('can');
  });

  /**
   * "c" then "o" must mean "co" (Corporate), not two independent jumps to the first "c" and then a
   * miss on "o". Both options starting with 'c' is what makes the two behaviours distinguishable —
   * with a single 'c' option this assertion passes either way and tests nothing.
   */
  it('accumulates type-ahead across keystrokes', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'c' });
    fireEvent.keyDown(trigger, { key: 'o' });
    const active = trigger.getAttribute('aria-activedescendant')!;
    expect(document.getElementById(active)).toHaveTextContent('Corporate Culture');
  });

  it('closes on Escape without changing the value', () => {
    const { trigger, onChange } = setup('a', vi.fn());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Tab so the list never hangs open behind the next control', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes when a pointer lands outside it', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('commits a click on an option', () => {
    const { trigger, onChange } = setup('', vi.fn());
    fireEvent.click(trigger);
    fireEvent.click(within(listbox()).getByRole('option', { name: /Corporate Culture/ }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('refuses to open with nothing to show', () => {
    const onChange = vi.fn();
    render(<HrSelect label="Empty" value="" options={[]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Empty' });
    fireEvent.click(trigger);
    // An empty popup is worse than none: it looks like a load that failed.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('falls back to the placeholder when the value matches no option', () => {
    render(
      <HrSelect label="Stale" value="deleted-id" options={options} onChange={vi.fn()} placeholder="Pick one" />,
    );
    expect(screen.getByRole('combobox').textContent).toContain('Pick one');
  });
});
