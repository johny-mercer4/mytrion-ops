import { useState } from 'react';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import { accessibleHrTabs, canOpenHrTab, type HrTabId } from './hrNav';
import { HrAttendance } from './tabs/HrAttendance';
import { HrDepartments } from './tabs/HrDepartments';
import { HrEmployees } from './tabs/HrEmployees';
import { HrHome } from './tabs/HrHome';
import { HrOrgStructure } from './tabs/HrOrgStructure';
import { HrRequests } from './tabs/HrRequests';
import { HrSettings } from './tabs/HrSettings';
import './hr.css';
import './hr-workspace.css';
import './hr-attendance.css';
import './hr-leave-settings.css';
import './hr-polish.css';
import './hr-settings-v2.css';

/**
 * HR Mytrion shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell.
 *
 * A flat tab set rather than Manager's card-hub: HR is a workspace you live in, so every destination
 * sits in the sidebar. The signed-in username at the bottom of the shell opens the account profile
 * (not an HR tab). Settings is admin-only.
 *
 * The chat dock is disabled because there is no `hr` department agent on the backend
 * (AGENT_KEYS has no 'hr', and `agentKeyFor('hr')` deliberately returns null).
 *
 * Every view switch goes through the Layer-2 RBAC predicate so stale state can't bypass the sidebar.
 */
export function HrShell() {
  const user = useUserContext();
  const [view, setView] = useState<HrTabId>('home');
  const tabs = accessibleHrTabs(user);
  const settingsTab = tabs.find((tab) => tab.id === 'settings');
  const mainTabs = tabs.filter((tab) => tab.id !== 'settings');

  const open = (id: HrTabId): void => {
    if (canOpenHrTab(user, id)) setView(id);
  };

  const navSections: NavSection[] = [
    {
      id: 'people',
      label: 'People',
      items: mainTabs.map((tab) => ({
        key: tab.id,
        label: tab.soon ? `${tab.label} · Soon` : tab.label,
        icon: <tab.icon size={19} />,
        tone: tab.tone,
        active: view === tab.id,
        onClick: () => open(tab.id),
        keywords: tab.keywords,
      })),
    },
  ];
  const footerNav: NavItem[] = settingsTab
    ? [{
        key: settingsTab.id,
        label: settingsTab.label,
        icon: <settingsTab.icon size={19} />,
        tone: settingsTab.tone,
        active: view === settingsTab.id,
        onClick: () => open(settingsTab.id),
        keywords: settingsTab.keywords,
      }]
    : [];

  return (
    <MytrionShell id="hr" navSections={navSections} footerNav={footerNav} enableNavSearch>
      <div className="hr-root">
        {view === 'home' ? <HrHome onOpen={open} /> : null}
        {view === 'employees' ? <HrEmployees /> : null}
        {view === 'departments' ? <HrDepartments /> : null}
        {view === 'org' ? <HrOrgStructure /> : null}
        {view === 'attendance' ? <HrAttendance /> : null}
        {view === 'requests' ? <HrRequests /> : null}
        {view === 'settings' ? <HrSettings /> : null}
      </div>
    </MytrionShell>
  );
}
