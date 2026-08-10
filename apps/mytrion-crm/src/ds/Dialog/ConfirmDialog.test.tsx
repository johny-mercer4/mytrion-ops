/**
 * The confirmation contract.
 *
 * Ported from `admin/ConfirmDialog.test.tsx`, which was deleted along with the two duplicate
 * implementations it covered. The behaviour it pinned is safety-critical and belongs on the
 * component that now does the work for all seven call sites — dropping the coverage with the
 * duplicate would have been the expensive half of that cleanup.
 *
 * One case is deliberately NOT ported: "keeps Tab inside the dialog". The focus trap is now the
 * browser's, supplied by `showModal()`, and jsdom implements neither the trap nor the top layer
 * (see src/test/dialog.ts). A test asserting it here would pass against the stub and prove nothing.
 * That property is verified in a real browser instead.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const base = {
  open: true,
  title: 'Revoke this account?',
  body: 'The carrier loses access to the mini app immediately.',
  confirmLabel: 'Revoke',
};

describe('ConfirmDialog', () => {
  it('names the action on both buttons rather than a generic OK/Cancel', () => {
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  /**
   * Users confirm dialogs by reflex — Enter lands before the eye finishes the sentence — so
   * autofocusing a destructive button turns that reflex into data loss.
   */
  it('opens with Cancel focused when the action is destructive', () => {
    render(<ConfirmDialog {...base} tone="danger" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('confirms and dismisses through the right handlers', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} tone="danger" onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * A DELIBERATE DIVERGENCE from the component this replaced, and worth stating rather than
   * quietly inheriting: the old one disabled Cancel and swallowed Escape while the action was in
   * flight. ds keeps both live, because a request that hangs would otherwise leave the user with a
   * modal and no way out — the escape hatch must not be disabled along with everything else. The
   * confirm button carries the in-flight state on its own.
   */
  it('keeps the escape hatch live while the action is in flight', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} confirming onConfirm={vi.fn()} onClose={onClose} />);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledWith('cancel');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows the in-flight state on the confirm button only', () => {
    render(<ConfirmDialog {...base} confirming onConfirm={vi.fn()} onClose={vi.fn()} />);
    // Button's `loading` disables it and keeps its measured width, so the dialog does not resize
    // under the cursor mid-click.
    expect(screen.getByRole('button', { name: /Revoke/ })).toBeDisabled();
  });

  it('announces the consequence with the title, not only the heading', () => {
    // role=alertdialog + aria-describedby is what makes a screen reader read the body on open,
    // instead of announcing "dialog, Revoke this account?" and leaving the stakes to be discovered.
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(base.body);
  });
});
