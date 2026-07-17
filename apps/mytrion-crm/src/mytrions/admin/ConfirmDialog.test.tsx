import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

function setup(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Cancel this invite?"
      body="The link stops working the moment you confirm."
      confirmLabel="Cancel invite"
      cancelLabel="Keep invite"
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('names the action on both buttons rather than a generic OK/Cancel', () => {
    setup();

    expect(screen.getByRole('alertdialog', { name: 'Cancel this invite?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel invite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep invite' })).toBeInTheDocument();
  });

  // A destructive dialog that opens with the destructive button focused turns a stray Enter into
  // a revoked account.
  it('opens with the dismiss button focused, not the confirm button', () => {
    setup();

    expect(screen.getByRole('button', { name: 'Keep invite' })).toHaveFocus();
  });

  it('confirms and dismisses through the right handlers', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel invite' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep invite' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    setup();

    const keep = screen.getByRole('button', { name: 'Keep invite' });
    const confirm = screen.getByRole('button', { name: 'Cancel invite' });

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(keep).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  // Once the request is away, Escape can't un-send it — the dialog shouldn't pretend otherwise.
  it('ignores Escape and disables both buttons while the action is in flight', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup({ busy: true });

    expect(screen.getByRole('button', { name: 'Keep invite' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('restores focus to the trigger on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ConfirmDialog title="t" body="b" confirmLabel="Go" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(trigger).not.toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
