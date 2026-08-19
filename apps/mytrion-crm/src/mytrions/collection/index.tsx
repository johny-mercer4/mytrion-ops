import { useState } from 'react';
import { ToastProvider } from '@/ds';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { useUserContext } from '../../context/UserContextProvider';
import {
  COLLECTION_SECTIONS,
  accessibleCollectionTabs,
  canOpenCollectionTab,
  defaultCollectionTab,
  type CollectionTabId,
} from './collectionNav';
import { CollectionArray } from './array/CollectionArray';
import { CollectionCases } from './cases/CollectionCases';
import { PlacementQueue } from './agency/PlacementQueue';
import { CollectionToday } from './today/CollectionToday';
import './collection.css';

/**
 * Collection Mytrion — Home, Collection Cases, and the two halves of Array.
 *
 * `openCase` is lifted here rather than living in each tab, because three surfaces now open a
 * case record: the worklist, the list/board, and the placement queue. Holding it at the shell is
 * what lets the queue hand off to the case and the case's Back land somewhere sensible.
 *
 * Every view switch goes through the Layer-2 RBAC predicate so stale state can't bypass the sidebar.
 *
 * `ToastProvider` is mounted HERE rather than app-wide, and that is the smallest correct place:
 * this is the first module to use `ds/Toast` (the others each rolled a local one), and a provider
 * at the app root would be a change every workspace inherits without asking for it. It wraps the
 * whole module so the write dialogs — which render under `CaseActionDialogs`, several levels down
 * — can report what happened.
 */
export default function CollectionMytrion() {
  const user = useUserContext();
  const [view, setView] = useState<CollectionTabId>(() => defaultCollectionTab(user));
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const tabs = accessibleCollectionTabs(user);

  const open = (id: CollectionTabId): void => {
    if (!canOpenCollectionTab(user, id)) return;
    setOpenCaseId(null);
    setView(id);
  };

  /** From the queue: land on the case record with Cases as the surface behind it. */
  const openCase = (caseId: string): void => {
    if (!canOpenCollectionTab(user, 'cases')) return;
    setView('cases');
    setOpenCaseId(caseId);
  };

  const navSections: NavSection[] = COLLECTION_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    items: tabs
      .filter((tab) => tab.section === section.id)
      .map((tab) => ({
        key: tab.id,
        label: tab.label,
        icon: <tab.icon size={19} />,
        tone: tab.tone,
        active: view === tab.id,
        onClick: () => open(tab.id),
        keywords: tab.keywords,
        ...(tab.soon ? { soon: true } : {}),
        primary: tab.id === 'home',
      })),
  })).filter((section) => section.items.length > 0);

  return (
    <div data-mytrion="collection" className="contents">
      <MytrionShell id="collection" navSections={navSections} enableNavSearch>
        <ToastProvider>
          <div className="co-root">
            {view === 'home' ? <CollectionToday onOpenCase={openCase} onOpenTab={open} /> : null}
            {view === 'cases' ? (
              <CollectionCases openCaseId={openCaseId} onOpenCase={setOpenCaseId} />
            ) : null}
            {view === 'queue' ? <PlacementQueue onOpenCase={openCase} /> : null}
            {view === 'array' ? <CollectionArray /> : null}
          </div>
        </ToastProvider>
      </MytrionShell>
    </div>
  );
}
