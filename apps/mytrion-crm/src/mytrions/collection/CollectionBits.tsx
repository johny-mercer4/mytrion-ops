import type { ReactNode } from 'react';
import { findCollectionTab, type CollectionTabId } from './collectionNav';

/** Kicker → title → sub, matching every other Mytrion's page head. */
export function CollectionPageHead({
  tab,
  actions,
}: {
  tab: CollectionTabId;
  actions?: ReactNode;
}) {
  const meta = findCollectionTab(tab);
  return (
    <header className="co-head">
      <div>
        <div className="co-kicker">Recovery</div>
        <h1 className="co-title">{meta.label}</h1>
        <p className="co-sub">{meta.description}</p>
      </div>
      {actions ? <div className="co-head-actions">{actions}</div> : null}
    </header>
  );
}
