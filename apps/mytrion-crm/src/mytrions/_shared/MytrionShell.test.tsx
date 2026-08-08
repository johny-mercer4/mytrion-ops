/**
 * The collapsible sidebar. This is shared chrome — every Mytrion renders it — so the contract is worth
 * pinning: the preference survives a remount, collapsing hides the labels rather than the destinations,
 * and it never leaves a narrow viewport showing a column of unlabelled icons.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../context/UserContextProvider', () => ({
  useUserContext: () => ({
    userId: 'zoho:1',
    profile: 'Administrator',
    role: 'CEO',
    userName: 'Shohruh Bekmurodov',
    trusted: true,
    allDepartmentAccess: true,
  }),
}));
// Stubbed because the real header pulls in the workspace switcher (router), the view-as picker
// (session/API) and the theme toggle. The rail is what is under test.
// NOTE: vi.mock on a path nothing imports fails SILENTLY — it simply stops applying and the real
// component mounts. If these eight cases start failing together after a rename, check this line
// before anything else.
vi.mock('../../components/AppHeader', () => ({ AppHeader: () => <div /> }));
// The sidebar's user row is an AccountMenu, which reads the theme. No ThemeProvider in this harness —
// the shell's own behaviour is what is under test, not the account menu's.
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('../../features/chat/ChatPanel', () => ({ ChatPanel: () => <div /> }));
vi.mock('./UserProfileModal', () => ({ UserProfileModal: () => <div /> }));

import { MytrionShell, type NavSection } from './MytrionShell';

const sections: NavSection[] = [
  {
    id: 'people',
    label: 'People',
    items: [
      { key: 'home', label: 'Home', icon: <i />, active: true },
      { key: 'employees', label: 'Employees', icon: <i /> },
    ],
  },
];

function renderShell() {
  return render(
    <MytrionShell id="hr" navSections={sections} enableNavSearch>
      <div>content</div>
    </MytrionShell>,
  );
}

const toggle = (): HTMLElement =>
  screen.getByRole('button', { name: /(Collapse|Expand) sidebar/ });

const KEY = 'octane.sidebar.collapsed.v1';

/**
 * A real storage stub. This jsdom exposes `localStorage` as a bare object with no Storage prototype, so
 * neither `.clear()` nor a `Storage.prototype` spy exists to work with — the test has to supply its own.
 */
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

beforeEach(() => {
  installStorage();
  // jsdom has no matchMedia; the shell asks it whether the viewport is a narrow strip.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as never;
});

describe('MytrionShell — sidebar collapse', () => {
  it('starts expanded and reports its state to assistive tech', () => {
    renderShell();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveAttribute('aria-controls', 'mytrion-sidebar');
    expect(screen.getByText('Employees')).toBeInTheDocument();
  });

  /**
   * `data-collapsed` on the <nav> is what every rail style hangs off. Asserting only the button's ARIA
   * would let the attribute silently stop being emitted, killing the whole stylesheet while the suite
   * stayed green.
   */
  /**
   * The centre pane's width rule lives in a module's own global stylesheet (hr.css), which cannot see
   * hashed CSS-module class names — it keys off this root attribute. If it stopped being published, the
   * rail would still collapse but the page would keep its measure cap and just gain empty margin.
   */
  it('publishes the rail state on the shell root for global stylesheets', () => {
    const { container } = renderShell();
    const shell = container.firstElementChild!;
    expect(shell).not.toHaveAttribute('data-sidebar-collapsed');

    fireEvent.click(toggle());
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it('drives the rail styles by flipping data-collapsed on the nav', () => {
    renderShell();
    const nav = document.getElementById('mytrion-sidebar')!;
    expect(nav).not.toHaveAttribute('data-collapsed');

    fireEvent.click(toggle());
    expect(nav).toHaveAttribute('data-collapsed', 'true');

    fireEvent.click(toggle());
    expect(nav).not.toHaveAttribute('data-collapsed');
  });

  /**
   * Labels go, destinations stay. Collapsing must never remove a way to navigate — the buttons keep
   * their accessible names so the rail is still usable by keyboard and screen reader.
   */
  it('keeps every destination reachable when collapsed', () => {
    renderShell();
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Employees' })).toBeInTheDocument();
    // The search filters on labels the rail no longer shows, so it goes with them.
    expect(screen.queryByLabelText('Search navigation')).toBeNull();
  });

  it('remembers the preference across a remount', () => {
    const first = renderShell();
    fireEvent.click(toggle());
    first.unmount();

    renderShell();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears a stale filter on the way in', () => {
    renderShell();
    fireEvent.change(screen.getByLabelText('Search navigation'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No tabs match/)).toBeInTheDocument();

    fireEvent.click(toggle()); // collapse
    fireEvent.click(toggle()); // and back out

    // Without the reset the rail would reopen still filtered to nothing.
    expect(screen.queryByText(/No tabs match/)).toBeNull();
    expect(screen.getByText('Employees')).toBeInTheDocument();
  });

  it('forces itself open on a narrow viewport, whatever the stored preference says', () => {
    installStorage().set(KEY, '1');
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true, // (max-width: 768px)
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as never;

    renderShell();
    // Under 768px the sidebar is a horizontal strip; a rail of unlabelled icons is not a thing there.
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('survives storage being unavailable', () => {
    // Private mode throws on read AND write. A sidebar preference must never be why a page fails.
    installStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });

    expect(() => {
      renderShell();
      fireEvent.click(toggle());
    }).not.toThrow();
    // The toggle still works for this session; it just cannot be remembered for the next one.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks an unbuilt destination without pretending it is a queue', () => {
    // Modules used to fake this by concatenating " · Soon" into the label, which also made the
    // rail's own search match on the word "Soon".
    render(
      <MytrionShell
        id="hr"
        navSections={[
          {
            id: 'x',
            label: 'Work',
            items: [
              { key: 'home', label: 'Home', icon: <i />, active: true },
              { key: 'tickets', label: 'Tickets', icon: <i />, soon: true },
              { key: 'inbox', label: 'Inbox', icon: <i />, trailing: 7 },
            ],
          },
        ]}
      >
        <div />
      </MytrionShell>,
    );

    const soon = screen.getByRole('button', { name: 'Tickets' });
    expect(soon).toBeDisabled();
    expect(soon).toHaveTextContent('Soon');
    // The accessible name stays the destination, so a screen reader is not told "Tickets Soon".
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveTextContent('7');
  });
});
