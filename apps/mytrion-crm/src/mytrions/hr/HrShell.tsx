import { useState } from 'react';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import { HrPersonView } from './HrPersonView';
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
import './hr-attendance-v2.css';

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
 *
 * OPENING A PERSON'S RECORD is HR's OWN local state — not the global "View as". They used to share the
 * impersonation slot, which was safe only while act-as was scoped per-Mytrion; now that "View as" is a
 * global RBAC preview, a person record is plainly a different thing (a subject you READ with your own
 * permissions, not an identity you become), so it lives here. The employee list opens one via
 * `onOpenRecord`; the record reads through admin/HR endpoints, unaffected by any act-as.
 */
export function HrShell() {
  const user = useUserContext();
  /** The employee record open over the workspace, or null. HR's own state — see the note above. */
  const [openPerson, setOpenPerson] = useState<{
    zohoUserId: string;
    name: string;
    subtitle: string | null;
  } | null>(null);
  const tabs = accessibleHrTabs(user);
  /**
   * The first tab this person can actually open, not always Home.
   *
   * A team lead reaches HR for Attendance alone, so Home is not in their nav — and Home reads the
   * employee directory, which their session is refused. Landing them there showed an error page in a
   * workspace whose only working screen was one click away and unmarked.
   */
  const [view, setView] = useState<HrTabId>(() => tabs[0]?.id ?? 'attendance');
  const settingsTab = tabs.find((tab) => tab.id === 'settings');
  const mainTabs = tabs.filter((tab) => tab.id !== 'settings');

  const open = (id: HrTabId): void => {
    if (!canOpenHrTab(user, id)) return;
    /**
     * Leave the person record when a nav item is chosen.
     *
     * The record view takes over the whole content area whenever one is open, so every sidebar click
     * would otherwise move the highlight and change nothing. A record is scoped to one employee; a nav
     * item is a different subject, so choosing one means leaving.
     */
    setOpenPerson(null);
    setView(id);
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
        primary: tab.id === 'home' || tab.id === 'employees' || tab.id === 'attendance' || tab.id === 'requests',
      })),
    },
  ];
  const footerNav: NavItem[] = settingsTab
    ? [
        {
          key: settingsTab.id,
          label: settingsTab.label,
          icon: <settingsTab.icon size={19} />,
          tone: settingsTab.tone,
          active: view === settingsTab.id,
          onClick: () => open(settingsTab.id),
          keywords: settingsTab.keywords,
        },
      ]
    : [];

  return (
    <MytrionShell id="hr" navSections={navSections} footerNav={footerNav} enableNavSearch>
      <div className="hr-root">
        {openPerson ? (
          /*
           * Keyed on the person so switching straight from one to another remounts rather than showing
           * the previous employee's team under the new name while the next payload lands.
           */
          <HrPersonView
            key={openPerson.zohoUserId}
            zohoUserId={openPerson.zohoUserId}
            name={openPerson.name}
            subtitle={openPerson.subtitle ?? ''}
            onExit={() => setOpenPerson(null)}
            onOpenPerson={(person) => setOpenPerson(person)}
          />
        ) : (
          <>
            {view === 'home' ? <HrHome onOpen={open} /> : null}
            {view === 'employees' ? <HrEmployees onOpenRecord={setOpenPerson} /> : null}
            {view === 'departments' ? <HrDepartments /> : null}
            {view === 'org' ? <HrOrgStructure /> : null}
            {view === 'attendance' ? <HrAttendance /> : null}
            {view === 'requests' ? <HrRequests /> : null}
            {view === 'settings' ? <HrSettings /> : null}
          </>
        )}
      </div>
    </MytrionShell>
  );
}
