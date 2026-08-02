/**
 * Retention — Cases (Phase 1) + Open Pool (Sales agents).
 * The sub-tab names the pane, so neither pane repeats its own name as a heading.
 */
import { useCallback, useState } from 'react';

import { SalesPage, SalesSubTabs, type SalesSubTab } from '../SalesPage';
import { RetentionCasesPane } from '../RetentionCasesPane';
import { PoolTab } from './PoolTab';

type RetentionPane = 'cases' | 'pool';

export function RetentionTab() {
  const [pane, setPane] = useState<RetentionPane>('cases');
  const [casesCount, setCasesCount] = useState<number | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);

  const onCasesCount = useCallback((n: number) => setCasesCount(n), []);
  const onPoolCount = useCallback((n: number) => setPoolCount(n), []);

  const tabs: ReadonlyArray<SalesSubTab<RetentionPane>> = [
    { id: 'cases', label: 'My cases', count: casesCount ?? undefined },
    { id: 'pool', label: 'Open Pool', count: poolCount ?? undefined },
  ];

  return (
    <SalesPage>
      {/* No page description here — each pane's hero carries its own rules ("Max 2 claims/day…"),
          which are more specific than anything that could sit above both. */}
      <SalesSubTabs items={tabs} value={pane} onChange={setPane} label="Retention section" />

      {pane === 'cases' && <RetentionCasesPane onOpenCount={onCasesCount} />}
      {pane === 'pool' && <PoolTab onAvailableCount={onPoolCount} />}
    </SalesPage>
  );
}
