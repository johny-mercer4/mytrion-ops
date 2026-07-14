import { useState } from 'react';

import { PARENT_SNAPSHOT, fmtCurrency } from '../../data';
import { useFinanceCtx } from '../ctx';
import { s, Svg } from '../dc';
import {
  aiInsight,
  balanceModeLabel,
  balanceModeStyle,
  CLIENTS,
  collectedToday,
  healthScore,
  homeKpis,
  liveFeedItems,
  moneyC,
  topDebtors,
} from '../financeData';
import { ICONS, RowChev } from '../financeUi';

export function HomeTab() {
  const { go, setDashSub, openClient, refreshSync, pushToast } = useFinanceCtx();
  const [balLoading, setBalLoading] = useState(false);
  const [balance, setBalance] = useState(PARENT_SNAPSHOT.balance);
  const health = healthScore();
  const ringOffset = 326.7 * (1 - health.score / 100);
  const goalTarget = 90_000;
  const goalCur = collectedToday();
  const goalPct = Math.min(100, Math.round((goalCur / goalTarget) * 100));
  const goalHint =
    goalPct >= 100 ? 'Goal smashed — streak secured' : `${moneyC(goalTarget - goalCur)} to hit today's target`;
  const capturedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const refreshBalance = () => {
    setBalLoading(true);
    refreshSync();
    setTimeout(() => {
      setBalance(PARENT_SNAPSHOT.balance + Math.random() * 200 - 100);
      setBalLoading(false);
      pushToast('Balance refreshed', 'Latest EFS snapshot loaded.');
    }, 700);
  };

  return (
    <div className="mf-fu">
      <div style={s('display:grid;grid-template-columns:1.5fr 1fr;gap:16px')}>
        <div style={s('position:relative;overflow:hidden;border-radius:16px;padding:22px 24px;background:linear-gradient(125deg, rgba(var(--accent-rgb),.14), rgba(var(--teal-rgb),.07)), var(--surface);border:1px solid var(--border)')}>
          <div style={s('position:absolute;right:-46px;top:-46px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.20),transparent 70%);pointer-events:none')} />
          <div style={s('display:flex;align-items:center;justify-content:space-between')}>
            <div style={s('font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)')}>Parent Balance · EFS Account</div>
            <div style={s('display:flex;align-items:center;gap:8px')}>
              <span style={s(balanceModeStyle(balance))}>{balanceModeLabel(balance)}</span>
              <button type="button" onClick={refreshBalance} aria-label="Refresh balance" className="mf-ico" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                <Svg d={ICONS.refresh} size={14} {...(balLoading ? { style: { animation: 'mf-spin .8s linear infinite' } } : {})} />
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

        <div className="mf-card" style={s('border-radius:16px;padding:18px 20px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;gap:18px')}>
          <div style={s('position:relative;width:104px;height:104px;flex-shrink:0')}>
            <svg width="104" height="104" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--raised)" strokeWidth="10" />
              <circle cx="60" cy="60" r="52" fill="none" stroke={health.color} strokeWidth="10" strokeLinecap="round" strokeDasharray="326.7" strokeDashoffset={ringOffset} style={{ transition: 'stroke-dashoffset .3s ease' }} />
            </svg>
            <div style={s('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center')}>
              <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;line-height:1;color:${health.color}`)}>{health.score}</div>
              <div style={s('font-size:8.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:3px')}>Score</div>
            </div>
          </div>
          <div style={s('min-width:0')}>
            <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase')}>Portfolio Health</div>
            <div style={s(`font-size:12px;color:${health.color};font-weight:700;margin-top:2px`)}>{health.label}</div>
            <div style={s('font-size:11.5px;color:var(--text2);margin-top:8px;line-height:1.4')}>
              Composite of collections, active carriers, and suspension rate. Clear overdue debt to push past 80.
            </div>
          </div>
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1.55fr;gap:16px;margin-top:16px')}>
        <div className="mf-card" style={s('border-radius:16px;padding:18px 20px;background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);display:flex;align-items:center;gap:16px')}>
          <div style={s('width:52px;height:52px;border-radius:13px;background:var(--orange-s);color:var(--orange);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
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
        <div className="mf-card" style={s('border-radius:16px;padding:18px 20px;background:var(--surface);border:1px solid var(--border)')}>
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
        {homeKpis().map((k) => (
          <div key={k.label} className="mf-card" style={s('padding:16px;border-radius:14px;background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);position:relative;overflow:hidden')}>
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
        <div style={s('border-radius:16px;background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)')}>
            <div style={s('display:flex;align-items:center;gap:8px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>
              <span style={s('color:var(--danger);display:flex')}><Svg d={ICONS.alert} size={16} /></span>
              Needs Your Attention
            </div>
            <span style={s('font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:99px;background:var(--danger-s);color:var(--danger)')}>{topDebtors().length}</span>
          </div>
          <div style={s('padding:7px')}>
            {topDebtors(4).map((d) => {
              const client = CLIENTS.find((c) => c.carrier === d.carrier);
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
                    if (client) openClient(client);
                  }}
                  style={s('display:flex;align-items:center;gap:12px;padding:11px 11px;border-radius:11px;cursor:pointer;width:100%;border:none;background:transparent;text-align:left')}
                >
                  <div style={s('width:34px;height:34px;border-radius:9px;background:var(--danger-s);color:var(--danger);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                    <Svg d={ICONS.alert} size={16} />
                  </div>
                  <div style={s('flex:1;min-width:0')}>
                    <div style={s('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{d.company}</div>
                    <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                      {d.inv} overdue invoice{d.inv === 1 ? '' : 's'} · {d.days}d past due
                    </div>
                  </div>
                  <div style={s('text-align:right;flex-shrink:0')}>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:var(--danger)")}>{fmtCurrency(d.debt)}</div>
                    <div style={s(`font-size:9px;font-weight:800;letter-spacing:.03em;margin-top:3px;color:${tagColor}`)}>{tag}</div>
                  </div>
                  <RowChev />
                </button>
              );
            })}
          </div>
        </div>

        <div style={s('border-radius:16px;background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          <div style={s('display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)')}>
            <div style={s('display:flex;align-items:center;gap:8px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase')}>
              <span style={s('width:7px;height:7px;border-radius:50%;background:var(--accent);animation:mf-dot 1.6s ease-in-out infinite')} />
              Live Fuel Activity
            </div>
          </div>
          <div style={s('padding:7px')}>
            {liveFeedItems().map((f) => (
              <div key={f.key} className={f.flash ? 'mf-flash' : undefined} style={s('display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:10px')}>
                <div style={s('width:32px;height:32px;border-radius:9px;background:var(--accent-s);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
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
            ))}
          </div>
        </div>
      </div>

      <div className="mf-card" style={s('margin-top:16px;border-radius:16px;padding:16px 20px;background:linear-gradient(120deg, rgba(var(--accent-rgb),.10), rgba(var(--teal-rgb),.05)), var(--surface);border:1px solid var(--border);display:flex;align-items:center;gap:16px')}>
        <div style={s('width:42px;height:42px;border-radius:12px;background:var(--accent-s);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
          <Svg d={ICONS.spark} size={22} />
        </div>
        <div style={s('flex:1;min-width:0')}>
          <div style={s('font-size:9.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--accent)')}>Mytrion AI · Insight</div>
          <div style={s('font-size:13px;color:var(--text);margin-top:3px;line-height:1.4')}>{aiInsight()}</div>
        </div>
        <button
          type="button"
          className="mf-ico"
          onClick={() => {
            go('dashboard');
            setDashSub('debtors');
          }}
          style={s('height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:11.5px;cursor:pointer;white-space:nowrap;flex-shrink:0')}
        >
          Investigate →
        </button>
      </div>
    </div>
  );
}
