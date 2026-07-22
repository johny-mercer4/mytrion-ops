import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioToggleGroup } from './RadioToggleGroup';

const OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'driver', label: 'Driver' },
  { value: 'both', label: 'Both' },
] as const;

function setup(value: 'owner' | 'driver' | 'both' = 'owner') {
  const onChange = vi.fn();
  render(<RadioToggleGroup label="Account type" value={value} options={OPTIONS} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe('RadioToggleGroup', () => {
  it('exposes a labelled radiogroup with the checked state on each option', () => {
    setup('driver');

    expect(screen.getByRole('radiogroup', { name: 'Account type' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Driver' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Owner' })).not.toBeChecked();
  });

  // The bug this component exists for: role="radio" promises arrow-key navigation, and the old
  // markup made every option a separate tab stop with no key handling at all.
  it('is a single tab stop landing on the checked option', async () => {
    const { user } = setup('driver');

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Driver' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Owner' })).not.toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Both' })).not.toHaveFocus();
  });

  it('selects with arrow keys in both directions', async () => {
    const { onChange, user } = setup('driver');
    screen.getByRole('radio', { name: 'Driver' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('both');

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('owner');

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('both');
  });

  it('wraps around at both ends', async () => {
    const { onChange, user } = setup('owner');
    screen.getByRole('radio', { name: 'Owner' }).focus();

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('both');
  });

  it('jumps to the ends with Home and End', async () => {
    const { onChange, user } = setup('driver');
    screen.getByRole('radio', { name: 'Driver' }).focus();

    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('owner');

    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('both');
  });

  it('still selects on click', async () => {
    const { onChange, user } = setup('owner');

    await user.click(screen.getByRole('radio', { name: 'Both' }));
    expect(onChange).toHaveBeenCalledWith('both');
  });
});
