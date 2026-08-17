/**
 * The header contract. Two of these carry rules from the deleted TopBar.test.tsx, because they
 * pinned real regressions rather than markup:
 *   - a single-Mytrion user (a Sales agent) must never be offered a way back to the picker;
 *   - the workspace control must be one press, not a menu in front of a link, which is what it was
 *     before someone flattened it.
 *
 * The third is new and is the reason the header was rebuilt: identity appears exactly once per
 * surface. Inside a workspace the rail foot owns it, so the header must render no account control
 * at all — that invariant is the whole argument for `identity` being a three-way instead of a
 * boolean, and nothing else in the suite would notice it breaking.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const user = {
  userId: 'zoho:1',
  profile: 'Sales Agent',
  role: 'Agent',
  userName: 'Jane Doe',
  trusted: true,
};

let accessible: string[] = ['sales', 'billing'];

vi.mock('../context/UserContextProvider', () => ({
  useUserContext: () => user,
  useRealUserContext: () => user,
}));
vi.mock('../access/resolveAccess', () => ({
  isAdmin: () => false,
  resolveAccessibleMytrions: () => ({ accessible, homeMytrion: null }),
}));
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../mytrions/_shared/UserProfileModal', () => ({ UserProfileModal: () => <div /> }));

import { AppHeader } from './AppHeader';

function renderHeader(props: Partial<React.ComponentProps<typeof AppHeader>> = {}) {
  return render(
    <MemoryRouter>
      <AppHeader context={{ mytrion: 'sales' }} identity="none" {...props} />
    </MemoryRouter>,
  );
}

describe('AppHeader', () => {
  it('makes the workspace badge the switcher when there is somewhere to go', () => {
    accessible = ['sales', 'billing'];
    renderHeader();

    const chip = screen.getByRole('button', { name: /Workspace: Sales\. Switch workspace/ });
    expect(chip).toHaveAttribute('aria-haspopup', 'menu');
    // One press opens the list. It used to be a badge on the left plus a separate "Switch Mytrion"
    // link on the right — two controls at opposite ends of the same bar for one idea.
    expect(screen.queryByRole('link', { name: /switch/i })).not.toBeInTheDocument();
  });

  it('degrades the badge to plain text for a single-workspace user', () => {
    accessible = ['sales'];
    renderHeader();

    // Still named — it is the badge — but with no menu semantics and nothing to open. A Sales agent
    // with one workspace must never be handed a route back to the picker.
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /switch/i })).not.toBeInTheDocument();
  });

  it('renders no account control inside a workspace', () => {
    accessible = ['sales', 'billing'];
    renderHeader({ identity: 'none' });

    // The rail foot owns identity there. Two avatars on one screen is two answers to "where do I
    // sign out", which is exactly what this header used to ship.
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument();
  });

  it('renders identity on a surface that has no rail', () => {
    accessible = ['sales', 'billing'];
    renderHeader({ context: undefined, identity: 'full' });

    // The launcher: exactly once is still once. Removing it here would take the count to zero and
    // strand sign-out with no trigger anywhere on /main.
    expect(screen.getByRole('button', { name: /account menu for Jane Doe/i })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders the search field only when the caller supplies the slot', () => {
    accessible = ['sales', 'billing'];
    const { unmount } = renderHeader();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    unmount();

    renderHeader({
      search: { placeholder: 'Search the Horizon ecosystem…', value: '', onChange: vi.fn() },
    });
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
});
