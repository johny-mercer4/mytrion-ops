/**
 * Sales Mytrion redesign — Dashboard tab. Ported verbatim from the reference prototype
 * (Sales Mytrion.dc.html `isDash` slice + renderVals() dashboard block). Sub-tabs
 * Sales / Invoices / Transactions / Cards are local `dashSub` state; each panel computes
 * its view-model inline from the mock arrays, mirroring the reference renderVals().
 * Applications & Money Codes intentionally live in Data Center (per the slice).
 */
import { useState } from 'react';
import { DASHTABS, RECORDS, DASHACT, INVROWS, TXNROWS } from '../mock';
import { badge, buildLine, timeParts, ICO, type BadgeVM } from '../salesData';
import { s, Svg, Badge } from '../dc';

// ---------- view-model types ----------

interface DashBarVM {
  name: string;
  val: string;
  pct: string;
  dotCol: string;
}
interface TxTableRow {
  name: string;
  newCards: string;
  tx: string;
  gallons: string;
  total: string;
}
interface InvRowVM {
  inv: string;
  date: string;
  amount: string;
  status: string;
  statusBadge: BadgeVM;
}
interface DashDotVM {
  cx: string;
  cy: string;
  val: string;
}
interface CardBreakVM {
  label: string;
  count: number;
  col: string;
  pct: string;
}

// ---------- SALES ----------

