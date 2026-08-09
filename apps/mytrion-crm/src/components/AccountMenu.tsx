/**
 * The signed-in worker's menu: profile and sign out.
 *
 * It owns the profile modal rather than taking a callback, so every trigger gets Profile without
 * each surface keeping its own copy of that state.
 *
 * Theme used to live here as a third row. It is a ThemeToggle in the header now — a preference you
 * judge by looking at the result does not belong two clicks deep, and burying it here is what let
 * the launcher, Billing and CS each grow their own copy of the control.
 *
 * Two items still earn a menu: Sign out should stay a deliberate second step rather than a bare
 * destructive button in the chrome, and Profile needs the modal state this component owns.
 */
import { useState, type ReactNode } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { logout } from '../api/auth';
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
