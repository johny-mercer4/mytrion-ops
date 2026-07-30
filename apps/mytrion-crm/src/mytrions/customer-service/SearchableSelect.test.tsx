/**
 * The filterable owner select.
 *
 * It replaced a native `<select>` because 16 owners cannot be scanned, and a native select cannot be
 * typed past its first letter. The behaviours worth pinning are the ones a user would notice
 * immediately if they broke: prefix matches ranking above mid-string ones, Enter picking what is
 * actually highlighted, and Escape closing the panel WITHOUT also closing the surrounding modal.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchableSelect, type SelectOption } from './SearchableSelect';

/**
 * Fixture names are chosen for the properties the tests measure, not for realism:
 *   'Mara Lopez'  STARTS WITH "ma"  → must rank first for that query
 *   'Tamara Diaz' merely CONTAINS "ma" → must rank after it
 *   'Sam Patel'   supplies a distinct surname for the case-insensitivity check
 */
const OWNERS: SelectOption[] = [
  { value: 'u1', label: 'Mara Lopez', hint: '40' },
  { value: 'u2', label: 'Sam Patel', hint: '30' },
  { value: 'u3', label: 'Tamara Diaz', hint: '20' },
  { value: 'u4', label: 'Robin Chen', hint: '10' },
];

function setup(value = '', onChange = vi.fn()) {
  const utils = render(
    <div className="cs-root">
      <SearchableSelect
        value={value}
        options={OWNERS}
        placeholder="Search owner…"
        allLabel="Anyone"
        onChange={onChange}
      />
    </div>,
  );
  const input = screen.getByRole('combobox');
  return { ...utils, input, onChange };
}

const optionLabels = () =>
  Array.from(document.querySelectorAll('.cs-ss-item-label')).map((e) => e.textContent);

describe('filtering', () => {
  it('shows every option plus the clear row on focus', () => {
    const { input } = setup();
    fireEvent.focus(input);
    expect(optionLabels()).toEqual(['Anyone', 'Mara Lopez', 'Sam Patel', 'Tamara Diaz', 'Robin Chen']);
  });

  it('ranks PREFIX matches above mid-string ones', () => {
    // "ma" matches Mara Lopez (prefix) and Tamara Diaz (mid-string). Typing a name's start should not bury
    // it under a coincidental substring hit.
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ma' } });
    expect(optionLabels()).toEqual(['Anyone', 'Mara Lopez', 'Tamara Diaz']);
  });

  it('is case-insensitive', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'PATEL' } });
    expect(optionLabels()).toEqual(['Anyone', 'Sam Patel']);
  });

  it('says so when nothing matches, rather than showing an empty panel', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText(/No match for/)).toBeTruthy();
  });

  it('renders the hint (case count) alongside each option', () => {
    const { input } = setup();
    fireEvent.focus(input);
    expect(Array.from(document.querySelectorAll('.cs-ss-item-hint')).map((e) => e.textContent)).toEqual(
      ['40', '30', '20', '10'],
    );
  });
});

describe('selection', () => {
  it('commits the clicked option and closes', () => {
    const { input, onChange } = setup();
    fireEvent.focus(input);
    fireEvent.pointerDown(screen.getByText('Sam Patel'));
    expect(onChange).toHaveBeenCalledWith('u2');
    expect(document.querySelector('.cs-ss-list')).toBeNull();
  });

  it('shows the selected label when closed, not the raw value', () => {
    setup('u1');
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'Mara Lopez');
  });

  it('clears via the × and reports an empty value', () => {
    const { onChange } = setup('u1');
    fireEvent.pointerDown(screen.getByLabelText('Clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('offers no × when nothing is selected', () => {
    setup('');
    expect(screen.queryByLabelText('Clear')).toBeNull();
  });
});

describe('keyboard', () => {
  it('ArrowDown then Enter picks the FILTERED first option, not the original first', () => {
    // The regression this guards: filtering without resetting the highlight makes Enter commit a row
    // the user can no longer see.
    const { input, onChange } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ma' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // Anyone -> Mara Lopez
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('u1');
  });

  it('Enter on the first row selects "Anyone" (clears the filter)', () => {
    const { input, onChange } = setup('u1');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not walk past either end of the list', () => {
    const { input, onChange } = setup();
    fireEvent.focus(input);
    for (let i = 0; i < 10; i++) fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(''); // clamped at the top row
  });

  it('Escape closes the panel and does NOT bubble to the surrounding modal', () => {
    // A bubbling Escape here would dismiss the whole filter rail or a parent modal.
    const onParentKeyDown = vi.fn();
    render(
      <div className="cs-root" onKeyDown={onParentKeyDown}>
        <SearchableSelect value="" options={OWNERS} placeholder="p" allLabel="Anyone" onChange={vi.fn()} />
      </div>,
    );
    const input = screen.getAllByRole('combobox')[0]!;
    fireEvent.focus(input);
    expect(document.querySelector('.cs-ss-list')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.querySelector('.cs-ss-list')).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it('reopens on ArrowDown after being closed', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.querySelector('.cs-ss-list')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.querySelector('.cs-ss-list')).not.toBeNull();
  });
});
