import { ArrowRight, Home, LayoutGrid, Sheet } from 'lucide-react';
import { COLLECTION_TABS, type CollectionTabId } from '../collectionNav';

/**
 * Collection → Home. The landing and launcher.
 *
 * No figure row: every number a collections overview would want (open cases, amount in recovery,
 * placements with Array) depends on tabs that have no live source yet. A row of em-dashes is
 * scaffolding pretending to be a dashboard, so it waits until there is something real to count.
 */
const JUMP_ICON: Record<CollectionTabId, typeof Home> = {
  home: Home,
  array: Sheet,
  cases: LayoutGrid,
};

export function CollectionHome({ onOpen }: { onOpen: (tab: CollectionTabId) => void }) {
  const jumps = COLLECTION_TABS.filter((t) => t.id !== 'home');

  return (
    <div className="co-page">
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
