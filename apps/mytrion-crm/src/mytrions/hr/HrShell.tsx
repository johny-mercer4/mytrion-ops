import { useState } from 'react';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { useImpersonation } from '../../context/ImpersonationProvider';
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
 * "VIEW AS" IS A LENS HERE, NOT A LOGIN. Elsewhere in the app the picker re-runs a surface as the
 * chosen agent. HR does not: the act-as headers it sets are ignored by every HR route (they read the
 * session context directly), so pretending the chrome had changed would be a lie about what the data
 * behind it is scoped to. Instead a selection opens that person's RECORD — department, team, attendance,
 * time off — read with the signed-in user's own permissions.
 */
export function HrShell() {
  const user = useUserContext();
  const { actingAs, setActingAs } = useImpersonation();
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
     * The record view took over the whole content area whenever `actingAs` was set, so every sidebar
     * click moved the highlight and changed nothing — the nav looked broken, and the only way out was
     * the "Back to HR" button at the top. A record is scoped to one employee; a nav item is a different
     * subject, so choosing one means leaving.
     */
    setActingAs(null);
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
        {actingAs ? (
          /*
           * Keyed on the person so switching straight from one to another remounts rather than showing
           * the previous employee's team under the new name while the next payload lands.
           */
          <HrPersonView
            key={actingAs.zohoUserId}
            zohoUserId={actingAs.zohoUserId}
            name={actingAs.name}
            subtitle={[actingAs.profile, actingAs.role].filter(Boolean).join(' · ')}
            onExit={() => setActingAs(null)}
            onOpenPerson={(person) =>
              setActingAs({
                zohoUserId: person.zohoUserId,
                name: person.name,
                profile: person.subtitle ?? '',
                role: '',
              })
            }
          />
        ) : (
          <>
            {view === 'home' ? <HrHome onOpen={open} /> : null}
            {view === 'employees' ? <HrEmployees /> : null}
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
