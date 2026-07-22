import { Link } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { isAdmin, resolveAccessibleMytrions } from '../access/resolveAccess';
import { logout } from '../api/auth';
import { useTheme } from '../hooks/useTheme';
import { ActAsPicker } from './ActAsPicker';
import { BrandMark } from './BrandMark';
import { MoonIcon, SunIcon, SwitchIcon } from './icons';
import { LogOut } from 'lucide-react';
import styles from './TopBar.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The 58px app header. Brand mark + optional context badge on the left; theme toggle + user avatar
 * on the right, with an optional "Switch Mytrion" link (to the picker) and an optional identity block.
 */
export function TopBar({
  contextBadge,
  showSwitch = false,
  showIdentity = false,
}: {
  contextBadge?: string;
  showSwitch?: boolean;
  showIdentity?: boolean;
}) {
  const user = useUserContext();
  const { theme, toggle } = useTheme();

  // Admins can view-as anyone (ActAsPicker fetches the roster). A granted non-admin is handed their
  // scoped target list so the SAME picker only offers the users they're permitted to view as.
  const admin = isAdmin(user);
  const viewAsTargets = user.viewAsTargets ?? [];
  const canViewAs = admin || viewAsTargets.length > 0;
  // "Switch Mytrion" only means something with somewhere else to go — single-Mytrion users
  // (e.g. Sales agents) must not be offered a route back to the picker.
  const canSwitch = resolveAccessibleMytrions(user).accessible.length > 1;

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <BrandMark />
        {contextBadge && <span className={styles.context}>{contextBadge}</span>}
      </div>

      <div className={styles.right}>
        {canViewAs &&
          (admin ? (
            <ActAsPicker />
          ) : (
            <ActAsPicker
              targets={viewAsTargets.map((t) => ({
                zohoUserId: t.zohoUserId,
                name: t.name,
                email: null,
                profile: null,
                role: null,
              }))}
            />
          ))}
        {showSwitch && canSwitch && (
          <Link to="/main" className={styles.switch}>
            <SwitchIcon size={13} />
            Switch Mytrion
          </Link>
        )}
        <button type="button" className={styles.iconBtn} onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <MoonIcon size={15} /> : <SunIcon size={15} />}
        </button>
        {showIdentity && (
          <div className={styles.identity}>
            <div className={styles.name}>{user.userName}</div>
            <div className={styles.role}>{user.role || user.profile}</div>
          </div>
        )}
        <span className={styles.avatar} title={user.userName}>
          {initials(user.userName)}
        </span>
        {user.trusted && (
          <button
            type="button"
            className={`${styles.switch} ${styles.signout}`}
            onClick={logout}
            title="Sign out"
          >
            <LogOut size={14} strokeWidth={2.5} />
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