function SalesPanel() {
  const CIRC = 263.9;
  const donutDash = (p: number): string => `${((p / 100) * CIRC).toFixed(1)} ${CIRC}`;
  const donutCompanies = donutDash(78);
  const donutCards = donutDash(64);

  const maxAct = Math.max(...RECORDS.map((c) => c.active));
  const stColMap: Record<string, string> = {
    active: 'var(--ok)',
    attention: 'var(--warn)',
    debtor: 'var(--danger)',
  };
  const dashBars: DashBarVM[] = RECORDS.map((c) => ({
    name: c.name,
    val: String(c.active),
    pct: Math.round((c.active / maxAct) * 100) + '%',
    dotCol: stColMap[c.status] ?? 'var(--muted)',
  }));

  const L = buildLine([...DASHACT], 520, 150);
  const dashLineArea = L.area;
  const dashLinePath = L.line;
  const dashDots: DashDotVM[] = L.pts.map((p) => ({
    cx: p.x.toFixed(1),
    cy: p.y.toFixed(1),
    val: String(p.val),
  }));
  const dashLabels: string[] = DASHACT.map((d) => d.m);

  const newCardsArr = [4, 2, 1, 3, 5, 2];
  const txArr = [182, 240, 96, 88, 310, 120];
  const totalArr = [6240, 8180, 3120, 2980, 11040, 4200];
  const txTable: TxTableRow[] = RECORDS.map((c, i) => ({
    name: c.name,
    newCards: String(newCardsArr[i] || 1),
    tx: String(txArr[i] || 50),
    gallons: c.gallons,
    total: '$' + (totalArr[i] || 1000).toLocaleString(),
  }));

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:16px')}>
        <div style={s('position:relative;overflow:hidden;padding:22px;border-radius:16px;background:linear-gradient(120deg,rgba(124,92,255,.16),transparent),var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;gap:12px')}>
            <div style={s('width:46px;height:46px;border-radius:13px;background:color-mix(in srgb,var(--violet) 16%,transparent);color:var(--violet);display:flex;align-items:center;justify-content:center')}>
              <Svg d={ICO.fuel} size={22} />
            </div>
            <div>
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:28px")}>1.24M</div>
              <div style={s('font-size:11.5px;color:var(--muted);font-weight:600;letter-spacing:.03em;text-transform:uppercase')}>Total Gallons · This Cycle</div>
            </div>
          </div>
        </div>
        <div style={s('position:relative;overflow:hidden;padding:22px;border-radius:16px;background:linear-gradient(120deg,rgba(var(--accent-rgb),.16),transparent),var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;gap:12px')}>
            <div style={s('width:46px;height:46px;border-radius:13px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);display:flex;align-items:center;justify-content:center')}>
              <Svg d={ICO.card} size={22} />
            </div>
            <div>
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:28px")}>7,412</div>
              <div style={s('font-size:11.5px;color:var(--muted);font-weight:600;letter-spacing:.03em;text-transform:uppercase')}>Card Swipes · This Cycle</div>
            </div>
          </div>
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:1.2fr 1fr 0.8fr;gap:16px')}>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;gap:20px;justify-content:space-around')}>
            <div style={s('text-align:center')}>
              <div style={s('position:relative;width:96px;height:96px;margin:0 auto')}>
                <svg viewBox="0 0 100 100" style={s('width:96px;height:96px;transform:rotate(-90deg)')}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--raised)" strokeWidth="9" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--ok)" strokeWidth="9" strokeLinecap="round" strokeDasharray={donutCompanies} />
                </svg>
                <div style={s('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center')}>
                  <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px")}>124</div>
                  <div style={s('font-size:11px;color:var(--ok);font-weight:700')}>78%</div>
                </div>
              </div>
              <div style={s('font-size:11px;font-weight:700;color:var(--text2);margin-top:8px')}>Active Companies</div>
            </div>
            <div style={s('text-align:center')}>
              <div style={s('position:relative;width:96px;height:96px;margin:0 auto')}>
                <svg viewBox="0 0 100 100" style={s('width:96px;height:96px;transform:rotate(-90deg)')}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--raised)" strokeWidth="9" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={donutCards} />
                </svg>
                <div style={s('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center')}>
                  <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px")}>312</div>
                  <div style={s('font-size:11px;color:var(--accent);font-weight:700')}>64%</div>
                </div>
              </div>
              <div style={s('font-size:11px;font-weight:700;color:var(--text2);margin-top:8px')}>Active Cards</div>
            </div>
          </div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;gap:14px')}>
          <div>
            <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Cards Used This Cycle</div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;margin-top:3px")}>287</div>
            <div style={s('height:7px;border-radius:99px;background:var(--raised);margin-top:8px;overflow:hidden')}>
              <div style={s('height:100%;width:92%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))')} />
            </div>
            <div style={s('font-size:11px;color:var(--muted);margin-top:5px')}><strong style={s('color:var(--accent)')}>92%</strong> of active cards utilized</div>
          </div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;gap:16px')}>
          <div>
            <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>New Cards · Cycle</div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:24px;color:var(--ok)")}>34</div>
          </div>
          <div style={s('height:1px;background:var(--border)')} />
          <div>
            <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Last 7 Days</div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:24px;color:var(--ok)")}>11</div>
          </div>
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1.15fr;gap:16px')}>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:13px;font-weight:700;margin-bottom:16px')}>Cards by Company</div>
          <div style={s('display:flex;flex-direction:column;gap:13px')}>
            {dashBars.map((b) => (
              <div key={b.name} style={s('display:flex;align-items:center;gap:10px')}>
                <span style={s(`width:8px;height:8px;border-radius:50%;background:${b.dotCol};flex-shrink:0`)} />
                <span style={s('width:130px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0')}>{b.name}</span>
                <div style={s('flex:1;height:9px;border-radius:99px;background:var(--raised);overflow:hidden')}>
                  <div style={s(`height:100%;width:${b.pct};border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))`)} />
                </div>
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;width:28px;text-align:right")}>{b.val}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:14px')}>
            <span style={s('font-size:13px;font-weight:700')}>Card Activity · Transactions</span>
            <span style={s('font-size:11px;color:var(--muted)')}>Last 10 days</span>
          </div>
          <div style={s('position:relative')}>
            <svg viewBox="0 0 520 150" preserveAspectRatio="none" style={s('width:100%;height:150px;display:block')}>
              <defs>
                <linearGradient id="ssArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(var(--accent-rgb),.30)" />
                  <stop offset="100%" stopColor="rgba(var(--accent-rgb),0)" />
                </linearGradient>
              </defs>
              <path d={dashLineArea} fill="url(#ssArea)" />
              <path d={dashLinePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              {dashDots.map((d, i) => (
                <circle key={i} cx={d.cx} cy={d.cy} r="3" fill="var(--accent)" />
              ))}
            </svg>
            <div style={s('display:flex;justify-content:space-between;margin-top:8px')}>
              {dashLabels.map((l, i) => (
                <span key={i} style={s("font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
        <div style={s('font-size:13px;font-weight:700;margin-bottom:14px')}>Transaction Details</div>
        <div style={s('border-radius:12px;border:1px solid var(--border);overflow:hidden')}>
          <div style={s('display:grid;grid-template-columns:1.6fr 1fr 1fr 1.1fr 1fr;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
            <span>Carrier</span>
            <span style={s('text-align:right')}>New Cards</span>
            <span style={s('text-align:right')}>Txns</span>
            <span style={s('text-align:right')}>Gallons</span>
            <span style={s('text-align:right')}>Total</span>
          </div>
          {txTable.map((r) => (
            <div key={r.name} style={s('display:grid;grid-template-columns:1.6fr 1fr 1fr 1.1fr 1fr;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}>
              <span style={s('font-weight:600')}>{r.name}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;color:var(--ok)")}>{r.newCards}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{r.tx}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;color:var(--violet)")}>{r.gallons}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>{r.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- INVOICES ----------

function InvoicesPanel() {
  const invRowsD: InvRowVM[] = INVROWS.map((r) => ({
    ...r,
    statusBadge: badge(r.status, r.status === 'Paid' ? 'var(--ok)' : 'var(--danger)'),
  }));

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:16px')}>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Outstanding</div>
          <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;margin-top:6px;color:var(--danger)")}>$10,392</div>
          <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px')}>Across 2 invoices</div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Paid · 90 days</div>
          <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;margin-top:6px;color:var(--ok)")}>$22,410</div>
          <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px')}>On time</div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Overdue</div>
          <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;margin-top:6px;color:var(--orange)")}>1</div>
          <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px')}>Needs follow-up</div>
        </div>
      </div>
      <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
        <div style={s('font-size:13px;font-weight:700;margin-bottom:14px')}>Recent Invoices</div>
        <div style={s('border-radius:12px;border:1px solid var(--border);overflow:hidden')}>
          <div style={s('display:grid;grid-template-columns:1.4fr 1.2fr 1fr auto;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
            <span>Invoice</span>
            <span>Date</span>
            <span style={s('text-align:right')}>Amount</span>
            <span>Status</span>
          </div>
          {invRowsD.map((r) => (
            <div key={r.inv} style={s('display:grid;grid-template-columns:1.4fr 1.2fr 1fr auto;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}>
              <span style={s("font-family:'JetBrains Mono',monospace;color:var(--accent)")}>{r.inv}</span>
              <span style={s('color:var(--text2)')}>{r.date}</span>
              <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>{r.amount}</span>
              <Badge vm={r.statusBadge} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- TRANSACTIONS ----------

function TransactionsPanel() {
  return (
    <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px')}>
        <span style={s('font-size:13px;font-weight:700')}>Fuel Transactions · Last 30 days</span>
        <span style={s('font-size:12px;color:var(--muted)')}>614 gallons · <strong style={s('color:var(--text)')}>$2,093.60</strong></span>
      </div>
      <div style={s('border-radius:12px;border:1px solid var(--border);overflow:hidden')}>
        <div style={s('display:grid;grid-template-columns:0.8fr 1fr 1.2fr 1fr 1fr;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
          <span>Date</span>
          <span>Card</span>
          <span>Driver</span>
          <span style={s('text-align:right')}>Gallons</span>
          <span style={s('text-align:right')}>Amount</span>
        </div>
        {TXNROWS.map((r, i) => (
          <div key={i} style={s('display:grid;grid-template-columns:0.8fr 1fr 1.2fr 1fr 1fr;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}>
            <span style={s('color:var(--text2)')}>{r.date}</span>
            <span style={s("font-family:'JetBrains Mono',monospace")}>{r.card}</span>
            <span style={s('color:var(--text2)')}>{r.driver}</span>
            <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{r.gallons}</span>
            <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>{r.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- CARDS ----------

function CardsPanel() {
  const cardBreak: CardBreakVM[] = [
    { label: 'Active', count: 49, col: 'var(--ok)', pct: '73%' },
    { label: 'Inactive', count: 12, col: 'var(--muted)', pct: '18%' },
    { label: 'Fraud hold', count: 6, col: 'var(--danger)', pct: '9%' },
  ];
  return (
    <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:16px')}>
      {cardBreak.map((c) => (
        <div key={c.label} style={s('padding:22px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between')}>
            <span style={s('font-size:12px;font-weight:700;color:var(--text2)')}>{c.label}</span>
            <span style={s(`width:10px;height:10px;border-radius:50%;background:${c.col}`)} />
          </div>
          <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:32px;margin-top:10px;color:${c.col}`)}>{c.count}</div>
          <div style={s('height:7px;border-radius:99px;background:var(--raised);margin-top:12px;overflow:hidden')}>
            <div style={s(`height:100%;width:${c.pct};border-radius:99px;background:${c.col}`)} />
          </div>
          <div style={s('font-size:11px;color:var(--muted);margin-top:6px')}>{c.pct} of fleet</div>
        </div>
      ))}
    </div>
  );
}

// ---------- shell ----------

export function DashTab() {
  const [dashSub, setDashSub] = useState<string>('sales');
  const todayDate = timeParts().dateLabel;

  return (
    <div className="ss-fu">
      <div style={s('margin-bottom:14px')}>
        <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase")}>Dashboard</div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>{todayDate}</div>
      </div>
      <div style={s('display:flex;gap:6px;margin-bottom:18px;overflow-x:auto;padding:4px;border-radius:13px;background:var(--surface);border:1px solid var(--border)')}>
        {DASHTABS.map((t) => {
          const on = dashSub === t.id;
          const badgeVal = 'badge' in t ? t.badge : undefined;
          const hasBadge = !!badgeVal;
          const style = `display:flex;align-items:center;gap:7px;padding:9px 15px;border-radius:10px;border:1px solid ${on ? 'rgba(var(--accent-rgb),.4)' : 'transparent'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .14s`;
          return (
            <button key={t.id} onClick={() => setDashSub(t.id)} style={s(style)}>
              {t.label}
              {hasBadge && (
                <span style={s('background:var(--danger);color:#fff;font-size:9.5px;font-weight:800;min-width:16px;height:16px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 4px')}>{badgeVal}</span>
              )}
            </button>
          );
        })}
      </div>

      {dashSub === 'sales' && <SalesPanel />}
      {dashSub === 'invoices' && <InvoicesPanel />}
      {dashSub === 'transactions' && <TransactionsPanel />}
      {dashSub === 'cards' && <CardsPanel />}
    </div>
  );
}
