/**
 * The menu primitive. Shared chrome — the header and the sidebar both hang off it — and almost all of
 * its behaviour is keyboard, which is the part nobody notices is broken by clicking around.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenu, MenuItem } from './DropdownMenu';

function setup(onA = vi.fn()) {
  render(
    <DropdownMenu label="Account" trigger={<span>Open</span>}>
      {(close) => (
        <>
          <MenuItem onSelect={() => { onA(); close(); }}>Profile</MenuItem>
          <MenuItem onSelect={close}>Theme</MenuItem>
          <MenuItem onSelect={close}>Sign out</MenuItem>
        </>
      )}
    </DropdownMenu>,
  );
  return { trigger: screen.getByRole('button', { name: 'Account' }), onA };
}

describe('DropdownMenu', () => {
  it('is a collapsed menu button until opened', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click without stealing focus from the pointer', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // A mouse user's focus should stay where they put it; only the keyboard path moves into the menu.
    expect(document.activeElement).not.toBe(screen.getAllByRole('menuitem')[0]);
  });

  /** The distinction from a listbox: for a MENU, focus moves onto the commands. */
  it('moves focus into the menu when opened by keyboard', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  it('arrows between items and clamps at both ends', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const items = screen.getAllByRole('menuitem');

    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'ArrowUp' });
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  /** Escape must hand focus back, or a keyboard user is dumped at the top of the document. */
  it('closes on Escape and returns focus to the trigger', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Tab but lets focus travel onward', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    // Not yanked back to the trigger — Tab means "I am moving on".
    expect(document.activeElement).not.toBe(trigger);
  });

  it('runs an item and closes', () => {
    const { trigger, onA } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(onA).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside press without stealing focus back', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    // Focus must not be dragged to the trigger — the pointer is already headed elsewhere.
    expect(document.activeElement).not.toBe(trigger);
  });

  it('toggles shut when the trigger is clicked again', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
