import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';
import styles from './MytrionShell.module.css';

/**
 * The uniform chrome every Mytrion renders into: header (icon + title + skeleton tag), the current
 * user + department scope, a "Switch" link back to the picker, and the Mytrion body as children.
 * Keeps all 8 Mytrions visually consistent and is the single place to evolve shared layout/nav.
 */
export function MytrionShell({ id, children }: { id: MytrionId; children: ReactNode }) {
  const user = useUserContext();
  const m = MYTRIONS[id];
  const scope = m.allDepartments ? 'all departments' : m.department;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.left}>
          <span className={styles.icon} aria-hidden>
            {m.icon}
          </span>
          <h1 className={styles.title}>{m.title}</h1>
          {m.status === 'new' && <span className={styles.tag}>skeleton</span>}
        </div>
        <div className={styles.right}>
          <span className={styles.who}>{user.userName}</span>
          <span className={styles.scope}>scope: {scope}</span>
          <Link className={styles.switch} to="/">
            Switch
          </Link>
        </div>
      </header>
      <main className={styles.body}>{children}</main>
    </div>
  );
}
