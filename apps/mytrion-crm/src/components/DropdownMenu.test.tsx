/**
 * The menu primitive. Shared chrome — the header and the sidebar both hang off it — and almost all of
 * its behaviour is keyboard, which is the part nobody notices is broken by clicking around.
 *
 * The second block covers the panel being PORTALLED to <body>. That was a bug fix, and a portal is
 * easy to break in ways these keyboard tests would not notice: the outside-press listener tests
 * whether the target is inside the trigger's subtree, and the panel is no longer in it.
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


/**
 * Reported from the running app: with the sidebar collapsed to 68px, opening the account menu from
 * the rail showed a sliced-off panel — "Pro…" and "Sig…" — with Profile and Sign out unreachable.
 * The cause was `position: absolute` inside `.sidebar`, which sets `overflow: hidden` because it
 * animates its own width and has to clip the labels while it does.
 *
 * jsdom does no layout, so this cannot assert the panel is VISIBLE. What it can assert is the
 * structural property that makes clipping impossible: the panel is not a descendant of whatever
 * contains the trigger.
 */
describe('DropdownMenu — panel placement', () => {
  function inClipper(onSelect = vi.fn()) {
    const view = render(
      <div style={{ overflow: 'hidden' }} data-testid="clipper">
        <DropdownMenu label="Account" trigger={<span>JM</span>} placement="up" align="start">
          {(close) => (
            <MenuItem
              onSelect={() => {
                onSelect();
                close();
              }}
            >
              Profile
            </MenuItem>
          )}
        </DropdownMenu>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    return { ...view, onSelect, menu: screen.getByRole('menu') };
  }

  it('renders the panel outside any clipping ancestor', () => {
    const { getByTestId, menu } = inClipper();
    expect(getByTestId('clipper').contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  it('positions itself in viewport coordinates', () => {
    const { menu } = inClipper();
    // `fixed`, not `absolute`: an absolutely-positioned panel resolves against an offset parent that
    // may be the very element clipping it.
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.bottom).not.toBe('');
    expect(menu.style.left).not.toBe('');
  });

  it('still treats a press on an item as inside', () => {
    // The dismiss listener tested only `rootRef.contains(target)`. Portalling moves the panel out of
    // that subtree, so without also testing the menu ref the first press on Profile would close the
    // menu instead of choosing it.
    const { onSelect } = inClipper();
    const item = screen.getByRole('menuitem', { name: 'Profile' });
    fireEvent.pointerDown(item);
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing behind in <body> on unmount', () => {
    const { unmount } = inClipper();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    unmount();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(0);
  });
});
