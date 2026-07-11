/**
 * Sales Mytrion redesign — Data Center ("records") tab.
 *
 * Ported verbatim from the reference prototype's `isRecords` slice + its renderVals()
 * view-model (records / appStages / moneyCodes / dcTabs). Sub-tabs (Clients /
 * Applications / Money Codes) are LOCAL state; clicking a client card opens the shell's
 * client drilldown modal via the shared context (reference `openRecord` → ctx.openClient).
 */
import { useState } from 'react';
import { s } from '../dc';
import { badge, type BadgeVM } from '../salesData';
import { RECORDS, APPSTAGES, MONEYCODES } from '../mock';
import { useSales } from '../ctx';

type DcSub = 'clients' | 'applications' | 'money';
type RecStatus = 'active' | 'attention' | 'debtor';
type MoneyStatus = 'Active' | 'Redeemed' | 'Expired';

interface RecordVM {
  id: string;
  name: string;
  carrier: string;
  initials: string;
  avStyle: string;
  statusBadge: BadgeVM;
  balColor: string;
  balance: string;
  active: number;
  cards: number;
  gallons: string;
  onClick: () => void;
}

interface AppStageVM {
  stage: string;
  count: number;
  col: string;
  pct: string;
}

interface MoneyCodeVM {
  code: string;
  carrier: string;
  amount: string;
  issued: string;
  statusBadge: BadgeVM;
}

interface DcTabVM {
  id: DcSub;
  label: string;
  style: string;
  onClick: () => void;
}

