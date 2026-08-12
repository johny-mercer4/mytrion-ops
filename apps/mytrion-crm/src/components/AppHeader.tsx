/**
 * The 64px header. One component, both surfaces — inside a workspace and on the launcher.
 *
 * It takes SLOTS rather than booleans. The old TopBar nested four conditionals
 * (`canViewAs && contextBadge && (admin ? … : …)`, `showSwitch && canSwitch`, `showIdentity`) to
 * decide what the corner held, which meant the header had to know each caller's situation. Slots
 * move every one of those decisions to the caller that already knows the answer, and the header
 * owns nothing but layout.
 *
 * Two rules from the shell contract are enforced by shape, not by convention:
 *   - every right-hand control shares ONE `.chip` class, so there is no ghost-versus-filled mix;
 *   - `identity` is a three-way, not a boolean, because "no account control in the header" is a
 *     de-duplication rule ("exactly once per surface") rather than an anti-identity rule. Inside a
 *     workspace the rail foot carries it, so the header passes 'none'. The launcher has no rail, so
 *     it passes 'full' — dropping it there would take the count to zero and strand the account menu
 *     with no trigger anywhere on /main.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type MytrionId } from '../access/mytrions.config';
import { useUserContext } from '../context/UserContextProvider';
import { initials } from '../lib/initials';
import { AccountMenu } from './AccountMenu';
import { GlobalSearch } from './GlobalSearch';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import styles from './AppHeader.module.css';

export interface AppHeaderProps {
  /** The workspace chip. Absent on the launcher, which is not in a workspace. */
  context?: { mytrion: MytrionId } | undefined;
  /** Centre slot. Absent renders no field at all. */
  search?:
    | {
        placeholder: string;
        value: string;
        onChange: (next: string) => void;
        resultLabel?: string | undefined;
      }
    | undefined;
  /** Controls between search and the account cluster — ActAsPicker today, a bell when one exists. */
  actions?: ReactNode;
  /** 'full' name + role + avatar · 'menu' avatar only · 'none' the surface carries it elsewhere. */
  identity: 'full' | 'menu' | 'none';
}

export function AppHeader({ context, search, actions, identity }: AppHeaderProps) {
  const user = useUserContext();
  const displayName = user.userName.trim() || 'Account';
  const roleLine = user.role || user.profile;

  return (
    <header
      className={styles.bar}
      style={{
        boxSizing: 'border-box',
        height: 'calc(64px + var(--layout-safe-t, 0px))',
        paddingTop: 'var(--layout-safe-t, 0px)',
      }}
    >
      {/* The brand signature on every screen: a 1px Horizon ramp under the bottom border. */}
      <span className={styles.hairline} aria-hidden />

      <div className={styles.left}>
        {/* Inside a workspace the wordmark is the way back to the launcher — the shortest path to
            "somewhere else". On the launcher itself there is nowhere to go, so it stays plain text
            rather than a link that reloads the page you are already on. */}
        {context ? (
          <Link to="/main" className={styles.wordmark} aria-label="Mytrion Horizon — all workspaces">
            MYTRION HORIZON
          </Link>
        ) : (
          <span className={styles.wordmark}>MYTRION HORIZON</span>
        )}
        {context ? (
          <>
            <span className={styles.divider} aria-hidden />
            <WorkspaceSwitcher current={context.mytrion} />
          </>
        ) : null}
      </div>

      {search ? (
        <GlobalSearch
          placeholder={search.placeholder}
          value={search.value}
          onChange={search.onChange}
          resultLabel={search.resultLabel}
        />
      ) : null}

      <div className={styles.spacer} />

      <div className={styles.right}>
        {actions}
        {actions ? <span className={styles.divider} aria-hidden /> : null}
        <ThemeToggle className={styles.chip} />
        {identity === 'none' ? null : (
          <AccountMenu
            triggerClassName={`${styles.chip} ${styles.account}`}
            trigger={
              <>
                {identity === 'full' ? (
                  <span className={styles.who}>
                    <span className={styles.name}>{displayName}</span>
                    {roleLine ? <span className={styles.role}>{roleLine}</span> : null}
                  </span>
                ) : null}
                <span className={styles.avatar} aria-hidden>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(displayName)}
                </span>
              </>
            }
          />
        )}
      </div>
    </header>
  );
}
