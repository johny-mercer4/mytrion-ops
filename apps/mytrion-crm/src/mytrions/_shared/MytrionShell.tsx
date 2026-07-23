import { useState, type ReactNode } from 'react';
import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, agentKeyFor, type MytrionId } from '../../access/mytrions.config';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { TopBar } from '../../components/TopBar';
import { ChatIcon, HomeIcon, SearchIcon } from '../../components/icons';
import styles from './MytrionShell.module.css';

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
  onSelect,
}: {
  item: NavItem;
  chatView: boolean;
  onSelect: (item: NavItem) => void;
}) {
  const hasChildren = Boolean(item.children?.length);
  const open = hasChildren && (item.active || Boolean(item.children?.some((c) => c.active)));
  const selected = Boolean(item.active) && !chatView && !hasChildren;
  return (
    <div>
      <button
        type="button"
        title={item.label}
        aria-label={item.label}
        {...(hasChildren ? { 'aria-expanded': open } : {})}
        {...(selected ? { 'aria-current': 'page' as const } : {})}
        className={`${styles.navBtn} ${selected ? styles.navActive : ''} ${
          open && !chatView ? styles.navOpen : ''
        }`}
        onClick={() => onSelect(item)}
      >
        <span className={styles.navIcon}>{item.icon}</span>
        <span className={styles.navLabel}>{item.label}</span>
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
 * The Mytrion frame: TopBar + a body of [labeled sidebar | center content]. The department's scoped
 * AI chat is a sidebar item ("Chat") that takes over the center when selected — no longer a permanent
 * dock. `children` is the center content (the department's panels); `nav` is the module's items
 * (defaults to a single active Home item). Pass `navSections` for categorized Admin-style nav;
 * `enableNavSearch` adds a filter field above the list.
 */
export function MytrionShell({
  id,
  children,
  nav,
  navSections,
  enableNavSearch = false,
  disableDockChat = false,
}: {
  id: MytrionId;
  children: ReactNode;
  nav?: NavItem[];
  /** Grouped sidebar sections (takes precedence over flat `nav` when provided). */
  navSections?: NavSection[];
  /** Show a search field that filters sidebar items by label / keywords. */
  enableNavSearch?: boolean;
  disableDockChat?: boolean;
}) {
  const user = useUserContext();
  const m = MYTRIONS[id];
  const department = m.allDepartments ? null : m.department;
  const agentKey = agentKeyFor(id); // department Mytrions → direct-to-child; admin → orchestrator
  const [chatView, setChatView] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const flatFallback: NavItem[] = nav ?? [
    { key: 'home', label: 'Home', icon: <HomeIcon />, active: true },
  ];
  const sections: NavSection[] = navSections?.length
    ? navSections
    : [{ id: 'main', label: '', items: flatFallback }];
  const q = navQuery.trim().toLowerCase();
  const visibleSections = filterSections(sections, q);
  const showSearch = enableNavSearch || Boolean(navSections?.length);

  const select = (item: NavItem) => {
    setChatView(false);
    item.onClick?.();
  };

  return (
    <div className={styles.shell} data-mytrion={id}>
      <TopBar contextBadge={m.tag} showSwitch />
      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label={`${m.title} navigation`}>
          <div className={styles.navTop}>
            {showSearch ? (
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
                        onSelect={select}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.navGroup}>
            {!disableDockChat && (
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
          </div>
        </nav>

        <div className={styles.center}>
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
