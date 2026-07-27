import { useState } from 'react';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import { accessibleHrTabs, canOpenHrTab, type HrTabId } from './hrNav';
import { HrAttendance } from './tabs/HrAttendance';
import { HrEmployees } from './tabs/HrEmployees';
import { HrHome } from './tabs/HrHome';
import { HrProfile } from './tabs/HrProfile';
import { HrRequests } from './tabs/HrRequests';
import './hr.css';

/**
 * HR Mytrion shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell.
 *
 * A flat tab set rather than Manager's card-hub: HR is a workspace you live in, so every destination
 * sits in the sidebar. Home doubles as a launcher for people who arrive there first.
 *
 * Every tab except Home is unbuilt and says so via the shared <ComingSoon /> — none of them render
 * invented employees, attendance or requests.
 *
 * The chat dock is disabled because there is no `hr` department agent on the backend
 * (AGENT_KEYS has no 'hr', and `agentKeyFor('hr')` deliberately returns null) — an enabled dock
 * would silently fall through to the orchestrator. Re-enable when an HR agent exists.
 *
 * Every view switch goes through the Layer-2 RBAC predicate so stale state can't bypass the sidebar.
 */
export function HrShell() {
  const user = useUserContext();
  const [view, setView] = useState<HrTabId>('home');
  const tabs = accessibleHrTabs(user);

  const open = (id: HrTabId): void => {
    if (canOpenHrTab(user, id)) setView(id);
  };

  const navSections: NavSection[] = [
    {
      id: 'people',
      label: 'People',
      items: tabs.map((tab) => ({
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

  return (
    <MytrionShell id="hr" navSections={navSections} enableNavSearch>
      <div className="hr-root">
        {view === 'home' ? <HrHome onOpen={open} /> : null}
        {view === 'employees' ? <HrEmployees /> : null}
        {view === 'attendance' ? <HrAttendance /> : null}
        {view === 'requests' ? <HrRequests /> : null}
        {view === 'profile' ? <HrProfile /> : null}
      </div>
    </MytrionShell>
  );
}
