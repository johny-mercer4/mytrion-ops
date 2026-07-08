import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ElicitationPicker } from './ElicitationPicker';

const options = [
  { label: 'Acme', value: 'acme' },
  { label: 'Globex', value: 'globex' },
  { label: 'Initech', value: 'initech' },
];

describe('single-select', () => {
  it('sends the pick immediately and focuses the first option on mount', async () => {
    const onPick = vi.fn();
    render(
      <ElicitationPicker
        elicitation={{ prompt: 'Which client?', multiSelect: false, options }}
        onPick={onPick}
      />,
    );
    expect(screen.getByRole('button', { name: /acme/i })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /globex/i }));
    expect(onPick).toHaveBeenCalledWith('globex');
  });
});

describe('multiSelect', () => {
  it('toggles options with aria-pressed and confirms the joined values', async () => {
    const onPick = vi.fn();
    render(
      <ElicitationPicker
        elicitation={{ prompt: 'Pick clients', multiSelect: true, options }}
        onPick={onPick}
      />,
    );
    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /acme/i }));
    await userEvent.click(screen.getByRole('button', { name: /initech/i }));
    expect(screen.getByRole('button', { name: /acme/i })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onPick).toHaveBeenCalledWith('acme, initech');
  });

  it('deselects on second click', async () => {
    const onPick = vi.fn();
    render(
      <ElicitationPicker elicitation={{ prompt: 'Pick', multiSelect: true, options }} onPick={onPick} />,
    );
    const acme = screen.getByRole('button', { name: /acme/i });
    await userEvent.click(acme);
    await userEvent.click(acme);
    expect(acme).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });
});
