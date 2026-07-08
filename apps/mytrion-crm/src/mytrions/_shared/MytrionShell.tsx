import { type ReactNode, useState } from 'react';
import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, agentKeyFor, type MytrionId } from '../../access/mytrions.config';
import { ChatLauncher } from '../../features/chat/ChatLauncher';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { TopBar } from '../../components/TopBar';
import { HomeIcon, PanelToggleIcon } from '../../components/icons';
import styles from './MytrionShell.module.css';

const RAIL_COLLAPSE_KEY = 'mytrion.railCollapsed';

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

/**
 * The Mytrion frame: TopBar + a body of [icon nav rail | center content], full width always — AI
 * Chat is a floating launcher (bottom-right) that opens as a modal, so it never costs the content
 * any width. `children` is the center content (the department's panels); `nav` is the left rail
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
  const items: NavItem[] = nav ?? [{ key: 'home', label: 'Home', icon: <HomeIcon />, active: true }];

  // Labeled by default (nobody should have to hover-to-guess what an icon means); collapsible to
  // the old icon-only rail for anyone who wants the width back. One shared preference — same
  // rail component, every module.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_COLLAPSE_KEY) === '1');
  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem(RAIL_COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  }

  return (
    <div className={styles.shell}>
      <TopBar contextBadge={m.tag} showSwitch />
      <div className={styles.body}>
        <nav className={`${styles.rail} ${collapsed ? styles.railCollapsed : ''}`}>
          <div className={styles.railItems}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                title={item.label}
                aria-label={item.label}
                className={`${styles.railBtn} ${item.active ? styles.railActive : ''}`}
                onClick={item.onClick}
              >
                {item.icon}
                {!collapsed && <span className={styles.railLabel}>{item.label}</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.railCollapseBtn}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          >
            <PanelToggleIcon size={13} {...(collapsed ? {} : { style: { transform: 'rotate(180deg)' } })} />
            {!collapsed && <span className={styles.railLabel}>Collapse</span>}
          </button>
        </nav>

        <div className={styles.center}>{children}</div>
      </div>

      {/* A chat crash must never take down the working surface — remount on retry. Fixed-position
          launcher, deliberately outside .body so it never participates in the flex layout. */}
      <ErrorBoundary>
        <ChatLauncher
          context={user}
          department={department}
          agentKey={agentKey}
          popoutHref={`/m/${id}/chat`}
        />
      </ErrorBoundary>
    </div>
  );
}
