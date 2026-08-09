import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, agentKeyFor, type MytrionId } from '../../access/mytrions.config';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { AccountMenu } from '../../components/AccountMenu';
import { ActAsPicker } from '../../components/ActAsPicker';
import { AppHeader } from '../../components/AppHeader';
import headerStyles from '../../components/AppHeader.module.css';
import { isAdmin } from '../../access/resolveAccess';
import { initials } from '../../lib/initials';
import { ChatIcon, HomeIcon, SearchIcon } from '../../components/icons';
import styles from './MytrionShell.module.css';

/**
 * Collapsed/expanded is a WORKSPACE preference, not a per-Mytrion one: someone who wants the rail narrow
 * wants it narrow in Sales and in HR. One global key, read through try/catch because storage throws in
 * private mode and a sidebar must never be the reason a page fails to render.
 */
const COLLAPSE_KEY = 'octane.sidebar.collapsed.v1';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
  } catch {
    // A preference that cannot be saved is still a preference that works for this session.
  }
}

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Nested items, revealed while this item (or one of them) is active. Opt-in: an item without
   * children renders exactly as before, so the other Mytrions are unaffected. */
  children?: NavItem[];
  /** Optional keywords for sidebar search (label is always searched). */
  keywords?: string[];
  /**
   * Optional per-item icon colour. A long categorised sidebar is much faster to scan when each
   * destination has its own hue than when fifteen identical grey glyphs sit in a column. Applied as
   * the `--nav-tone` custom property; the label stays on the text scale so only the glyph is tinted.
   *
   * REST STATE ONLY. The selected row overrides it, so one selected row looks the same in every
   * workspace — a per-destination hue there would compete with the gradient rail beside it.
   */
  tone?: string;
  /**
   * Right-aligned count: open tickets, unclaimed carriers, items in a queue. Space Mono with
   * tabular-nums, on the gradient fill. Hidden when the rail is collapsed.
   */
  trailing?: number | string;
  /**
   * The destination exists in the nav but is not built yet: an outlined "Soon" pill, and the row is
   * not clickable. Modules used to fake this by concatenating " · Soon" into the label, which also
   * made the rail's search match on the word "Soon".
   */
  soon?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

function itemMatches(item: NavItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.label, ...(item.keywords ?? []), ...(item.children?.map((c) => c.label) ?? [])]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function filterSections(sections: NavSection[], q: string): NavSection[] {
  if (!q) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => itemMatches(item, q)),
    }))
    .filter((section) => section.items.length > 0);
}