export function RecordsTab() {
  const { openClient } = useSales();
  const [dcSub, setDcSub] = useState<DcSub>('clients');

  // records
  const recStatus: Record<RecStatus, readonly [string, string]> = {
    active: ['Active', 'var(--ok)'],
    attention: ['Needs attention', 'var(--orange)'],
    debtor: ['Debtor', 'var(--danger)'],
  };
  const records: RecordVM[] = RECORDS.map((c) => {
    const [lbl, col] = recStatus[c.status];
    const debt = c.balance.startsWith('-');
    return {
      id: c.id,
      name: c.name,
      carrier: c.carrier,
      initials: c.name.split(' ').map((w) => w.charAt(0)).slice(0, 2).join(''),
      avStyle: `width:40px;height:40px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`,
      statusBadge: badge(lbl, col),
      balColor: debt ? 'var(--danger)' : 'var(--muted)',
      balance: c.balance,
      active: c.active,
      cards: c.cards,
      gallons: c.gallons,
      onClick: () =>
        openClient({
          id: c.id,
          name: c.name,
          carrier: c.carrier,
          contact: c.contact,
          phone: c.phone,
          cards: c.cards,
          active: c.active,
          gallons: c.gallons,
          balance: c.balance,
          status: c.status,
          mc: c.mc,
          dot: c.dot,
        }),
    };
  });

  // application pipeline
  const appStages: AppStageVM[] = APPSTAGES.map((st) => ({
    stage: st.stage,
    count: st.count,
    col: st.col,
    pct: Math.round((st.count / 9) * 100) + '%',
  }));

  // money codes issued
  const moneyCol: Record<MoneyStatus, string> = {
    Active: 'var(--ok)',
    Redeemed: 'var(--muted)',
    Expired: 'var(--danger)',
  };
  const moneyCodes: MoneyCodeVM[] = MONEYCODES.map((m) => ({
    code: m.code,
    carrier: m.carrier,
    amount: m.amount,
    issued: m.issued,
    statusBadge: badge(m.status, moneyCol[m.status]),
  }));

  // data center sub-tabs
  const dcTabDefs: [DcSub, string][] = [
    ['clients', 'Clients'],
    ['applications', 'Applications'],
    ['money', 'Money Codes'],
  ];
  const dcTabs: DcTabVM[] = dcTabDefs.map(([id, label]) => {
    const on = dcSub === id;
    return {
      id,
      label,
      style: `padding:9px 16px;border-radius:10px;border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .14s`,
      onClick: () => setDcSub(id),
    };
  });

  const dcClients = dcSub === 'clients';
  const dcApps = dcSub === 'applications';
  const dcMoney = dcSub === 'money';

  return (
    <div className="ss-fu">
      <div style={s('margin-bottom:14px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>
          Data Center
        </div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>
          Everything about your accounts — clients, applications &amp; money codes.
        </div>
      </div>
      <div style={s('display:flex;gap:6px;margin-bottom:18px;padding:4px;border-radius:13px;background:var(--surface);border:1px solid var(--border);width:fit-content;max-width:100%;overflow-x:auto')}>
        {dcTabs.map((t) => (
          <button key={t.id} onClick={t.onClick} style={s(t.style)}>
            {t.label}
          </button>
        ))}
      </div>

      {dcClients && (
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
          {records.map((c) => (
            <div
              key={c.id}
              onClick={c.onClick}
              className="ss-card-h"
              style={s('padding:18px;border-radius:16px;background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}
            >
              <div style={s('display:flex;align-items:center;gap:12px')}>
                <div style={s(c.avStyle)}>{c.initials}</div>
                <div style={s('min-width:0;flex:1')}>
                  <div style={s('font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                    {c.name}
                  </div>
                  <div style={s("font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px")}>
                    {c.carrier}
                  </div>
                </div>
              </div>
              <div style={s('margin-top:14px;display:flex;align-items:center;justify-content:space-between')}>
                <span style={s(c.statusBadge.style)}>{c.statusBadge.text}</span>
                <span style={s(`font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:${c.balColor}`)}>
                  {c.balance}
                </span>
              </div>
              <div style={s('display:flex;gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border2)')}>
                <div>
                  <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600")}>
                    {c.active}
                    <span style={s('color:var(--muted);font-size:12px')}>/{c.cards}</span>
                  </div>
                  <div style={s('font-size:10.5px;color:var(--muted)')}>Active cards</div>
                </div>
                <div>
                  <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:var(--violet)")}>
                    {c.gallons}
                  </div>
                  <div style={s('font-size:10.5px;color:var(--muted)')}>Gallons (cycle)</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dcApps && (
        <div style={s('padding:22px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:13px;font-weight:700;margin-bottom:16px')}>Application Pipeline</div>
          <div style={s('display:flex;flex-direction:column;gap:14px')}>
            {appStages.map((st) => (
              <div key={st.stage} style={s('display:flex;align-items:center;gap:12px')}>
                <span style={s('width:130px;font-size:12.5px;font-weight:600;color:var(--text2);flex-shrink:0')}>
                  {st.stage}
                </span>
                <div style={s('flex:1;height:26px;border-radius:8px;background:var(--raised);overflow:hidden;position:relative')}>
                  <div style={s(`height:100%;width:${st.pct};background:color-mix(in srgb,${st.col} 30%,transparent);border-left:3px solid ${st.col}`)}></div>
                </div>
                <span style={s(`font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;width:26px;text-align:right;color:${st.col}`)}>
                  {st.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dcMoney && (
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:13px;font-weight:700;margin-bottom:14px')}>Money Codes Issued</div>
          <div style={s('border-radius:12px;border:1px solid var(--border);overflow:hidden')}>
            <div style={s('display:grid;grid-template-columns:1.3fr 1.4fr 0.8fr 1fr auto;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
              <span>Code</span>
              <span>Carrier</span>
              <span style={s('text-align:right')}>Amount</span>
              <span>Issued</span>
              <span>Status</span>
            </div>
            {moneyCodes.map((r) => (
              <div
                key={r.code}
                style={s('display:grid;grid-template-columns:1.3fr 1.4fr 0.8fr 1fr auto;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}
              >
                <span style={s("font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--accent)")}>
                  {r.code}
                </span>
                <span style={s('color:var(--text2)')}>{r.carrier}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>
                  {r.amount}
                </span>
                <span style={s('color:var(--muted);font-size:11.5px')}>{r.issued}</span>
                <span style={s(r.statusBadge.style)}>{r.statusBadge.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
