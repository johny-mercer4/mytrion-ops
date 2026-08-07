/**
 * The signed-in worker's menu: profile, theme, sign out.
 *
 * Rendered in TWO places — behind the header avatar and on the sidebar's user row — because those were
 * two different answers to the same question. The header held the actions while the rail's user button
 * jumped straight to the profile modal, so "where do I sign out" depended on which one you happened to
 * look at. One menu, two triggers.
 *
 * It owns the profile modal rather than taking a callback, so both triggers get Profile without the
 * shell and the header each keeping their own copy of that state.
 */
import { useState, type ReactNode } from 'react';
import { LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { logout } from '../api/auth';
import { useTheme } from '../hooks/useTheme';
import { useUserContext } from '../context/UserContextProvider';
import { UserProfileModal } from '../mytrions/_shared/UserProfileModal';
import { DropdownMenu, MenuItem, MenuSeparator } from './DropdownMenu';

export function AccountMenu({
  trigger,
  triggerClassName,
  placement = 'down',
  align = 'end',
}: {
  trigger: ReactNode;
  triggerClassName?: string | undefined;
  placement?: 'down' | 'up' | undefined;
  align?: 'start' | 'end' | undefined;
}) {
  const user = useUserContext();
  const { theme, toggle } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const displayName = user.userName.trim() || 'Account';

  return (
    <>
      <DropdownMenu
        label={`Account menu for ${displayName}`}
        trigger={trigger}
        triggerClassName={triggerClassName}
        placement={placement}
        align={align}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<UserRound size={15} />}
              onSelect={() => {
                close();
                setProfileOpen(true);
              }}
            >
              Profile
            </MenuItem>
            <MenuItem
              icon={theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
              hint={theme === 'dark' ? 'Dark' : 'Light'}
              onSelect={() => {
                // Deliberately does NOT close: switching theme is something you judge by looking at the
                // result, and having the menu vanish under you makes a second try a second hunt.
                toggle();
              }}
            >
              Theme
            </MenuItem>
            {user.trusted ? (
              <>
                <MenuSeparator />
                <MenuItem danger icon={<LogOut size={15} />} onSelect={logout}>
                  Sign out
                </MenuItem>
              </>
            ) : null}
          </>
        )}
      </DropdownMenu>
      {profileOpen ? <UserProfileModal onClose={() => setProfileOpen(false)} /> : null}
    </>
  );
}
