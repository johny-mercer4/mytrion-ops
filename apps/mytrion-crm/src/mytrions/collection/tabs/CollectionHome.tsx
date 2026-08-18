import { useCallback } from 'react';
import { ArrowRight, Home, LayoutGrid, Sheet } from 'lucide-react';
import { listArrayReports, listCollectionCases } from '@/api/collection';
import { KpiGrid, KpiTile } from '../../_shared/page';
import { useCachedLoad } from '../../_shared/swrCache';
import { COLLECTION_TABS, type CollectionTabId } from '../collectionNav';
import { money } from '../collectionFormat';

/**
 * Collection → Home. The landing and launcher.
 *
 * Figures come from the same list endpoints the tabs use (limit 1) so the tiles cannot disagree
 * with the desks they open.
 */
const JUMP_ICON: Record<CollectionTabId, typeof Home> = {
  home: Home,
  array: Sheet,
  cases: LayoutGrid,
};

export function CollectionHome({ onOpen }: { onOpen: (tab: CollectionTabId) => void }) {
  const jumps = COLLECTION_TABS.filter((t) => t.id !== 'home');
  const loadCases = useCallback(() => listCollectionCases({ limit: 1 }), []);
  const loadArray = useCallback(() => listArrayReports({ limit: 1 }), []);
  const cases = useCachedLoad('collection:cases:home', loadCases);
  const reports = useCachedLoad('collection:array:home', loadArray);

  return (
    <div className="co-page">
      <KpiGrid>
        <KpiTile label="Open cases" value={String(cases.data?.aggregates.open ?? '—')} />
        <KpiTile label="Remaining debt" value={money(cases.data?.aggregates.remainingDebt)} />
        <KpiTile label="Array tradelines" value={String(reports.data?.aggregates.total ?? '—')} />
      </KpiGrid>
      <div className="co-hero">
        <div className="co-hero-glow" />
        <div className="co-hero-inner">
          <div className="co-kicker">Recovery</div>
          <h1 className="co-hero-title">
            Collection <span>Mytrion</span>
          </h1>
          <p className="co-sub">
            Bad-debt escalation end to end — from the hand-off out of Billing, through contact and
            payment plans, to agency placement with Array and whatever is recovered.
          </p>
        </div>
      </div>

      <section className="co-section">
        <div className="co-section-head">
          <h2 className="co-section-title">Workspaces</h2>
          <span className="co-section-line" />
        </div>
        <div className="co-jump-grid">
          {jumps.map((tab) => {
            const Icon = JUMP_ICON[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                className="co-jump"
                style={{ ['--co-tone' as string]: tab.tone }}
                onClick={() => onOpen(tab.id)}
              >
                <span className="co-jump-shimmer" />
                <div className="co-jump-top">
                  <span className="co-glyph">
                    <Icon size={21} />
                  </span>
                  <ArrowRight size={17} className="co-jump-arrow" />
                </div>
                <span className="co-jump-title">
                  {tab.label}
                  {tab.soon ? <span className="co-soon">Soon</span> : null}
                </span>
                <span className="co-jump-desc">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
