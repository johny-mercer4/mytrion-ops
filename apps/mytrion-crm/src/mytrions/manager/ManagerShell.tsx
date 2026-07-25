import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import { canOpenManagerCard, type ManagerCardId } from './managerNav';
import { ManagerHome } from './ManagerHome';
import { ReferralsCard } from './cards/ReferralsCard';
import './manager.css';

type View = 'home' | ManagerCardId;

/**
 * Manager hub shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell, chat dock disabled.
 * The sidebar is Overview-only: every card is reached through the Overview card grid (not a nav tab).
 * The view switch is guarded by canOpenManagerCard (Layer-2 RBAC).
 */
export function ManagerShell() {
  const user = useUserContext();
  const [view, setView] = useState<View>('home');

  const open = (id: ManagerCardId): void => {
    if (canOpenManagerCard(user, id)) setView(id);
  };

  const nav: NavItem[] = [
    {
      key: 'home',
      label: 'Overview',
      icon: <LayoutGrid size={19} />,
      active: view === 'home',
      onClick: () => setView('home'),
    },
  ];

  return (
    <MytrionShell id="manager" nav={nav} disableDockChat>
      <div className="mg-root">
        {view === 'home' ? <ManagerHome onOpen={open} /> : null}
        {view === 'referrals' ? <ReferralsCard onBack={() => setView('home')} /> : null}
      </div>
    </MytrionShell>
  );
}
