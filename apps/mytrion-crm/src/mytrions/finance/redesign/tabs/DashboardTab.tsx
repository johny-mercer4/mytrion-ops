import { useState } from 'react';

import { useFinanceCtx } from '../ctx';
import { Badge, s, Svg } from '../dc';
import {
  agingBuckets,
  badge,
  CLIENTS,
  DASHBOARD_DEBTORS,
  DASHBOARD_PAYMENTS,
  dateTimeShort,
  debtTotal,
  discountSaved,
  dowBars,
  fmtCurrency,
  fundedTotal,
  hodBars,
  initials,
  kpiIcon,
  moneyC,
  overdueInvTotal,
  paymentStatusLabel,
  paymentTrend14,
  segStyle,
  subTabStyle,
  topLocationsList,
  totalFuelGal,
} from '../financeData';
import { HorizontalKpi, ICONS, PageTitle, Panel, SkelRows } from '../financeUi';

export function DashboardTab() {
  const { dashSub, setDashSub } = useFinanceCtx();
  const [agingMetric, setAgingMetric] = useState<'debt' | 'invoices'>('debt');

  const subs = [
    { id: 'debtors' as const, label: 'Debtors', icon: ICONS.dollar },
    { id: 'payments' as const, label: 'Payments', icon: ICONS.card },
    { id: 'fueling' as const, label: 'Fueling Patterns', icon: ICONS.trend },
  ];

  const subtitles = {
    debtors: 'Carriers with overdue unpaid invoices · sorted by exposure',
    payments: 'Cross-source payment feed · MX · Zelle · Chase · Stripe',
    fueling: 'Fueling behaviour — day, hour, and location patterns',
  };

  return (
    <div className="mf-fu">
      <div style={s('margin-bottom:16px')}>
        <PageTitle title="Dashboard" sub={subtitles[dashSub]} />
      </div>

      <div style={s('display:flex;gap:4px;padding:4px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);margin-bottom:18px;width:fit-content')}>
        {subs.map((sub) => (
          <button key={sub.id} type="button" className="mf-chip" data-active={dashSub === sub.id ? 'true' : 'false'} onClick={() => setDashSub(sub.id)} style={s(subTabStyle(dashSub === sub.id))}>
            <Svg d={sub.icon} size={15} />
            {sub.label}
          </button>
        ))}
      </div>

      {dashSub === 'debtors' && <DebtorsView agingMetric={agingMetric} setAgingMetric={setAgingMetric} />}
      {dashSub === 'payments' && <PaymentsView />}
      {dashSub === 'fueling' && <FuelingView />}
    </div>
  );
}

