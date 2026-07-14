/**
 * Sales Mytrion redesign — Dashboard tab. Ported verbatim from the reference prototype
 * (Sales Mytrion.dc.html `isDash` slice + renderVals() dashboard block). Sub-tabs
 * Sales / Invoices / Transactions / Cards are local `dashSub` state; the JSX/layout is
 * unchanged — only the data source is swapped from the mock arrays to live adapters.
 *
 * DATA:
 *   - Sales sub-tab → loadDashboard() (dashboard.agent_sales): kpi donuts + card utilization +
 *     new-cards, Cards-by-Company bars, Card-Activity line (buildLine over .activity), and the
 *     Transaction Details table (.txTable). The two hero cards derive Card Swipes from the
 *     activity series and Total Gallons from the transaction-detail rows.
 *   - Invoices sub-tab → sales_mytrion.fetch_invoices is per-carrier only; with no carrier
 *     context here it renders a friendly placeholder (no mock invoices).
 *   - Transactions sub-tab → per-swipe detail is per-carrier only → placeholder.
 *   - Cards sub-tab → Active / Inactive / Used-this-cycle derived from loadDashboard() kpi.
 * A "not found in dim_company" upstream miss (agent with no carrier book) surfaces as a
 * friendly empty state rather than an error.
 */
import { useState, type ReactNode } from 'react';
import { buildLine, timeParts, ICO } from '../salesData';
import { s, Svg } from '../dc';
import { useLoad, loadDashboard, numFmt } from '../live';

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

// ---------- helpers ----------

const parseNum = (v: string): number => Number(v.replace(/[^0-9.-]/g, '')) || 0;
function compactNum(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return numFmt(Math.round(v));
}

const DASH_SUBTABS: { id: string; label: string; badge?: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'cards', label: 'Cards' },
];

