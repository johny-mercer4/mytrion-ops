import { useEffect, useState } from 'react';

import { useFinanceCtx } from '../ctx';
import { s, Svg } from '../dc';
import {
  balanceModeLabel,
  balanceModeStyle,
  kpiIcon,
  moneyC,
} from '../financeData';
import { ICONS, RowChev, SkelBlock } from '../financeUi';

export function HomeTab() {
  const { go, setDashSub, openClient, refreshSync, pushToast, homeLoading, liveFeed, liveNew, resetLiveNew, dashDebtors, clientsFeed, txFeed, fuelingMetrics } = useFinanceCtx();
  const [balLoading, setBalLoading] = useState(true);
  const [balSpin, setBalSpin] = useState(false);
  const [balance, setBalance] = useState(0);

  const rawClients = (clientsFeed || []);
  const rawDebtors = (dashDebtors || []).map((raw) => ({
    company: String(raw.company_name || raw.deal_name || '—'),
    carrier: String(raw.carrier_id || ''),
    terms: String(raw.payment_terms || 'Prepay'),
    days: Number(raw.max_debt_days || 0),
    inv: Number(raw.invoice_count || 0),
    debt: Number(raw.total_remaining || raw.total_owed || 0),
    suspended: !!raw.suspended,
  }));
  const rawTx = (txFeed || []).map((raw) => ({
    amount: Number(raw.amount || raw.total || 0),
    status: String(raw.status || 'POSTED'),
    date: String(raw.date || raw.created_at || new Date().toISOString()),
  }));

  const localDebtTotal = rawDebtors.reduce((s, d) => s + d.debt, 0);
  const activeClientCount = rawClients.filter((c: any) => c.status === 'Active' || c.status === 'Open').length;
  const suspendedCount = rawClients.filter((c: any) => c.suspended).length;
  
  const collectRatio = localDebtTotal > 0 ? Math.max(0, 1 - localDebtTotal / 2_200_000) : 1;
  const activeRatio = activeClientCount / Math.max(1, rawClients.length);
  const suspRatio = 1 - suspendedCount / Math.max(1, rawClients.length);
  const rawScore = Math.round((collectRatio * 0.5 + activeRatio * 0.35 + suspRatio * 0.15) * 100 * 0.92 + 6);
  const healthScore = isNaN(rawScore) ? 80 : Math.min(99, Math.max(0, rawScore));
  const healthColor = healthScore >= 75 ? 'var(--ok)' : healthScore >= 55 ? 'var(--warn)' : 'var(--danger)';
  const healthLabel = healthScore >= 75 ? 'Strong · trending up' : healthScore >= 55 ? 'Watch · action needed' : 'At risk · act today';

  const collectedToday = rawTx.filter(t => t.status !== 'DECLINED').slice(0, 4).reduce((s, t) => s + t.amount, 0);
  const fundedToday = rawTx.slice(0, 5).reduce((s, t) => s + t.amount, 0);

  const deltaStyle = (up: boolean) => `font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:var(--radius-md);background:${up ? 'var(--ok-s)' : 'var(--danger-s)'};color:${up ? 'var(--ok)' : 'var(--danger)'}`;
  const homeKpisList = [
    { label: 'Funded Today', help: 'across all carriers', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', kind: 'accent' as const, color: 'var(--accent)', value: moneyC(fundedToday), delta: '+12%', up: true },
    { label: 'Collected Today', help: 'payments received', icon: 'M5 13l4 4L19 7', kind: 'ok' as const, color: 'var(--ok)', value: moneyC(collectedToday), delta: '+8%', up: true },
    { label: 'Active Clients', help: `of ${rawClients.length} total`, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', kind: 'blue' as const, color: 'var(--text)', value: String(activeClientCount), delta: '+3', up: true },
    { label: 'Debt Outstanding', help: `${rawDebtors.length} debtors`, icon: 'M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z', kind: 'danger' as const, color: 'var(--danger)', value: moneyC(localDebtTotal), delta: '-5%', up: false },
  ].map((k) => ({ ...k, iconStyle: kpiIcon(k.kind), deltaStyle: deltaStyle(k.up) }));

  const topDebtors = [...rawDebtors].sort((a, b) => b.debt - a.debt);

  const insight = topDebtors[0]
    ? `${topDebtors[0].company} now carries ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(topDebtors[0].debt)} across ${topDebtors[0].inv} invoices — the largest single exposure in your book. Weekend fueling is up 14% vs last cycle.`
    : 'Your book is fully collected. Fueling volume peaked Wednesday.';

  const ringOffset = 326.7 * (1 - healthScore / 100);
  const goalTarget = 90_000;
  const goalCur = collectedToday;
  const goalPct = Math.min(100, Math.round((goalCur / goalTarget) * 100));
  const goalHint = goalPct >= 100 ? 'Goal smashed — streak secured' : `${moneyC(goalTarget - goalCur)} to hit today's target`;
  const capturedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  useEffect(() => {
    const t = setTimeout(() => setBalLoading(false), 2100);
    return () => clearTimeout(t);
  }, []);

  const refreshBalance = () => {
    setBalSpin(true);
    setBalLoading(true);
    resetLiveNew();
    refreshSync();
    setTimeout(() => {
      setBalance(Math.random() * 1600);
      setBalLoading(false);
      setBalSpin(false);
      pushToast('Balance refreshed', 'Latest EFS snapshot loaded.', 'success');
    }, 1200);
  };

  return (
    <div className="mf-fu">
      <div style={s('display:grid;grid-template-columns:1.5fr 1fr;gap:16px')}>
        <div style={s('position:relative;overflow:hidden;border-radius:var(--radius-md);padding:22px 24px;background:linear-gradient(125deg, rgba(var(--accent-rgb),.14), rgba(var(--teal-rgb),.07)), var(--surface);border:1px solid var(--border)')}>
          <div style={s('position:absolute;right:-46px;top:-46px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.20),transparent 70%);pointer-events:none')} />
          <div style={s('display:flex;align-items:center;justify-content:space-between')}>
            <div style={s('font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)')}>Parent Balance · EFS Account</div>
            <div style={s('display:flex;align-items:center;gap:8px')}>
              <span style={s(balanceModeStyle(balance))}>{balanceModeLabel(balance)}</span>
              <button type="button" onClick={refreshBalance} aria-label="Refresh balance" className="mf-ico" style={s('width:28px;height:28px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                <Svg d={ICONS.refresh} size={14} {...(balSpin ? { style: { animation: 'mf-spin .8s linear infinite' } } : {})} />
              </button>
            </div>
          </div>
          {balLoading ? (
            <>
              <div className="mf-skel" style={s('width:230px;height:42px;margin:14px 0 6px')} />
              <div className="mf-skel" style={s('width:150px;height:12px')} />
            </>
          ) : (
            <>
              <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:38px;line-height:1.05;margin-top:12px;color:var(--accent);white-space:nowrap")}>
                $ {Number(balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style={s('display:flex;align-items:center;gap:12px;margin-top:9px;flex-wrap:wrap')}>
                <span style={s('font-size:11px;color:var(--muted)')}>
                  Captured <span style={s("font-family:'JetBrains Mono',monospace;color:var(--text2)")}>{capturedAt}</span>
                </span>
                <span style={s('font-size:10.5px;font-weight:700;color:var(--ok)')}>▲ 3.2% today</span>
              </div>
            </>
          )}
        </div>

        <div className="mf-card" style={s('border-radius:var(--radius-md);padding:18px 20px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;gap:18px')}>
          <div style={s('position:relative;width:104px;height:104px;flex-shrink:0')}>
            <svg width="104" height="104" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--raised)" strokeWidth="10" />
              <circle cx="60" cy="60" r="52" fill="none" stroke={healthColor} strokeWidth="10" strokeLinecap="round" strokeDasharray="326.7" strokeDashoffset={ringOffset} style={{ transition: 'stroke-dashoffset .3s ease' }} />
            </svg>
            <div style={s('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center')}>
              <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;line-height:1;color:${healthColor}`)}>{healthScore}</div>
              <div style={s('font-size:8.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:3px')}>Score</div>
            </div>
          </div>
          <div style={s('min-width:0')}>
            <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase')}>Portfolio Health</div>
            <div style={s(`font-size:12px;color:${healthColor};font-weight:700;margin-top:2px`)}>{healthLabel}</div>
            <div style={s('font-size:11.5px;color:var(--text2);margin-top:8px;line-height:1.4')}>
              Composite of collections, active carriers, and suspension rate. Clear overdue debt to push past 80.
            </div>
          </div>
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1.55fr;gap:16px;margin-top:16px')}>
        <div className="mf-card" style={s('border-radius:var(--radius-md);padding:18px 20px;background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);display:flex;align-items:center;gap:16px')}>
          <div style={s('width:52px;height:52px;border-radius:var(--radius-md);background:var(--orange-s);color:var(--orange);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
            <Svg d={ICONS.flame} size={26} />
          </div>
          <div>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;line-height:1")}>
              6<span style={s('font-size:13px;color:var(--muted);margin-left:4px')}>days</span>
            </div>
            <div style={s('font-size:11.5px;color:var(--text2);font-weight:600;margin-top:3px')}>Collections streak</div>
            <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px')}>Keep it alive — clear 1 debtor today</div>
          </div>
        </div>
        <div className="mf-card" style={s('border-radius:var(--radius-md);padding:18px 20px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:baseline;justify-content:space-between')}>
            <span style={s('font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)')}>Today&apos;s Recovery Goal</span>
            <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent)")}>{goalPct}%</span>
          </div>
          <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:20px;margin-top:12px")}>
            <span style={s('color:var(--accent)')}>{moneyC(goalCur)}</span>{' '}
            <span style={s('color:var(--muted);font-size:14px')}>/ {moneyC(goalTarget)}</span>
          </div>
          <div style={s('position:relative;height:9px;border-radius:99px;background:var(--raised);margin:12px 0 8px;overflow:hidden')}>
            <div className="mf-bar" style={s(`position:absolute;inset:0;width:${goalPct}%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .5s ease`)} />
          </div>
          <div style={s('font-size:10.5px;color:var(--muted)')}>{goalHint}</div>
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:16px')}>
        {homeKpisList.map((k) => (
          <div key={k.label} className="mf-card" style={s('padding:16px;border-radius:var(--radius-md);background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);position:relative;overflow:hidden')}>
            <div style={s('display:flex;align-items:center;justify-content:space-between')}>
              <div style={s(k.iconStyle)}><Svg d={k.icon} size={17} /></div>
              <span style={s(k.deltaStyle)}>{k.delta}</span>
            </div>
            <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:23px;margin-top:13px;color:${k.color}`)}>{k.value}</div>
            <div style={s('font-size:11.5px;font-weight:600;color:var(--text);margin-top:2px')}>{k.label}</div>
            <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>{k.help}</div>
          </div>
        ))}
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px')}>
        <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)')}>
            <div style={s('display:flex;align-items:center;gap:8px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>
              <span style={s('color:var(--danger);display:flex')}><Svg d={ICONS.alert} size={16} /></span>
              Needs Your Attention
            </div>
            <span style={s('font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:99px;background:var(--danger-s);color:var(--danger)')}>{topDebtors.length}</span>
          </div>
          <div style={s('padding:7px')}>
            {homeLoading ? (
              <SkelBlock heights={[56, 56, 56]} />
            ) : (
              topDebtors.slice(0, 4).map((d) => {
                const client = rawClients.find((c: any) => c.carrier_id == d.carrier);
                const tag = d.suspended ? 'SUSPENDED' : `${d.days}d`;
                const tagColor = d.suspended ? 'var(--danger)' : 'var(--muted)';
                return (
                  <button
                    key={d.carrier}
                    type="button"
                    className="mf-row"
                    onClick={() => {
                      go('dashboard');
                      setDashSub('debtors');
                      if (client) openClient(client as any);
                    }}
                    style={s('display:flex;align-items:center;gap:12px;padding:11px 11px;border-radius:var(--radius-md);cursor:pointer;width:100%;border:none;background:transparent;text-align:left')}
                  >
                    <div style={s('width:34px;height:34px;border-radius:var(--radius-md);background:var(--danger-s);color:var(--danger);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                      <Svg d={ICONS.alert} size={16} />
                    </div>
                    <div style={s('flex:1;min-width:0')}>
                      <div style={s('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{d.company}</div>
                      <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                        {d.inv} overdue invoice{d.inv === 1 ? '' : 's'} · {d.days}d past due
                      </div>
                    </div>
                    <div style={s('text-align:right;flex-shrink:0')}>
                      <div style={s("font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:var(--danger)")}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(d.debt)}</div>
                      <div style={s(`font-size:9px;font-weight:800;letter-spacing:.03em;margin-top:3px;color:${tagColor}`)}>{tag}</div>
                    </div>
                    <RowChev />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)')}>
            <div style={s('display:flex;align-items:center;gap:8px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>
              <span style={s('width:7px;height:7px;border-radius:50%;background:var(--accent);animation:mf-dot 1.6s ease-in-out infinite')} />
              Live Fuel Activity
            </div>
            {liveNew > 0 ? (
              <span style={s('font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:99px;background:var(--accent-s);color:var(--accent)')}>+{liveNew} new</span>
            ) : null}
          </div>
          <div style={s('padding:7px')}>
            {homeLoading ? (
              <SkelBlock heights={[50, 50, 50]} />
            ) : (
              liveFeed.map((f) => (
                <div key={f.key} className={f.flash ? 'mf-flash' : undefined} style={s('display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:var(--radius-md)')}>
                  <div style={s('width:32px;height:32px;border-radius:var(--radius-md);background:var(--accent-s);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                    <Svg d={ICONS.fuel} size={15} />
                  </div>
                  <div style={s('flex:1;min-width:0')}>
                    <div style={s('font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.company}</div>
                    <div style={s('font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.meta}</div>
                  </div>
                  <div style={s('text-align:right;flex-shrink:0')}>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:var(--accent)")}>{f.amount}</div>
                    <div style={s("font-size:9.5px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{f.grade} · {f.time}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mf-card" style={s('margin-top:16px;border-radius:var(--radius-md);padding:16px 20px;background:linear-gradient(120deg, rgba(var(--accent-rgb),.10), rgba(var(--teal-rgb),.05)), var(--surface);border:1px solid var(--border);display:flex;align-items:center;gap:16px')}>
        <div style={s('width:42px;height:42px;border-radius:var(--radius-md);background:var(--accent-s);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
          <Svg d={ICONS.spark} size={22} />
        </div>
        <div style={s('flex:1;min-width:0')}>
          <div style={s('font-size:9.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--accent)')}>Mytrion AI · Insight</div>
          <div style={s('font-size:13px;color:var(--text);margin-top:3px;line-height:1.4')}>{insight}</div>
        </div>
        <button
          type="button"
          className="mf-ico"
          onClick={() => {
            go('dashboard');
            setDashSub('debtors');
          }}
          style={s('height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:11.5px;cursor:pointer;white-space:nowrap;flex-shrink:0')}
        >
          Investigate →
        </button>
      </div>
    </div>
  );
}