function DebtorsView({
  agingMetric,
  setAgingMetric,
}: {
  agingMetric: 'debt' | 'invoices';
  setAgingMetric: (m: 'debt' | 'invoices') => void;
}) {
  const { openClient, dashLoading } = useFinanceCtx();
  const kpis = [
    { label: 'Debtors', kind: 'danger' as const, icon: ICONS.users, color: 'var(--danger)', value: String(DASHBOARD_DEBTORS.length) },
    { label: 'Total Debt', kind: 'danger' as const, icon: ICONS.dollar, color: 'var(--danger)', value: moneyC(debtTotal()) },
    { label: 'Overdue Invoices', kind: 'warn' as const, icon: ICONS.doc, color: 'var(--text)', value: String(overdueInvTotal()) },
    { label: 'Max Overdue', kind: 'orange' as const, icon: ICONS.clock, color: 'var(--text)', value: `${Math.max(...DASHBOARD_DEBTORS.map((d) => d.days))}d` },
  ];
  const aging = agingBuckets(agingMetric);
  const agingLabel = agingMetric === 'debt' ? 'Dollars Overdue' : 'Invoices Overdue';

  return (
    <div className="mf-fu">
      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px')}>
        {kpis.map((k) => (
          <HorizontalKpi key={k.label} icon={k.icon} iconStyle={kpiIcon(k.kind)} value={k.value} label={k.label} color={k.color} />
        ))}
      </div>

      <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);padding:18px 20px;margin-bottom:16px;box-shadow:var(--shadow-sm)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:6px')}>
          <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>Aging — {agingLabel}</span>
          <div style={s('display:flex;gap:3px;padding:3px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
            {([['debt', '$ Debt'], ['invoices', 'Invoices']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setAgingMetric(id)} style={s(segStyle(agingMetric === id))}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={s('display:flex;gap:14px;align-items:flex-end;height:200px;margin-top:18px;padding-top:10px')}>
          {aging.map((b) => (
            <div key={b.label} style={s('flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:8px')}>
              <div style={s("font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--text2)")}>{b.valStr}</div>
              <div className="mf-bar" style={s(`width:100%;max-width:64px;border-radius:8px 8px 3px 3px;background:${b.color};height:${b.h}`)} />
              <div style={s('font-size:11px;font-weight:700;color:var(--text)')}>{b.label}d</div>
              <div style={s('font-size:9.5px;color:var(--muted)')}>{b.inv} inv</div>
            </div>
          ))}
        </div>
      </div>

      <Panel>
        {dashLoading ? (
          <SkelRows n={4} h={58} />
        ) : (
          DASHBOARD_DEBTORS.map((d) => {
          const client = CLIENTS.find((c) => c.carrier === d.carrier);
          const metaClient = client ? `${client.city}, ${client.state}` : d.terms;
          const daysBadge = badge(`${d.days}d`, d.days > 60 ? 'danger' : d.days > 30 ? 'orange' : 'warn');
          return (
            <button
              key={d.carrier}
              type="button"
              className="mf-row"
              onClick={() => client && openClient(client)}
              style={s('display:flex;align-items:center;gap:13px;padding:13px 16px;border-bottom:1px solid var(--border2);cursor:pointer;width:100%;border-left:none;border-right:none;border-top:none;background:transparent;text-align:left')}
            >
              <div style={s('width:36px;height:36px;border-radius:var(--radius-md);background:var(--danger-s);color:var(--danger);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0')}>
                {initials(d.company)}
              </div>
              <div style={s('flex:1;min-width:0')}>
                <div style={s('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{d.company}</div>
                <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>#{d.carrier} · {d.agent} · {metaClient}</div>
              </div>
              <div style={s('display:flex;align-items:center;gap:7px;flex-shrink:0')}>
                <Badge vm={daysBadge} />
                <span style={s('font-size:9.5px;font-weight:700;padding:3px 7px;border-radius:var(--radius-md);background:var(--muted-s);color:var(--text2)')}>{d.inv} inv</span>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:var(--danger);min-width:64px;text-align:right")}>{moneyC(d.debt)}</div>
              </div>
            </button>
          );
        })
        )}
      </Panel>
    </div>
  );
}

function PaymentsView() {
  const { dashLoading } = useFinanceCtx();
  const payTotal = DASHBOARD_PAYMENTS.reduce((s, p) => s + p.amt, 0);
  const approved = DASHBOARD_PAYMENTS.filter((p) => p.st !== 'DECLINED').length;
  const declined = DASHBOARD_PAYMENTS.filter((p) => p.st === 'DECLINED').length;
  const kpis = [
    { label: 'Payments (14d)', kind: 'accent' as const, icon: ICONS.card, color: 'var(--text)', value: String(DASHBOARD_PAYMENTS.length) },
    { label: 'Total Received', kind: 'ok' as const, icon: ICONS.dollar, color: 'var(--ok)', value: moneyC(payTotal) },
    { label: 'Approved', kind: 'ok' as const, icon: ICONS.check, color: 'var(--text)', value: String(approved) },
    { label: 'Declined', kind: 'danger' as const, icon: ICONS.ban, color: 'var(--danger)', value: String(declined) },
  ];
  const trend = paymentTrend14();

  return (
    <div className="mf-fu">
      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px')}>
        {kpis.map((k) => (
          <HorizontalKpi key={k.label} icon={k.icon} iconStyle={kpiIcon(k.kind)} value={k.value} label={k.label} color={k.color} />
        ))}
      </div>

      <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);padding:18px 20px;margin-bottom:16px;box-shadow:var(--shadow-sm)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;margin-bottom:16px')}>
          <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>Payments — Last 14 Days</span>
          <span style={s('font-size:11px;color:var(--muted)')}>by source</span>
        </div>
        <div style={s('display:flex;gap:9px;align-items:flex-end;height:120px')}>
          {trend.map((b) => (
            <div key={b.label} title={b.title} style={s('flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px')}>
              <div className="mf-bar" style={s(`width:100%;max-width:26px;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,var(--accent),rgba(var(--accent-rgb),.5));height:${b.h}`)} />
              <div style={s('font-size:8.5px;color:var(--muted)')}>{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      <Panel>
        {dashLoading ? (
          <SkelRows n={4} h={52} />
        ) : (
          DASHBOARD_PAYMENTS.slice(0, 10).map((p, i) => {
          const srcShort = p.src.split(' ')[0] ?? p.src;
          const srcKind = p.src === 'Zelle' ? 'violet' : p.src === 'Chase' ? 'blue' : p.src === 'Stripe' ? 'orange' : 'accent';
          const stKind = p.st === 'DECLINED' ? 'danger' : 'ok';
          const company = p.det.split('·')[1]?.trim() ?? p.det.split('·')[0]?.trim() ?? p.src;
          return (
            <div key={i} className="mf-row" style={s('display:flex;align-items:center;gap:13px;padding:12px 16px;border-bottom:1px solid var(--border2)')}>
              <Badge vm={badge(srcShort, srcKind)} />
              <div style={s('flex:1;min-width:0')}>
                <div style={s('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{company}</div>
                <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.det} · {dateTimeShort(p.date + 'T12:00:00')}</div>
              </div>
              <Badge vm={badge(paymentStatusLabel(p.st), stKind)} />
              <div style={s("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:var(--ok);min-width:76px;text-align:right")}>{fmtCurrency(p.amt).replace('.00', '')}</div>
            </div>
          );
        })
        )}
      </Panel>
    </div>
  );
}

function FuelingView() {
  const kpis = [
    { label: 'Total Gallons', kind: 'orange' as const, icon: ICONS.fuelKpi, color: 'var(--text)', value: Math.round(totalFuelGal()).toLocaleString() },
    { label: 'Fuel Spend', kind: 'accent' as const, icon: ICONS.dollar, color: 'var(--text)', value: moneyC(fundedTotal()) },
    { label: 'Avg / Fill', kind: 'blue' as const, icon: ICONS.trend, color: 'var(--text)', value: `${(totalFuelGal() / 9).toFixed(1)} gal` },
    { label: 'Discount Saved', kind: 'violet' as const, icon: ICONS.tag, color: 'var(--text)', value: moneyC(discountSaved()) },
  ];

  return (
    <div className="mf-fu">
      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px')}>
        {kpis.map((k) => (
          <HorizontalKpi key={k.label} icon={k.icon} iconStyle={kpiIcon(k.kind)} value={k.value} label={k.label} color={k.color} />
        ))}
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px')}>
        <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);padding:18px 20px;box-shadow:var(--shadow-sm)')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px')}>Fuel Volume by Day</div>
          <div style={s('display:flex;gap:8px;align-items:flex-end;height:150px')}>
            {dowBars().map((b) => (
              <div key={b.label} title={b.title} style={s('flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:7px')}>
                <div className="mf-bar" style={s(`width:100%;max-width:34px;border-radius:6px 6px 2px 2px;background:${b.color};height:${b.h}`)} />
                <div style={s('font-size:10px;font-weight:700;color:var(--text2)')}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);padding:18px 20px;box-shadow:var(--shadow-sm)')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px')}>Peak Fueling Hours</div>
          <div style={s('display:flex;gap:4px;align-items:flex-end;height:150px')}>
            {hodBars().map((b) => (
              <div key={b.label} title={b.title} style={s('flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px')}>
                <div className="mf-bar" style={s(`width:100%;border-radius:4px 4px 1px 1px;background:${b.color};height:${b.h}`)} />
                <div style={s('font-size:8px;color:var(--muted)')}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
        <div style={s('padding:15px 18px;border-bottom:1px solid var(--border);font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>Top Fueling Locations</div>
        {topLocationsList().map((l) => (
          <div key={l.rank} style={s('display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--border2)')}>
            <div style={s("width:26px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:var(--muted)")}>{l.rank}</div>
            <div style={s('flex:1;min-width:0')}>
              <div style={s('font-size:12.5px;font-weight:600')}>
                {l.name} <span style={s('color:var(--muted);font-weight:500')}>{l.state}</span>
              </div>
              <div style={s('position:relative;height:6px;border-radius:99px;background:var(--raised);margin-top:6px;overflow:hidden')}>
                <div className="mf-bar" style={s(`position:absolute;inset:0;width:${l.w};border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))`)} />
              </div>
            </div>
            <div style={s('text-align:right;flex-shrink:0')}>
              <div style={s("font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:var(--accent)")}>{l.spend}</div>
              <div style={s("font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{l.gal}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
