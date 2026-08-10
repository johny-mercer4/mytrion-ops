/**
 * A hand-rolled select has to re-earn everything the native one gave away for free. These pin the
 * behaviours that are easy to ship broken and hard to notice by clicking around: keyboard movement,
 * type-ahead, Escape, and the ARIA wiring a screen reader depends on.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HrSelect, shouldDropUp, type HrSelectOption } from './HrSelect';

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

/**
 * Which way the popup opens, with real geometry.
 *
 * jsdom has no layout — every `getBoundingClientRect()` is zeroes — so a rendered component cannot
 * exercise this at all. Hence a pure function over rects.
 *
 * The bug these pin: the decision used to measure `window.innerHeight`. That is the clipping box only
 * when nothing between the control and the viewport scrolls. `.hr-modal` is
 * `max-height: min(720px, 100%); overflow: auto`, so inside the Add-employee dialog the real bottom
 * edge is the dialog's — and the last field of a 720px modal centred in a 1080px window still has
 * ~180px of viewport under it, which read as "room below" while the modal quietly clipped the list.
 */
describe('shouldDropUp', () => {
  /**
   * "Reporting to": the LAST field of the Add-employee modal.
   *
   * Modal is 720px tall, centred in a 1400px window, so it spans 340–1060 and the field sits at the
   * bottom. Numbers chosen so the two boxes DISAGREE: only 10px of modal below the control, but 350px
   * of viewport. My first attempt used a 1080px window, where the viewport left 188px — under the
   * 288px the popup wants, so the old logic flipped up too and the test proved nothing.
   */
  const inModalBottom = {
    buttonTop: 1018,
    buttonBottom: 1050,
    clipTop: 340,
    clipBottom: 1060,
    optionCount: 140,
  };

  it('opens UP for the last field in a modal', () => {
    expect(shouldDropUp(inModalBottom)).toBe(true);
  });

  it('measuring the viewport instead would have opened DOWN — the reported bug', () => {
    // Same control, viewport as the box: 1400 - 1050 = 350px "available", over the 288px wanted.
    expect(shouldDropUp({ ...inModalBottom, clipBottom: 1400 })).toBe(false);
    // Which is exactly why the box has to be the scroll container, not the window.
    expect(shouldDropUp(inModalBottom)).toBe(true);
  });

  it('opens DOWN for a field at the top of the same modal', () => {
    expect(shouldDropUp({ ...inModalBottom, buttonTop: 380, buttonBottom: 412 })).toBe(false);
  });

  it('opens DOWN when the list is short enough to fit below', () => {
    // Three rows want ~108px, and there are 160px left inside the modal — no reason to flip.
    expect(
      shouldDropUp({ ...inModalBottom, buttonTop: 868, buttonBottom: 900, optionCount: 3 }),
    ).toBe(false);
  });

  it('stays DOWN when there is no more room above than below', () => {
    // Cramped both ways: flipping buys nothing and costs the user their bearings.
    expect(
      shouldDropUp({
        buttonTop: 100,
        buttonBottom: 132,
        clipTop: 90,
        clipBottom: 200,
        optionCount: 40,
      }),
    ).toBe(false);
  });

  it('falls back to the viewport when nothing in the chain scrolls', () => {
    // A control low on an unscrolled page still has to flip.
    expect(
      shouldDropUp({
        buttonTop: 1000,
        buttonBottom: 1032,
        clipTop: 0,
        clipBottom: 1080,
        optionCount: 40,
      }),
    ).toBe(true);
  });
});

/**
 * Entries that are shown but not choosable, and the whole control being inert.
 *
 * Both existed on the native `<select>` and both are load-bearing where the natives were replaced: a
 * department whose lead has no employee row must still NAME that lead (otherwise the field falls back to
 * its placeholder and silently loses the person), the leave approver list shows ineligible colleagues
 * rather than making their records look missing, and the Zoho-user picker must not be operable while its
 * options are still loading.
 */
describe('HrSelect — unchoosable entries', () => {
  const withDisabled: HrSelectOption[] = [
    { value: '', label: '—' },
    { value: 'ghost', label: 'Nodira Yusupova (not linked)', disabled: true },
    { value: 'a', label: 'Abbos Abduroziqov' },
    { value: 'b', label: 'Bekzod Rustamov' },
  ];

  function setupDisabled(value = '', onChange = vi.fn()) {
    render(<HrSelect label="Lead" value={value} options={withDisabled} onChange={onChange} />);
    return { trigger: screen.getByRole('combobox', { name: 'Lead' }), onChange };
  }

  /** The reason the feature exists: the closed field has to name a lead it cannot offer as a choice. */
  it('displays a disabled entry as the current value', () => {
    const { trigger } = setupDisabled('ghost');
    expect(trigger.textContent).toContain('Nodira Yusupova (not linked)');
  });

  it('does not commit when a disabled entry is clicked', () => {
    const { trigger, onChange } = setupDisabled('ghost');
    fireEvent.click(trigger);
    fireEvent.click(within(listbox()).getByText('Nodira Yusupova (not linked)'));
    // Committing it would save the sentinel as if it were a real employee id.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps arrow-key movement over a disabled entry', () => {
    const { trigger, onChange } = setupDisabled('');
    fireEvent.click(trigger);
    // From "—" at index 0, one step down must land on 'a', skipping the ghost at index 1.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('skips a disabled entry in type-ahead', () => {
    const { trigger, onChange } = setupDisabled('');
    fireEvent.click(trigger);
    // "n" matches only the ghost, so nothing should be chosen by it.
    fireEvent.keyDown(trigger, { key: 'n' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalledWith('ghost');
  });

  it('marks it for assistive tech, not only visually', () => {
    const { trigger } = setupDisabled('ghost');
    fireEvent.click(trigger);
    const ghost = within(listbox()).getByText('Nodira Yusupova (not linked)').closest('li');
    expect(ghost).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens on the first choosable entry when the current value is inert', () => {
    const { trigger } = setupDisabled('ghost');
    fireEvent.click(trigger);
    // aria-activedescendant must not point at something Enter would ignore.
    const active = trigger.getAttribute('aria-activedescendant');
    const ghost = within(listbox()).getByText('Nodira Yusupova (not linked)').closest('li');
    expect(active).not.toBe(ghost?.id);
  });
});

describe('HrSelect — disabled control', () => {
  it('will not open, and says so', () => {
    const onChange = vi.fn();
    render(
      <HrSelect label="Zoho user" value="" options={options} onChange={onChange} disabled />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Zoho user' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('will not open from the keyboard either', () => {
    render(<HrSelect label="Zoho user" value="" options={options} onChange={vi.fn()} disabled />);
    const trigger = screen.getByRole('combobox', { name: 'Zoho user' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
