/**
 * Jump straight to another workspace.
 *
 * "Switch Mytrion" used to be a link out to the picker: two navigations and a full page of cards to
 * cross in order to reach a place you had already decided on. The picker is still the right front door
 * when you are choosing; this is the shortcut for when you are not.
 *
 * Only ever lists what `resolveAccessibleMytrions` grants — the same resolver the router gates on, so
 * the menu cannot offer a door that then refuses to open. The current workspace is marked and inert.
 */
import { useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { MYTRIONS, MYTRION_URL_SLUG, type MytrionId } from '../access/mytrions.config';
import { resolveAccessibleMytrions } from '../access/resolveAccess';
import { useUserContext } from '../context/UserContextProvider';
import { MytrionGlyph } from './icons';
import { DropdownMenu, MenuItem, MenuSeparator } from './DropdownMenu';

export function MytrionMenu({
  current,
  trigger,
  triggerClassName,
  placement = 'down',
  align = 'end',
}: {
  /** The workspace being viewed, marked in the list. Absent on the picker itself. */
  current?: MytrionId | undefined;
  trigger: React.ReactNode;
  triggerClassName?: string | undefined;
  placement?: 'down' | 'up' | undefined;
  align?: 'start' | 'end' | undefined;
}) {
  const user = useUserContext();
  const navigate = useNavigate();
  const { accessible } = resolveAccessibleMytrions(user);

  return (
    <DropdownMenu
      label="Switch workspace"
      trigger={trigger}
      triggerClassName={triggerClassName}
      placement={placement}
      align={align}
    >
      {(close) => (
        <>
          {accessible.map((id) => {
            const meta = MYTRIONS[id];
            const isCurrent = id === current;
            return (
              <MenuItem
                key={id}
                icon={<MytrionGlyph name={meta.icon} size={15} />}
                hint={isCurrent ? 'Current' : undefined}
                onSelect={() => {
                  close();
                  // Navigating to where you already are would remount the workspace and throw away its
                  // state for no reason.
                  if (!isCurrent) navigate(`/main/${MYTRION_URL_SLUG[id]}`);
                }}
              >
                {meta.title}
              </MenuItem>
            );
          })}
          <MenuSeparator />
          <MenuItem
            icon={<LayoutGrid size={15} />}
            onSelect={() => {
              close();
              navigate('/main');
            }}
          >
            All workspaces
          </MenuItem>
        </>
      )}
    </DropdownMenu>
  );
}
