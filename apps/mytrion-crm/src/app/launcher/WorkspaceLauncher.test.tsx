/**
 * The launcher. Three of these pin things nothing else in the suite can see:
 *
 * - `data-mytrion` on the card is the ONLY thing making the tile's colour agree with the workspace
 *   you land in. If it silently stops being emitted every card renders generic and no other test
 *   notices, because jsdom computes nothing from CSS Modules.
 * - "Last active" must be a link, not a label. That is what the design's featured third card is for,
 *   and it only works because the id is stored rather than the display name.
 * - Storage throws in private mode; a convenience stat must never be why /main fails to render.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../context/UserContextProvider', () => ({
  useUserContext: () => ({
    userId: 'zoho:1',
    profile: 'Administrator',
    role: 'CEO',
    userName: 'Jane Doe',
    trusted: true,
  }),
}));
vi.mock('../../components/AppHeader', () => ({
  AppHeader: ({ search }: { search?: { value: string; onChange: (v: string) => void } }) =>
    search ? (
      <input
        aria-label="Search"
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
      />
    ) : null,
}));

import { WorkspaceLauncher } from './WorkspaceLauncher';
import { readLastWorkspace, rememberWorkspace } from './lastWorkspace';

function installStorage(impl?: Partial<Storage>): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      ...impl,
    },
  });
  return store;
}

const renderLauncher = () =>
  render(
    <MemoryRouter>
      <WorkspaceLauncher ids={['sales', 'billing', 'hr']} />
    </MemoryRouter>,
  );

beforeEach(() => void installStorage());

describe('WorkspaceLauncher', () => {
  it('renders one card per accessible workspace, carrying its identity', () => {
    const { container } = renderLauncher();

    expect(screen.getByRole('link', { name: /Sales/ })).toHaveAttribute(
      'href',
      '/main/salesmytrion',
    );
    // --badge-tone is inherited from this attribute. Without it the card is generic and the launcher
    // stops agreeing with the header badge you land on — the exact bug this redesign fixes.
    expect(container.querySelector('[data-mytrion="billing"]')).toBeInTheDocument();
    expect(container.querySelector('[data-mytrion="hr"]')).toBeInTheDocument();
  });

  it('filters the grid and says so out loud', () => {
    renderLauncher();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'billing' } });

    expect(screen.getByRole('link', { name: /Billing/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Sales/ })).not.toBeInTheDocument();
  });

  it('offers a way out when nothing matches, rather than a blank section', () => {
    renderLauncher();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzzz' } });

    expect(screen.getByText(/No workspace matches/)).toBeInTheDocument();
  });

  it('makes Last active a link once there is somewhere to go', () => {
    renderLauncher();
    // Nothing stored on a first visit: a quiet placeholder, and not a link to nowhere.
    expect(screen.getByText('Last active').closest('a')).toBeNull();

    rememberWorkspace('billing');
    renderLauncher();
    expect(screen.getAllByText('Last active')[1]!.closest('a')).toHaveAttribute(
      'href',
      '/main/billingmytrion',
    );
  });

  it('reports how many workspaces the user can reach, not how many exist', () => {
    renderLauncher();
    // Replaces a "Departments" stat that rendered the identical number to this one on every load.
    expect(screen.getByText(/^3 of \d+$/)).toBeInTheDocument();
  });

  it('renders when storage is unavailable', () => {
    installStorage({
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => renderLauncher()).not.toThrow();
  });
});

describe('lastWorkspace', () => {
  it('round-trips an id', () => {
    installStorage();
    rememberWorkspace('hr');
    expect(readLastWorkspace()).toBe('hr');
  });

  it('rejects a v1 display label rather than handing back a bogus id', () => {
    // v1 stored "Billing"; indexing MYTRIONS with it yields undefined and crashes the card.
    installStorage().set('mytrion.horizon.lastWorkspace.v2', 'Billing');
    expect(readLastWorkspace()).toBeNull();
  });

  it('never throws out of a failed write', () => {
    installStorage({
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => rememberWorkspace('sales')).not.toThrow();
  });
});
