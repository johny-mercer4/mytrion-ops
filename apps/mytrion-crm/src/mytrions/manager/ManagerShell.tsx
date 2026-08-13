import { useCallback, useEffect, useState } from 'react';
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
import { readManagerUrlState, writeManagerUrlState } from './managerUrlState';
import { DepartmentDesk } from './DepartmentDesk';
import { ManagerHome } from './ManagerHome';
import { EfsConsoleCard } from './cards/EfsConsoleCard';
import { AnnouncementsWorkspace } from './announcements/AnnouncementsWorkspace';
import { isEfsTab, type EfsTabId } from './cards/efs/efsModel';
import { MYTRION_URL_SLUG } from '../../access/mytrions.config';
import { canAccess } from '../../access/resolveAccess';
// Shared with the Marketing Mytrion, which renders the same `.mg-root` chrome. hubTheme declares the
// --mg-* / --hz-* token layer and is documented as loading last.
import '../_shared/hub/hubChrome.css';
import '../_shared/hub/hubWorkspace.css';
import '../_shared/hub/hubChips.css';
import '../_shared/hub/hubDialog.css';
import '../_shared/hub/hubTheme.css';

const CARD_IDS: readonly ManagerCardId[] = ['efs', 'announcements'];

/**
 * Referrals and Loyalty moved to the Marketing Mytrion. Their `?card=` links were pasted into
 * tickets and chats for months, and ManagerShell's unknown-view fallback would land every one of
 * them silently on Overview. Redirect instead — for the population that holds those links, the
 * workspace they want is one they can almost certainly still reach.
 */
const MOVED_TO_MARKETING: Record<string, string> = { referrals: 'referrals', loyalty: 'loyalty' };

/**
 * Manager hub shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell, chat dock disabled.
 *
 * The sidebar has two groups: General (Overview) and Departments (one entry each). Overview is also
 * the hub the workspace cards open from (Referrals, Loyalty Program, EFS Console), so those have no
 * nav entry of their own — each opens from the Overview grid and returns there via the back button,
 * and Overview stays selected while you're inside one. Every view switch is guarded by the Layer-2
 * RBAC predicate so a stale state can't bypass the grid.
 *
 * View state lives in the QUERY STRING (`?card=efs&carrier=5724546&tab=cards`), so a reload lands
 * where you were and a carrier view can be pasted into a ticket. See managerUrlState.ts.
 */
export function ManagerShell() {
  const user = useUserContext();
  const departments = accessibleManagerDepartments(user);

  // Seed from the URL so a pasted link opens its view directly rather than flashing Overview.
  const [view, setView] = useState<ManagerViewId>(() => {
    const { view: raw } = readManagerUrlState();
    if (!raw) return 'overview';
    if (CARD_IDS.includes(raw as ManagerCardId) && canOpenManagerCard(user, raw as ManagerCardId)) {
      return raw as ManagerCardId;
    }
    if (findManagerDepartment(raw) && canOpenManagerDepartment(user, raw as ManagerDepartmentId)) {
      return raw as ManagerDepartmentId;
    }
    return 'overview';
  });
  const [efsCarrier, setEfsCarrier] = useState<string | null>(() => {
    const { carrier } = readManagerUrlState();
    return carrier && /^\d{1,20}$/.test(carrier) ? carrier : null;
  });
  const [efsTab, setEfsTab] = useState<EfsTabId>(() => {
    const { tab } = readManagerUrlState();
    return tab && isEfsTab(tab) ? tab : 'overview';
  });

  /**
   * Forward an old `?card=referrals` / `?card=loyalty` link to the Marketing Mytrion.
   *
   * `replace`, not `push`, so Back does not bounce the visitor straight into the redirect again.
   * A user who cannot enter Marketing falls through to the existing unknown-view fallback and lands
   * on Overview — the same place they would have landed without this, just without the detour.
   */
  useEffect(() => {
    const moved = MOVED_TO_MARKETING[readManagerUrlState().view ?? ''];
    if (!moved || !canAccess(user, 'marketing')) return;
    window.location.replace(`/main/${MYTRION_URL_SLUG.marketing}?tab=${moved}`);
  }, [user]);

  /** A view change is a new page (Back returns here); a tab or carrier change is not. */
  const sync = useCallback(
    (next: { view: ManagerViewId; carrier: string | null; tab: EfsTabId }, mode: 'push' | 'replace') => {
      writeManagerUrlState(
        {
          view: next.view === 'overview' ? null : next.view,
          carrier: next.view === 'efs' ? next.carrier : null,
          tab: next.view === 'efs' && next.carrier ? next.tab : null,
        },
        mode,
      );
    },
    [],
  );

  const go = useCallback(
    (next: ManagerViewId) => {
      setView(next);
      sync({ view: next, carrier: next === 'efs' ? efsCarrier : null, tab: efsTab }, 'push');
    },
    [efsCarrier, efsTab, sync],
  );

  const selectCarrier = useCallback(
    (carrierId: string | null) => {
      setEfsCarrier(carrierId);
      // Opening a carrier IS a navigation — Back should return to the roster.
      sync({ view: 'efs', carrier: carrierId, tab: efsTab }, 'push');
    },
    [efsTab, sync],
  );

  const selectTab = useCallback(
    (tab: EfsTabId) => {
      setEfsTab(tab);
      sync({ view: 'efs', carrier: efsCarrier, tab }, 'replace');
    },
    [efsCarrier, sync],
  );

  // Browser Back/Forward must move the view, not just the address bar.
  useEffect(() => {
    const onPop = (): void => {
      const state = readManagerUrlState();
      const raw = state.view;
      if (!raw) setView('overview');
      else if (CARD_IDS.includes(raw as ManagerCardId) && canOpenManagerCard(user, raw as ManagerCardId)) {
        setView(raw as ManagerCardId);
      } else if (findManagerDepartment(raw) && canOpenManagerDepartment(user, raw as ManagerDepartmentId)) {
        setView(raw as ManagerDepartmentId);
      } else setView('overview');
      setEfsCarrier(state.carrier && /^\d{1,20}$/.test(state.carrier) ? state.carrier : null);
      setEfsTab(state.tab && isEfsTab(state.tab) ? state.tab : 'overview');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [user]);

  const openCard = (id: ManagerCardId): void => {
    if (canOpenManagerCard(user, id)) go(id);
  };

  const openDept = (id: ManagerDepartmentId): void => {
    if (canOpenManagerDepartment(user, id)) go(id);
  };

  // Each workspace is a page transition even though the shell stays mounted. Reset the shell's
  // scroll positions so a card opened from lower on Overview never lands beneath the fixed top bar.
  // Narrow layouts scroll the document; desktop layouts scroll the module root.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('.mg-root')?.scrollTo({ top: 0 });
  }, [view, efsCarrier]);

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
          active: view === 'overview' || CARD_IDS.includes(view as ManagerCardId),
          onClick: () => go('overview'),
          keywords: ['home', 'hub', 'efs', 'fuel', 'cards', 'announcements', 'communications'],
          primary: true,
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
        primary: dept.id === 'sales' || dept.id === 'customer-service' || dept.id === 'billing',
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
        {view === 'efs' ? (
          <EfsConsoleCard
            onBack={() => go('overview')}
            carrierId={efsCarrier}
            tab={efsTab}
            onSelect={selectCarrier}
            onTab={selectTab}
          />
        ) : null}
        {view === 'announcements' ? (
          <AnnouncementsWorkspace onBack={() => go('overview')} />
        ) : null}
        {activeDept ? <DepartmentDesk dept={activeDept} /> : null}
      </div>
    </MytrionShell>
  );
}
