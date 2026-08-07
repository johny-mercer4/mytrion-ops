import { useUserContext } from '../context/UserContextProvider';
import { isAdmin, resolveAccessibleMytrions } from '../access/resolveAccess';
import type { MytrionId } from '../access/mytrions.config';
import { AccountMenu } from './AccountMenu';
import { ActAsPicker } from './ActAsPicker';
import { BrandMark } from './BrandMark';
import { MytrionMenu } from './MytrionMenu';
import { SwitchIcon } from './icons';
import { ChevronDown } from 'lucide-react';
import styles from './TopBar.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The 58px app header. Brand mark + optional context badge on the left; on the right, at most three
 * controls, each of which is a menu.
 *
 * It used to carry five separate things — View as, a Switch Mytrion link, a theme button, an avatar and
 * a Sign out button — strung across the corner. Theme and Sign out now live inside the account menu
 * behind the avatar, and Switch Mytrion opens a workspace list instead of navigating out to the picker.
 * View as stays its own control: it is already a searchable roster popover, and burying a search inside
 * a menu makes it harder to reach, not tidier.
 */
export function TopBar({
  contextBadge,
  mytrion,
  showSwitch = false,
  showIdentity = false,
}: {
  contextBadge?: string;
  /** Which workspace is being viewed — marked as current in the switcher. */
  mytrion?: MytrionId;
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
        {showSwitch && canSwitch && (
          <MytrionMenu
            {...(mytrion ? { current: mytrion } : {})}
            triggerClassName={styles.switch}
            trigger={
              <>
                <SwitchIcon size={13} />
                Switch Mytrion
                <ChevronDown size={13} />
              </>
            }
          />
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