function NavItemButton({
  item,
  chatView,
  collapsed,
  onSelect,
}: {
  item: NavItem;
  chatView: boolean;
  /** Icon-only rail: labels are hidden and nested children are not reachable. */
  collapsed: boolean;
  onSelect: (item: NavItem) => void;
}) {
  const hasChildren = Boolean(item.children?.length);
  // Children are labels in a nested list, which a 64px rail has nowhere to put. The parent still
  // activates on click, so nothing becomes unreachable — it just needs the rail open to navigate into.
  const open =
    hasChildren && !collapsed && (item.active || Boolean(item.children?.some((c) => c.active)));
  const selected = Boolean(item.active) && !chatView && !hasChildren;
  return (
    <div>
      <button
        type="button"
        title={item.soon ? `${item.label} — coming soon` : item.label}
        aria-label={item.label}
        disabled={item.soon ?? false}
        {...(hasChildren ? { 'aria-expanded': open } : {})}
        {...(selected ? { 'aria-current': 'page' as const } : {})}
        className={`${styles.navBtn} ${selected ? styles.navActive : ''} ${
          open && !chatView ? styles.navOpen : ''
        }`}
        {...(item.tone ? { style: { '--nav-tone': item.tone } as CSSProperties } : {})}
        onClick={() => onSelect(item)}
      >
        <span className={styles.navIcon}>{item.icon}</span>
        <span className={styles.navLabel}>{item.label}</span>
        {item.soon ? (
          <span className={styles.navSoon}>Soon</span>
        ) : item.trailing !== undefined && item.trailing !== '' ? (
          <span className={styles.navCount}>{item.trailing}</span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.navSub}>
          {item.children?.map((child) => {
            const childSelected = Boolean(child.active) && !chatView;
            return (
              <button
                key={child.key}
                type="button"
                title={child.label}
                aria-label={child.label}
                {...(childSelected ? { 'aria-current': 'page' as const } : {})}
                className={`${styles.navBtn} ${styles.navSubBtn} ${
                  childSelected ? styles.navSubActive : ''
                }`}
                onClick={() => onSelect(child)}
              >
                <span className={styles.navLabel}>{child.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Mytrion frame: TopBar + a body of [labeled sidebar | center content]. `children` is the center
 * content (the department's panels); `nav` is the module's items (defaults to a single active Home
 * item). Pass `navSections` for categorized Admin-style nav; `enableNavSearch` adds a filter field
 * above the list.
 *
 * CHAT LIVES IN ADMIN ONLY. The sidebar "Chat" item is opt-IN via `enableDockChat` and nothing opts
 * in today, so no department Mytrion shows it. Admin's chat is not this dock at all — it renders
 * `<ChatPanel variant="full" />` as its own page (mytrions/admin/index.tsx).
 *
 * The flag is inverted (opt-in) rather than a `disableDockChat` sprinkled across nine modules: with
 * an opt-out default, every new Mytrion silently ships a chat dock unless its author remembers to
 * turn it off, which is how it ended up on Analytics.
 */
export function MytrionShell({
  id,
  children,
  nav,
  navSections,
  footerNav = [],
  enableNavSearch = false,
  enableDockChat = false,
  contentScroll = 'shell',
}: {
  id: MytrionId;
  children: ReactNode;
  nav?: NavItem[];
  /** Grouped sidebar sections (takes precedence over flat `nav` when provided). */
  navSections?: NavSection[];
  /** Persistent destinations pinned immediately above the signed-in profile. */
  footerNav?: NavItem[];
  /** Show a search field that filters sidebar items by label / keywords. */
  enableNavSearch?: boolean;
  /**
   * Opt IN to the sidebar chat item. Default off — see the note above. Turning this on for a
   * department Mytrion re-exposes that department's scoped agent in the sidebar.
   */
  enableDockChat?: boolean;
  /**
   * Who owns vertical scroll.
   *   'shell'   — the centre pane scrolls. Correct for every module that renders plain panels.
   *   'content' — the centre pane does not scroll and the child owns its own scroller.
   *
   * The second exists for surfaces that virtualise: Billing's ledger measures against a scroll ref,
   * and a second scroll parent silently corrupts its range math, so it renders the wrong rows
   * rather than failing visibly. This is the shell PROP the contract allows in place of a fourth
   * shell — a workspace that needs different chrome does not get its own frame.
   */
  contentScroll?: 'shell' | 'content';
}) {
  const user = useUserContext();
  const m = MYTRIONS[id];
  const department = m.allDepartments ? null : m.department;
  const agentKey = agentKeyFor(id); // department Mytrions → direct-to-child; admin → orchestrator
  const [chatView, setChatView] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  // The header field is separate from the rail's tab filter on purpose — one says "the Horizon
  // ecosystem", the other says "tabs". Nothing consumes this yet; see GlobalSearch.
  const [globalQuery, setGlobalQuery] = useState('');
  const [collapsed, setCollapsed] = useState(readCollapsed);

  // Admins can view-as anyone (the picker fetches the roster); a granted non-admin is handed their
  // scoped list so the SAME control only offers permitted targets. No targets at all -> no control.
  const viewAsTargets = user.viewAsTargets ?? [];
  const viewAs = isAdmin(user) ? (
    <ActAsPicker triggerClassName={headerStyles.chip} />
  ) : viewAsTargets.length > 0 ? (
    <ActAsPicker
      triggerClassName={headerStyles.chip}
      targets={viewAsTargets.map((t) => ({
        zohoUserId: t.zohoUserId,
        name: t.name,
        email: null,
        profile: null,
        role: null,
      }))}
    />
  ) : null;

  const toggleSidebar = useCallback((): void => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      // Drop any filter on the way in. The rail hides the labels the query filters on, so leaving it
      // set would silently hide destinations with nothing on screen explaining why.
      if (next) setNavQuery('');
      return next;
    });
  }, []);

  /**
   * Below 768px the sidebar is a horizontal strip, not a rail (see the media query), so "collapsed" has
   * no meaning there. Force it open on the way down so a preference set on a desktop does not leave a
   * phone with a row of unlabelled icons.
   */
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 768px)');
    const sync = (): void => {
      if (narrow.matches) setCollapsed(false);
      else setCollapsed(readCollapsed());
    };
    sync();
    narrow.addEventListener('change', sync);
    return () => narrow.removeEventListener('change', sync);
  }, []);
  const flatFallback: NavItem[] = nav ?? [
    { key: 'home', label: 'Home', icon: <HomeIcon />, active: true },
  ];
  const sections: NavSection[] = navSections?.length
    ? navSections
    : [{ id: 'main', label: '', items: flatFallback }];
  const q = navQuery.trim().toLowerCase();
  const visibleSections = filterSections(sections, q);
  const showSearch = enableNavSearch || Boolean(navSections?.length);
  const displayName = user.userName.trim() || 'Account';
  const roleLine = [user.profile, user.role].filter(Boolean).join(' · ');

  const select = (item: NavItem) => {
    setChatView(false);
    item.onClick?.();
  };

  return (
    <div
      className={styles.shell}
      data-mytrion={id}
      /* Published on the ROOT, not just the <nav>, so a module's own global stylesheet can respond —
         CSS-module class names are hashed and unreachable from hr.css, but a data attribute is not.
         Modules opt in by writing a rule; none are affected until they do. */
      data-sidebar-collapsed={collapsed ? 'true' : undefined}
    >
      {/* identity="none": the signed-in worker appears once, at the foot of the rail. Two avatars
          on one screen is two answers to "where do I sign out". */}
      <AppHeader
        context={{ mytrion: id }}
        search={{
          placeholder: 'Search the Horizon ecosystem…',
          value: globalQuery,
          onChange: setGlobalQuery,
        }}
        actions={viewAs}
        identity="none"
      />
      {/* Ambient Horizon backdrop — mesh + grid + vignette behind the whole frame, in every
          workspace. This used to be inert unless the module was on the horizonSkin allowlist. */}
      <div className={styles.ambience} aria-hidden="true" />
      <div className={styles.body}>
        <nav
          id="mytrion-sidebar"
          className={styles.sidebar}
          data-collapsed={collapsed ? 'true' : undefined}
          aria-label={`${m.title} navigation`}
        >
          <div className={styles.navTop}>
            <div className={styles.navHead}>
              <button
                type="button"
                className={styles.navToggle}
                aria-expanded={!collapsed}
                aria-controls="mytrion-sidebar"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={toggleSidebar}
              >
                {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              </button>
            </div>
            {showSearch && !collapsed ? (
              <label className={styles.navSearch}>
                <SearchIcon />
                <input
                  type="search"
                  value={navQuery}
                  onChange={(e) => setNavQuery(e.target.value)}
                  placeholder="Search tabs…"
                  aria-label="Search navigation"
                />
              </label>
            ) : null}
            <div className={styles.navGroup}>
              {visibleSections.length === 0 ? (
                <div className={styles.navEmpty}>No tabs match “{navQuery.trim()}”.</div>
              ) : (
                visibleSections.map((section) => (
                  <div key={section.id} className={styles.navSection}>
                    {section.label ? (
                      <div className={styles.navSectionLabel}>{section.label}</div>
                    ) : null}
                    {section.items.map((item) => (
                      <NavItemButton
                        key={item.key}
                        item={item}
                        chatView={chatView}
                        collapsed={collapsed}
                        onSelect={select}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.navFooter}>
            {footerNav.map((item) => (
              <NavItemButton
                key={item.key}
                item={item}
                chatView={chatView}
                collapsed={collapsed}
                onSelect={select}
              />
            ))}
            {enableDockChat && (
              <button
                type="button"
                title="Chat"
                aria-label="Chat"
                className={`${styles.navBtn} ${chatView ? styles.navActive : ''}`}
                onClick={() => setChatView(true)}
              >
                <span className={styles.navIcon}>
                  <ChatIcon />
                </span>
                <span className={styles.navLabel}>Chat</span>
              </button>
            )}
            {/*
              The same menu the header avatar opens, so "where do I sign out" has one answer wherever
              you look. Profile is its first item — this row used to jump straight there.
              Opens UPWARD: it sits at the bottom of the rail.
            */}
            <AccountMenu
              placement="up"
              align="start"
              triggerClassName={styles.userBtn}
              trigger={
                <>
                  <span className={styles.userAvatar} aria-hidden="true">
                    {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(displayName)}
                  </span>
                  <span className={styles.userMeta}>
                    <span className={styles.userName}>{displayName}</span>
                    {roleLine ? <span className={styles.userRole}>{roleLine}</span> : null}
                  </span>
                </>
              }
            />
          </div>
        </nav>

        <div className={styles.center} data-scroll={contentScroll}>
          {chatView ? (
            // A chat crash must never take down the working surface — remount on retry.
            <ErrorBoundary>
              <div className={styles.chatView}>
                <ChatPanel context={user} department={department} agentKey={agentKey} />
              </div>
            </ErrorBoundary>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
