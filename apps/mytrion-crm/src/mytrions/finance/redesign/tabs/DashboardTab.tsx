import { useState } from 'react';

import { useFinanceCtx } from '../ctx';
import { Badge, s, Svg } from '../dc';
import {
  badge,
  dateTimeShort,
  fmtCurrency,
  initials,
  kpiIcon,
  moneyC,
  paymentStatusLabel,
  segStyle,
  subTabStyle,
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
  const { openClient, dashLoading, dashDebtors } = useFinanceCtx();

  // Map raw API DWH payload -> local DashboardDebtor shape
  const debtors = (dashDebtors || []).map((raw) => ({
    company: String(raw.company_name || raw.deal_name || '—'),
    carrier: String(raw.carrier_id || ''),
    agent: String(raw.agent_name || 'System'),
    terms: String(raw.payment_terms || 'Prepay') as any,
    suspended: false, // can map if present
    days: Number(raw.max_debt_days || 0),
    inv: Number(raw.invoice_count || 0),
    debt: Number(raw.total_remaining || raw.total_owed || 0),
  }));

  const localDebtTotal = debtors.reduce((s, d) => s + d.debt, 0);
  const localOverdueInvTotal = debtors.reduce((s, d) => s + d.inv, 0);
  const localTopDebtors = [...debtors].sort((a, b) => b.debt - a.debt).slice(0, 4);
  const maxOverdue = debtors.length > 0 ? Math.max(...debtors.map((d) => d.days)) : 0;

  const kpis = [
    { label: 'Debtors', kind: 'danger' as const, icon: ICONS.users, color: 'var(--danger)', value: String(debtors.length) },
    { label: 'Total Debt', kind: 'danger' as const, icon: ICONS.dollar, color: 'var(--danger)', value: moneyC(localDebtTotal) },
    { label: 'Overdue Invoices', kind: 'warn' as const, icon: ICONS.doc, color: 'var(--text)', value: String(localOverdueInvTotal) },
    { label: 'Max Overdue', kind: 'orange' as const, icon: ICONS.clock, color: 'var(--text)', value: `${maxOverdue}d` },
  ];

  // Local aging calculation based on real payload
  const b60 = debtors.filter((d) => d.days > 60);
  const b30 = debtors.filter((d) => d.days > 30 && d.days <= 60);
  const b15 = debtors.filter((d) => d.days > 15 && d.days <= 30);
  const b0 = debtors.filter((d) => d.days <= 15);

  const localAging = [
    { label: '>60', color: 'var(--danger)', items: b60 },
    { label: '31-60', color: 'var(--orange)', items: b30 },
    { label: '16-30', color: 'var(--warn)', items: b15 },
    { label: '0-15', color: 'var(--ok)', items: b0 },
  ].map((b) => {
    const val = agingMetric === 'debt' ? b.items.reduce((s, d) => s + d.debt, 0) : b.items.reduce((s, d) => s + d.inv, 0);
    const maxVal = agingMetric === 'debt' ? Math.max(1, localDebtTotal) : Math.max(1, localOverdueInvTotal);
    return {
      label: b.label,
      color: b.color,
      inv: b.items.length,
      valStr: agingMetric === 'debt' ? moneyC(val) : String(val),
      h: `${Math.max(2, Math.round((val / maxVal) * 100))}%`,
    };
  });

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
          {localAging.map((b) => (
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
        ) : debtors.length === 0 ? (
          <div style={s('padding:24px;text-align:center;color:var(--muted);font-size:13px')}>No debtors found.</div>
        ) : (
          debtors.slice(0, 10).map((d) => {
          const client = (dashDebtors || []).find((c: any) => c.carrier_id === d.carrier) || (dashDebtors || [])[0];
          const metaClient = client ? `${client.city || ''}, ${client.state || ''}` : d.terms;
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
  const { dashLoading, dashPayments } = useFinanceCtx();

  const payments = (dashPayments || []).map((raw) => ({
    src: String(raw.source || raw.payment_method || 'Zelle') as any,
    date: String(raw.date || raw.created_at || new Date().toISOString()),
    det: String(raw.details || raw.deal_name || raw.company_name || 'Payment'),
    st: String(raw.status || 'POSTED') as any,
    amt: Number(raw.amount || raw.total || 0),
  }));

  const payTotal = payments.reduce((s, p) => s + p.amt, 0);
  const approved = payments.filter((p) => p.st !== 'DECLINED').length;
  const declined = payments.filter((p) => p.st === 'DECLINED').length;
  const kpis = [
    { label: 'Payments (14d)', kind: 'accent' as const, icon: ICONS.card, color: 'var(--text)', value: String(payments.length) },
    { label: 'Total Received', kind: 'ok' as const, icon: ICONS.dollar, color: 'var(--ok)', value: moneyC(payTotal) },
    { label: 'Approved', kind: 'ok' as const, icon: ICONS.check, color: 'var(--text)', value: String(approved) },
    { label: 'Declined', kind: 'danger' as const, icon: ICONS.ban, color: 'var(--danger)', value: String(declined) },
  ];

  const dayMs = 86_400_000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: { dt: number; sum: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dt = today.getTime() - i * dayMs;
    const sum = payments.filter((p) => {
      const pd = new Date(p.date);
      pd.setHours(0, 0, 0, 0);
      return pd.getTime() === dt;
    }).reduce((s, p) => s + p.amt, 0);
    days.push({ dt, sum });
  }
  const maxTrend = Math.max(1, ...days.map((d) => d.sum));
  const trend = days.map((d) => ({
    label: String(new Date(d.dt).getDate()),
    h: `${Math.max(2, Math.round((d.sum / maxTrend) * 100))}%`,
    title: `${new Date(d.dt).toLocaleDateString()}: ${fmtCurrency(d.sum)}`,
  }));

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
        ) : payments.length === 0 ? (
          <div style={s('padding:24px;text-align:center;color:var(--muted);font-size:13px')}>No payments found.</div>
        ) : (
          payments.slice(0, 10).map((p, i) => {
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
  const { fuelingMetrics } = useFinanceCtx();

  const totalGal = Number(fuelingMetrics?.totalGallons || 0);
  const fuelSpend = Number(fuelingMetrics?.totalSpend || 0);
  const avgFill = Number(fuelingMetrics?.avgFill || 0);
  const discount = Number(fuelingMetrics?.discountSaved || 0);

  const kpis = [
    { label: 'Total Gallons', kind: 'orange' as const, icon: ICONS.fuelKpi, color: 'var(--text)', value: Math.round(totalGal).toLocaleString() },
    { label: 'Fuel Spend', kind: 'accent' as const, icon: ICONS.dollar, color: 'var(--text)', value: moneyC(fuelSpend) },
    { label: 'Avg / Fill', kind: 'blue' as const, icon: ICONS.trend, color: 'var(--text)', value: `${avgFill.toFixed(1)} gal` },
    { label: 'Discount Saved', kind: 'violet' as const, icon: ICONS.tag, color: 'var(--text)', value: moneyC(discount) },
  ];

  const dowB = Array.isArray(fuelingMetrics?.dowBars) ? fuelingMetrics.dowBars : [];
  const hodB = Array.isArray(fuelingMetrics?.hodBars) ? fuelingMetrics.hodBars : [];
  const topLocs = Array.isArray(fuelingMetrics?.topLocations) ? fuelingMetrics.topLocations : [];


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
            {dowB.map((b) => (
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
            {hodB.map((b) => (
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
        {topLocs.map((l: any) => (
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
