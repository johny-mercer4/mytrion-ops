import { type ReactNode } from 'react';
import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, agentKeyFor, type MytrionId } from '../../access/mytrions.config';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { TopBar } from '../../components/TopBar';
import { HomeIcon } from '../../components/icons';
import styles from './MytrionShell.module.css';

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

/**
 * The Mytrion frame (design 1c): TopBar + a body of [icon nav rail | center content | docked AI chat].
 * The chat dock is always present, scoped to this Mytrion's department. `children` is the center
 * content (the department's panels); `nav` is the left rail (defaults to a single active Home item).
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

  return (
    <div className={styles.shell}>
      <TopBar contextBadge={m.tag} showSwitch />
      <div className={styles.body}>
        <nav className={styles.rail}>
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
            </button>
          ))}
        </nav>

        <div className={styles.center}>{children}</div>

        <ChatPanel context={user} department={department} agentKey={agentKey} />
      </div>
    </div>
  );
}
