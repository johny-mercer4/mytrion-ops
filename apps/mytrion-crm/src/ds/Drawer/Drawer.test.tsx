/**
 * ds/Drawer had no test. It is the app's only finished bottom sheet (Drawer.module.css turns it into
 * a block-end sheet below the structure line) and it is about to carry the mobile nav, so the
 * contract is worth pinning — especially the parts that only work because it is a native <dialog>.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';

function Harness({ onClose = vi.fn(), dismissible = true }: { onClose?: (r: string) => void; dismissible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <Drawer
      open={open}
      dismissible={dismissible}
      onClose={(reason) => {
        onClose(reason);
        if (dismissible) setOpen(false);
      }}
      title="Go to"
    >
      <button type="button">Data Center</button>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('opens the native dialog and names itself from the title', () => {
    render(<Harness />);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    // aria-labelledby -> the title, so a screen reader announces what this is before its contents.
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)).toHaveTextContent('Go to');
    expect(screen.getByRole('button', { name: 'Data Center' })).toBeInTheDocument();
  });

  it('reports Escape as a close REQUEST without closing itself', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('escape');
  });

  it('swallows Escape when it is not dismissible', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} dismissible={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks page scroll while open and restores it on close', () => {
    const { unmount } = render(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
