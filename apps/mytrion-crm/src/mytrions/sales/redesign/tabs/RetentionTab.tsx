/**
 * Retention — Cases (Phase 1) + Open Pool + prior-owner Claims.
 */
import { useCallback, useEffect, useState } from 'react';

import { useLoad } from '../../../_shared/useLoad';
import { s } from '../dc';
import { OwnerClaimsPane } from '../OwnerClaimsPane';
import { RetentionCasesPane } from '../RetentionCasesPane';
import { loadOpenPoolCases, loadOwnerClaimsBadge } from '../retentionData';
import { PoolTab } from './PoolTab';

type RetentionPane = 'cases' | 'pool' | 'claims';

export function RetentionTab() {
  const [pane, setPane] = useState<RetentionPane>('cases');
  const [casesCount, setCasesCount] = useState<number | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [claimsCount, setClaimsCount] = useState<number | null>(null);

  /** Seed Open Pool badge (available to claim) without forcing the pool pane mount. */
  const poolSeed = useLoad(() => loadOpenPoolCases(), []);
  useEffect(() => {
    if (poolSeed.data?.cases) {
      setPoolCount(poolSeed.data.cases.filter((c) => c.statusCode === 'p1_open_pool').length);
    }
  }, [poolSeed.data?.cases]);

  const claimsSeed = useLoad(() => loadOwnerClaimsBadge().then((count) => ({ count })), []);
  useEffect(() => {
    if (claimsSeed.data) setClaimsCount(claimsSeed.data.count);
  }, [claimsSeed.data]);

  const onCasesCount = useCallback((n: number) => setCasesCount(n), []);
  const onPoolCount = useCallback((n: number) => setPoolCount(n), []);
  const onClaimsCount = useCallback((n: number) => setClaimsCount(n), []);

  const tabs: Array<[RetentionPane, string, number | null]> = [
    ['cases', 'Cases', casesCount],
    ['pool', 'Open Pool', poolCount],
    ['claims', 'Claims', claimsCount],
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
      {pane === 'claims' && <OwnerClaimsPane onPendingCount={onClaimsCount} />}
    </div>
  );
}
