/**
 * Marketing Mytrion shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell.
 *
 * Two nav rows, no hub page: Referral Program and Loyalty Program, both migrated out of Manager,
 * where they were cards on the Overview hub. Manager needed a hub because its rail was full;
 * Marketing has no departments, so the tabs go straight in the rail.
 *
 * The `.mg-root` wrapper is MANDATORY — every rule in the shared hub stylesheets is `.mg-root .mg-x`.
 * The CSS import ORDER below matters at equal specificity: hubTheme declares the `--mg-*` / `--hz-*`
 * token layer and is documented as loading last.
 */
import { useCallback, useEffect, useState } from 'react';
import { Share2, Trophy } from 'lucide-react';
import type { NavSection } from '../_shared/MytrionShell';
import { MytrionShell } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import { ReferralsCard } from './referrals/ReferralsCard';
import { LoyaltyCard } from './loyalty/LoyaltyCard';
import {
  MARKETING_TABS,
  accessibleMarketingTabs,
  canOpenMarketingTab,
  isMarketingTabId,
  type MarketingTabId,
} from './marketingNav';
import { readMarketingUrlState, writeMarketingUrlState } from './marketingUrlState';
import '../_shared/hub/hubChrome.css';
import '../_shared/hub/hubWorkspace.css';
import '../_shared/hub/hubChips.css';
import '../_shared/hub/hubDialog.css';
import './loyalty/loyalty.css';
import '../_shared/hub/hubTheme.css';

const DEFAULT_TAB: MarketingTabId = 'referrals';

export function MarketingShell() {
  const user = useUserContext();
  const tabs = accessibleMarketingTabs(user);

  const initial = (): MarketingTabId => {
    const requested = readMarketingUrlState();
    if (isMarketingTabId(requested) && canOpenMarketingTab(user, requested)) return requested;
    return tabs[0]?.id ?? DEFAULT_TAB;
  };
  const [view, setView] = useState<MarketingTabId>(initial);

  const go = useCallback(
    (next: MarketingTabId, mode: 'push' | 'replace' = 'push'): void => {
      // Guard the switch as well as the nav, so stale state or a hand-edited URL cannot bypass the
      // Layer-2 gate the way a shell that only filtered its sidebar would allow.
      if (!canOpenMarketingTab(user, next)) return;
      setView(next);
      writeMarketingUrlState(next, mode);
    },
    [user],
  );

  // Back/forward move between tabs rather than out of the Mytrion.
  useEffect(() => {
    const onPop = (): void => {
      const requested = readMarketingUrlState();
      const next =
        isMarketingTabId(requested) && canOpenMarketingTab(user, requested)
          ? requested
          : (tabs[0]?.id ?? DEFAULT_TAB);
      setView(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [user, tabs]);

  // Land with the tab in the URL even on a bare /main/marketingmytrion, so the first thing anyone
  // copies out of the address bar is already a working deep link.
  useEffect(() => {
    if (readMarketingUrlState() !== view) writeMarketingUrlState(view, 'replace');
  }, [view]);

  // Each tab is a page transition even though the shell stays mounted. Narrow layouts scroll the
  // document; desktop layouts scroll the module root.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('.mg-root')?.scrollTo({ top: 0 });
  }, [view]);

  const navSections: NavSection[] = [
    {
      id: 'programs',
      label: 'Programs',
      items: MARKETING_TABS.filter((tab) => tabs.some((t) => t.id === tab.id)).map((tab) => ({
        key: tab.id,
        label: tab.navLabel,
        icon: <MarketingTabIcon id={tab.id} />,
        tone: tab.tone,
        active: view === tab.id,
        onClick: () => go(tab.id),
        keywords: tab.keywords,
        primary: true,
      })),
    },
  ];

  return (
    <MytrionShell id="marketing" navSections={navSections} enableNavSearch>
      <div className="mg-root">
        {view === 'referrals' ? <ReferralsCard /> : null}
        {view === 'loyalty' ? <LoyaltyCard /> : null}
      </div>
    </MytrionShell>
  );
}

/** Kept local: marketingNav.ts stays React-free so it can be read by non-component code. */
function MarketingTabIcon({ id }: { id: MarketingTabId }) {
  return id === 'referrals' ? <Share2 size={19} /> : <Trophy size={19} />;
}
