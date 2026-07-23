import { useState, type ReactNode } from 'react';
import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, agentKeyFor, type MytrionId } from '../../access/mytrions.config';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { TopBar } from '../../components/TopBar';
import { ChatIcon, HomeIcon } from '../../components/icons';
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
}

/**
 * The Mytrion frame: TopBar + a body of [labeled sidebar | center content]. The department's scoped
 * AI chat is a sidebar item ("Chat") that takes over the center when selected — no longer a permanent
 * dock. `children` is the center content (the department's panels); `nav` is the module's items
 * (defaults to a single active Home item).
 */
export function MytrionShell({
  id,
  children,
  nav,
  disableDockChat = false,
}: {
  id: MytrionId;
  children: ReactNode;
  nav?: NavItem[];
  disableDockChat?: boolean;
}) {
  const user = useUserContext();
  const m = MYTRIONS[id];
  const department = m.allDepartments ? null : m.department;
  const agentKey = agentKeyFor(id); // department Mytrions → direct-to-child; admin → orchestrator
  const [chatView, setChatView] = useState(false);
  const items: NavItem[] = nav ?? [{ key: 'home', label: 'Home', icon: <HomeIcon />, active: true }];

  return (
    <div className={styles.shell} data-mytrion={id}>
      <TopBar contextBadge={m.tag} showSwitch />
      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label={`${m.title} navigation`}>
          <div className={styles.navGroup}>
            {items.map((item) => {
              const select = (i: NavItem) => () => {
                setChatView(false);
                i.onClick?.();
              };
              const hasChildren = Boolean(item.children?.length);
              // A parent stays open while it or any of its children is the current view — the
              // sub-items are where the work happens, so collapsing them under the user is wrong.
              const open = hasChildren && (item.active || Boolean(item.children?.some((c) => c.active)));
              // Exactly one row may read as selected. A parent with children isn't a destination —
              // clicking it lands on a child — so it gets the quieter "you are in here" treatment
              // and the child keeps the accent. Leaf items are unchanged.
              const selected = Boolean(item.active) && !chatView && !hasChildren;
              return (
                <div key={item.key}>
                  <button
                    type="button"
                    title={item.label}
                    aria-label={item.label}
                    {...(hasChildren ? { 'aria-expanded': open } : {})}
                    {...(selected ? { 'aria-current': 'page' as const } : {})}
                    className={`${styles.navBtn} ${selected ? styles.navActive : ''} ${
                      open && !chatView ? styles.navOpen : ''
                    }`}
                    onClick={select(item)}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </button>
                  {open && (
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
                            onClick={select(child)}
                          >
                            <span className={styles.navLabel}>{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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