function State({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  const color = tone === 'error' ? 'var(--danger)' : 'var(--muted)';
  return <div style={s(`text-align:center;padding:64px 20px;color:${color};font-size:13px`)}>{children}</div>;
}

function PlaceholderCard({ children }: { children: ReactNode }) {
  return (
    <div style={s('padding:40px 20px;border-radius:16px;background:var(--surface);border:1px solid var(--border);text-align:center;color:var(--muted);font-size:13px')}>
      {children}
    </div>
  );
}

const NO_CARRIERS = /dim_company/i;

// ---------- SALES ----------

function SalesPanel() {
  const dash = useLoad(loadDashboard, []);

  if (dash.loading) return <State>Loading…</State>;
  if (dash.error) {
    if (NO_CARRIERS.test(dash.error)) {
      return (
        <State>
          No carriers are assigned to this agent yet — the dashboard lights up once the book has
          active carriers. (Admins: use the user switcher to view an agent.)
        </State>
      );
    }
    return <State tone="error">{dash.error}</State>;
  }
  const d = dash.data;
  if (!d) return null;

  const kn = (key: string): number => d.kpi[key] ?? 0;

  const CIRC = 263.9;
  const donutDash = (p: number): string => `${((p / 100) * CIRC).toFixed(1)} ${CIRC}`;
  const donutCompanies = donutDash(kn('active_companies_pct'));
  const donutCards = donutDash(kn('active_cards_pct'));
  const utilPct = kn('total_cards_pct');

  const maxAct = Math.max(...d.bars.map((b) => b.active), 1);
  const stColMap: Record<string, string> = {
    active: 'var(--ok)',
    inactive: 'var(--warn)',
    stuck: 'var(--danger)',
  };
  const dashBars: DashBarVM[] = d.bars.map((b) => ({
    name: b.name,
    val: String(b.active),
    pct: Math.round((b.active / maxAct) * 100) + '%',
    dotCol: stColMap[b.status] ?? 'var(--muted)',
  }));

  const act = d.activity;
  const L = act.length >= 2 ? buildLine(act, 520, 150) : null;
  const dashLineArea = L?.area ?? '';
  const dashLinePath = L?.line ?? '';
  const dashDots: DashDotVM[] = (L?.pts ?? []).map((p) => ({
    cx: p.x.toFixed(1),
    cy: p.y.toFixed(1),
    val: String(p.val),
  }));
  const dashLabels: string[] = act.map((dd) => dd.m);

  const txTable: TxTableRow[] = d.txTable.map((r) => ({
    name: r.name,
    newCards: String(r.newCards),
    tx: String(r.tx),
    gallons: r.gallons,
    total: r.total,
  }));

  const totalSwipes = act.reduce((a, r) => a + r.tx, 0);
  const totalGallons = d.txTable.reduce((a, r) => a + parseNum(r.gallons), 0);

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:16px')}>
        <div style={s('position:relative;overflow:hidden;padding:22px;border-radius:16px;background:linear-gradient(120deg,rgba(124,92,255,.16),transparent),var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;gap:12px')}>
            <div style={s('width:46px;height:46px;border-radius:13px;background:color-mix(in srgb,var(--violet) 16%,transparent);color:var(--violet);display:flex;align-items:center;justify-content:center')}>
              <Svg d={ICO.fuel} size={22} />
            </div>
            <div>
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:28px")}>{compactNum(totalGallons)}</div>
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
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:28px")}>{numFmt(totalSwipes)}</div>
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
                  <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px")}>{numFmt(kn('active_companies'))}</div>
                  <div style={s('font-size:11px;color:var(--ok);font-weight:700')}>{Math.round(kn('active_companies_pct'))}%</div>
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
                  <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px")}>{numFmt(kn('active_cards'))}</div>
                  <div style={s('font-size:11px;color:var(--accent);font-weight:700')}>{Math.round(kn('active_cards_pct'))}%</div>
                </div>
              </div>
              <div style={s('font-size:11px;font-weight:700;color:var(--text2);margin-top:8px')}>Active Cards</div>
            </div>
          </div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;gap:14px')}>
          <div>
            <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Cards Used This Cycle</div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;margin-top:3px")}>{numFmt(kn('unique_cards_used'))}</div>
            <div style={s('height:7px;border-radius:99px;background:var(--raised);margin-top:8px;overflow:hidden')}>
              <div style={s(`height:100%;width:${Math.min(utilPct, 100)}%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))`)} />
            </div>
            <div style={s('font-size:11px;color:var(--muted);margin-top:5px')}><strong style={s('color:var(--accent)')}>{Math.round(utilPct)}%</strong> of active cards utilized</div>
          </div>
        </div>
        <div style={s('padding:20px;border-radius:16px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;gap:16px')}>
          <div>
            <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>New Cards · Cycle</div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:24px;color:var(--ok)")}>{numFmt(kn('new_cards_cycle'))}</div>
          </div>
          <div style={s('height:1px;background:var(--border)')} />
          <div>
            <div style={s('font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em')}>Last 7 Days</div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:24px;color:var(--ok)")}>{numFmt(kn('new_cards_7d'))}</div>
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
              {dashDots.map((dd, i) => (
                <circle key={i} cx={dd.cx} cy={dd.cy} r="3" fill="var(--accent)" />
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
          {txTable.length === 0 ? (
            <div style={s('padding:26px 15px;text-align:center;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border2)')}>No transactions this cycle.</div>
          ) : (
            txTable.map((r) => (
              <div key={r.name} style={s('display:grid;grid-template-columns:1.6fr 1fr 1fr 1.1fr 1fr;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}>
                <span style={s('font-weight:600')}>{r.name}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;color:var(--ok)")}>{r.newCards}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace")}>{r.tx}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;color:var(--violet)")}>{r.gallons}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>{r.total}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- INVOICES ----------

function InvoicesPanel() {
  // sales_mytrion.fetch_invoices is per-carrier only; the dashboard has no carrier context,
  // so there is no agent-wide invoice source to render here.
  return (
    <PlaceholderCard>
      Invoices are pulled per carrier. Open a carrier from Data Center or Carriers to fetch and
      download its WorkDrive invoices.
    </PlaceholderCard>
  );
}

// ---------- TRANSACTIONS ----------

function TransactionsPanel() {
  // Per-swipe fuel transactions are a per-carrier report (dwh.transactions); no agent-wide
  // per-transaction feed exists, so this is a placeholder until a carrier is selected.
  return (
    <PlaceholderCard>
      Fuel transaction details are available per carrier. Open a carrier to view its swipe-level
      transactions for any date range.
    </PlaceholderCard>
  );
}

// ---------- CARDS ----------

function CardsPanel() {
  const dash = useLoad(loadDashboard, []);

  if (dash.loading) return <State>Loading…</State>;
  if (dash.error) {
    if (NO_CARRIERS.test(dash.error)) {
      return <State>No carriers are assigned to this agent yet — card totals appear once the book has active carriers.</State>;
    }
    return <State tone="error">{dash.error}</State>;
  }
  const d = dash.data;
  if (!d) return null;

  const kn = (key: string): number => d.kpi[key] ?? 0;
  const total = kn('total_cards');
  const active = kn('active_cards');
  const inactive = Math.max(0, total - active);
  const used = kn('unique_cards_used');
  const pctOf = (x: number): string => (total > 0 ? Math.round((x / total) * 100) + '%' : '0%');

  const cardBreak: CardBreakVM[] = [
    { label: 'Active', count: active, col: 'var(--ok)', pct: pctOf(active) },
    { label: 'Inactive', count: inactive, col: 'var(--muted)', pct: pctOf(inactive) },
    { label: 'Used · Cycle', count: used, col: 'var(--accent)', pct: pctOf(used) },
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
        {DASH_SUBTABS.map((t) => {
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
