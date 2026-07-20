/**
 * Retention — Cases (Phase 1) + Open Pool + incoming claim approvals (Sales agents).
 */
import { useState } from 'react';

import { s } from '../dc';
import { PoolClaimsPane } from '../PoolClaimsPane';
import { RetentionCasesPane } from '../RetentionCasesPane';
import { PoolTab } from './PoolTab';

type RetentionPane = 'cases' | 'pool' | 'claims';

export function RetentionTab() {
  const [pane, setPane] = useState<RetentionPane>('cases');

  const tabs: Array<[RetentionPane, string]> = [
    ['cases', 'Cases'],
    ['pool', 'Open Pool'],
    ['claims', 'Claims'],
  ];

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px;min-height:0')}>
      <div style={s('display:flex;gap:4px;border-bottom:1px solid var(--border)')}>
        {tabs.map(([id, label]) => {
          const on = pane === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              style={s(`padding:10px 16px;border:none;background:none;border-bottom:2px solid ${on ? 'var(--accent)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer`)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {pane === 'cases' && <RetentionCasesPane />}
      {pane === 'pool' && <PoolTab />}
      {pane === 'claims' && <PoolClaimsPane />}
    </div>
  );
}
