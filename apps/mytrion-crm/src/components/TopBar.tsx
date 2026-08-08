import { Link } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { isAdmin, resolveAccessibleMytrions } from '../access/resolveAccess';
import { AccountMenu } from './AccountMenu';
import { ActAsPicker } from './ActAsPicker';
import { BrandMark } from './BrandMark';
import { SwitchIcon } from './icons';
import styles from './TopBar.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The 58px app header. Brand mark + optional context badge on the left; on the right, View as (inside
 * a Mytrion), Switch Mytrion, and the account menu behind the avatar.
 *
 * It used to carry five separate things — View as, a Switch Mytrion link, a theme button, an avatar and
 * a Sign out button — strung across the corner. Theme and Sign out now live inside the account menu.
 * View as stays its own control: it is already a searchable roster popover, and burying a search inside
 * a menu makes it harder to reach, not tidier. Switch Mytrion is a plain link back to the picker.
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
        {/* View-as only inside a Mytrion shell (contextBadge). Never on the /main picker. */}
        {canViewAs &&
          contextBadge &&
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
        {/* Goes straight to the picker. It used to open a workspace dropdown, but the control reads as
            "take me back to the front door" — so a menu in front of that is a step, not a shortcut. */}
        {showSwitch && canSwitch && (
          <Link
            to="/main"
            className={styles.switch}
            title="Switch Mytrion"
            aria-label="Switch Mytrion"
          >
            <SwitchIcon size={13} />
            Switch Mytrion
          </Link>
        )}
        {showIdentity && (
          <div className={styles.identity}>
            <div className={styles.name}>{user.userName}</div>
            <div className={styles.role}>{user.role || user.profile}</div>
          </div>
        )}
        <AccountMenu
          triggerClassName={styles.avatarBtn}
          trigger={
            <span className={styles.avatar}>
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className={styles.avatarImg} />
              ) : (
                initials(user.userName)
              )}
            </span>
          }
        />
      </div>
    </header>
  );
}
