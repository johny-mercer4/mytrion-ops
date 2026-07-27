import { useState } from 'react';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import {
  accessibleCollectionTabs,
  canOpenCollectionTab,
  type CollectionTabId,
} from './collectionNav';
import { CollectionArray } from './tabs/CollectionArray';
import { CollectionCases } from './tabs/CollectionCases';
import { CollectionHome } from './tabs/CollectionHome';
import './collection.css';

/**
 * Collection Mytrion — Home, Array Reports, Collection Cases.
 *
 * STRUCTURAL ONLY. The previous module rendered a full cases board, Array report and inbox built on
 * ~260 lines of invented fixtures (`data.ts`); all of it was deleted. The two data tabs now show the
 * shared <ComingSoon /> naming the real source they will read, and nothing fabricates a case.
 *
 * Every view switch goes through the Layer-2 RBAC predicate so stale state can't bypass the sidebar.
 */
export default function CollectionMytrion() {
  const user = useUserContext();
  const [view, setView] = useState<CollectionTabId>('home');
  const tabs = accessibleCollectionTabs(user);

  const open = (id: CollectionTabId): void => {
    if (canOpenCollectionTab(user, id)) setView(id);
  };

  const navSections: NavSection[] = [
    {
      id: 'collection',
      label: 'Collection',
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
    <div data-mytrion="collection" className="contents">
      <MytrionShell id="collection" navSections={navSections} enableNavSearch>
        <div className="co-root">
          {view === 'home' ? <CollectionHome onOpen={open} /> : null}
          {view === 'array' ? <CollectionArray /> : null}
          {view === 'cases' ? <CollectionCases /> : null}
        </div>
      </MytrionShell>
    </div>
  );
}
