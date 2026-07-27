import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import {
  accessibleManagerDepartments,
  canOpenManagerCard,
  canOpenManagerDepartment,
  findManagerDepartment,
  type ManagerCardId,
  type ManagerDepartmentId,
  type ManagerViewId,
} from './managerNav';
import { DepartmentSoon } from './DepartmentSoon';
import { ManagerHome } from './ManagerHome';
import { SalesManagement } from './SalesManagement';
import { LoyaltyCard } from './cards/LoyaltyCard';
import { ReferralsCard } from './cards/ReferralsCard';
import './manager.css';

/**
 * Manager hub shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell, chat dock disabled.
 *
 * The sidebar has two groups: General (Overview) and Departments (one entry each). Overview is also
 * the hub the workspace cards open from (Referrals, Loyalty Program), so those have no nav entry of
 * their own — each opens from the Overview grid and returns there via the back button, and Overview
 * stays selected while you're inside one. Every view switch is guarded by the Layer-2 RBAC predicate
 * so a stale state can't bypass the grid.
 */
export function ManagerShell() {
  const user = useUserContext();
  const [view, setView] = useState<ManagerViewId>('overview');
  const departments = accessibleManagerDepartments(user);

  const openCard = (id: ManagerCardId): void => {
    if (canOpenManagerCard(user, id)) setView(id);
  };

  const openDept = (id: ManagerDepartmentId): void => {
    if (canOpenManagerDepartment(user, id)) setView(id);
  };

  const navSections: NavSection[] = [
    {
      id: 'general',
      label: 'General',
      items: [
        {
          key: 'overview',
          label: 'Overview',
          icon: <LayoutGrid size={19} />,
          tone: 'var(--tone-pink)',
          active: view === 'overview' || view === 'referrals' || view === 'loyalty',
          onClick: () => setView('overview'),
          keywords: ['home', 'hub', 'referrals', 'loyalty', 'tiers'],
        },
      ],
    },
    {
      id: 'departments',
      label: 'Departments',
      items: departments.map((dept) => ({
        key: dept.id,
        label: dept.navLabel,
        icon: <dept.icon size={19} />,
        tone: dept.tone,
        active: view === dept.id,
        onClick: () => openDept(dept.id),
        keywords: [dept.id.replace(/-/g, ' ')],
      })),
    },
  ];

  const activeDept = findManagerDepartment(view);

  return (
    <MytrionShell id="manager" navSections={navSections} enableNavSearch>
      <div className="mg-root">
        {view === 'overview' ? (
          <ManagerHome onOpenCard={openCard} onOpenDepartment={openDept} />
        ) : null}
        {view === 'referrals' ? <ReferralsCard onBack={() => setView('overview')} /> : null}
        {view === 'loyalty' ? <LoyaltyCard onBack={() => setView('overview')} /> : null}
        {activeDept?.id === 'sales' ? <SalesManagement /> : null}
        {activeDept && activeDept.id !== 'sales' ? <DepartmentSoon dept={activeDept} /> : null}
      </div>
    </MytrionShell>
  );
}
