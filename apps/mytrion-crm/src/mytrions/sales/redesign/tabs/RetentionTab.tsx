/**
 * Retention — in-page tabs for Cases and Open Pool (Open Pool reuses PoolTab).
 * Nav item stays Coming soon until this surface is ready to ship.
 */
import { useState } from 'react';

import { s } from '../dc';
import { Icon } from '../icons';
import { PoolTab } from './PoolTab';

type RetentionPane = 'cases' | 'pool';

export function RetentionTab() {
  const [pane, setPane] = useState<RetentionPane>('cases');

  const tabs: Array<[RetentionPane, string]> = [
    ['cases', 'Cases'],
    ['pool', 'Open Pool'],
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

      {pane === 'cases' && (
        <div style={s('padding:48px 24px;text-align:center;border-radius:var(--radius-md);border:1px dashed var(--border);background:var(--alt)')}>
          <div style={s('width:44px;height:44px;margin:0 auto 14px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)')}>
            <Icon name="clock" size={22} />
          </div>
          <div style={s('font-size:15px;font-weight:700')}>Cases</div>
          <div style={s('font-size:12.5px;color:var(--muted);margin-top:6px;max-width:320px;margin-left:auto;margin-right:auto;line-height:1.5')}>
            Retention cases board is coming soon.
          </div>
        </div>
      )}

      {pane === 'pool' && <PoolTab />}
    </div>
  );
}
