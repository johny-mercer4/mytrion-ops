/**
 * The workspace chip. It IS the badge — it names the workspace you are in, and opens the list of
 * the ones you can reach.
 *
 * The header used to carry two controls for this: a static context badge on the left and a
 * "Switch Mytrion" link on the right, at opposite ends of the same bar. One chip replaces both, so
 * identity and the control that changes it are the same element.
 *
 * Hosted on DropdownMenu rather than a fresh popover: that component already implements the ARIA
 * menu-button pattern with roving focus, Escape, Tab-closes, and an outside press that dismisses
 * without stealing focus — all of it unit-tested. A second popover implementation is how you get a
 * second set of keyboard bugs.
 *
 * The row is two lines plus a tile, so it does not reuse MenuItem (icon | label | hint, one line):
 * widening MenuItem would reshape every AccountMenu row too.
 */
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import { MYTRIONS, MYTRION_URL_SLUG, type MytrionId } from '../access/mytrions.config';
import { resolveAccessibleMytrions } from '../access/resolveAccess';
import { useUserContext } from '../context/UserContextProvider';
import { MytrionGlyph } from './icons';
import { DropdownMenu } from './DropdownMenu';
import styles from './WorkspaceSwitcher.module.css';

/** "Sales Mytrion" reads as a badge; "Sales" reads as a name. */
export function workspaceName(title: string): string {
  return title.replace(/ Mytrion$/, '');
}

export function WorkspaceSwitcher({ current }: { current: MytrionId }) {
  const user = useUserContext();
  const navigate = useNavigate();
  const { accessible } = resolveAccessibleMytrions(user);
  const meta = MYTRIONS[current];
  const label = workspaceName(meta.title);

  const face = (
    <>
      <span className={styles.tile} aria-hidden>
        <MytrionGlyph name={meta.icon} size={14} />
      </span>
      <span className={styles.name}>{label}</span>
    </>
  );

  // One workspace means there is nowhere to switch to. The chip stays — it is the badge — but it
  // becomes plain text, with no menu semantics for a screen reader to announce and nothing to open.
  if (accessible.length <= 1) {
    return (
      <span className={styles.chip} data-mytrion={current}>
        {face}
      </span>
    );
  }

  return (
    <DropdownMenu
      label={`Workspace: ${label}. Switch workspace`}
      align="start"
      triggerClassName={`${styles.chip} ${styles.interactive}`}
      menuClassName={styles.menu}
      trigger={
        <span className={styles.face} data-mytrion={current}>
          {face}
          <ChevronDown size={16} className={styles.chevron} aria-hidden />
        </span>
      }
    >
      {(close) => (
        <>
          <div className={styles.heading}>Your workspaces</div>
          {accessible.map((id) => {
            const m = MYTRIONS[id];
            const isCurrent = id === current;
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                data-mytrion={id}
                className={`${styles.row} ${isCurrent ? styles.rowCurrent : ''}`}
                onClick={() => {
                  close();
                  // Navigating to the workspace you are already in remounts it and throws its
                  // state away for no gain.
                  if (!isCurrent) navigate(`/main/${MYTRION_URL_SLUG[id]}`);
                }}
              >
                <span className={styles.rowTile} aria-hidden>
                  <MytrionGlyph name={m.icon} size={17} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{workspaceName(m.title)}</span>
                  <span className={styles.rowBlurb}>{m.blurb}</span>
                </span>
                {isCurrent ? <Check size={16} className={styles.rowCheck} aria-hidden /> : null}
              </button>
            );
          })}
        </>
      )}
    </DropdownMenu>
  );
}
