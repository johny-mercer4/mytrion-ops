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
}: {
  id: MytrionId;
  children: ReactNode;
  nav?: NavItem[];
}) {
  const user = useUserContext();
  const m = MYTRIONS[id];
  const department = m.allDepartments ? null : m.department;
  const agentKey = agentKeyFor(id); // department Mytrions → direct-to-child; admin → orchestrator
  const [chatView, setChatView] = useState(false);
  const items: NavItem[] = nav ?? [{ key: 'home', label: 'Home', icon: <HomeIcon />, active: true }];

  return (
    <div className={styles.shell}>
      <TopBar contextBadge={m.tag} showSwitch />
      <div className={styles.body}>
        <nav className={styles.sidebar}>
          <div className={styles.navGroup}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                title={item.label}
                aria-label={item.label}
                className={`${styles.navBtn} ${item.active && !chatView ? styles.navActive : ''}`}
                onClick={() => {
                  setChatView(false);
                  item.onClick?.();
                }}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
              </button>
            ))}
          </div>

          <div className={styles.navGroup}>
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
