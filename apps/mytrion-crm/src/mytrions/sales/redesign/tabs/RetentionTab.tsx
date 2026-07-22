/**
 * Retention — Cases (Phase 1) + Open Pool (Sales agents).
 */
import { useCallback, useEffect, useState } from 'react';

import { useLoad } from '../../../_shared/useLoad';
import { s } from '../dc';
import { RetentionCasesPane } from '../RetentionCasesPane';
import { loadOpenPoolCases } from '../retentionData';
import { PoolTab } from './PoolTab';

type RetentionPane = 'cases' | 'pool';

export function RetentionTab() {
  const [pane, setPane] = useState<RetentionPane>('cases');
  const [casesCount, setCasesCount] = useState<number | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);

  /** Seed Open Pool badge without forcing the pool pane mount. */
  const poolSeed = useLoad(() => loadOpenPoolCases(), []);
  useEffect(() => {
    if (poolSeed.data?.cases) setPoolCount(poolSeed.data.cases.length);
  }, [poolSeed.data?.cases]);

  const onCasesCount = useCallback((n: number) => setCasesCount(n), []);
  const onPoolCount = useCallback((n: number) => setPoolCount(n), []);

  const tabs: Array<[RetentionPane, string, number | null]> = [
    ['cases', 'Cases', casesCount],
    ['pool', 'Open Pool', poolCount],
  ];

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px;min-height:0')}>
      <div
        className="ss-ret-tabs"
        role="tablist"
        aria-label="Retention sections"
        style={{ alignSelf: 'flex-start' }}
      >
        {tabs.map(([id, label, count]) => {
          const on = pane === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPane(id)}
              className={`ss-ret-tab${on ? ' is-on' : ''}`}
            >
              {label}
              {count != null && <span className="ss-ret-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {pane === 'cases' && <RetentionCasesPane onOpenCount={onCasesCount} />}
      {pane === 'pool' && <PoolTab onAvailableCount={onPoolCount} />}
    </div>
  );
}
