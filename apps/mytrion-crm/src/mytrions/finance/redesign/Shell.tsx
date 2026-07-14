import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSessionUser } from '../../sales/redesign/sessionUser';
import { FinanceContext } from './ctx';
import { s, Svg } from './dc';
import { NAV, NAV_LABEL, navBtnStyle, relTime, suspendedCount, topDebtors, type DashSub, type FinanceSection } from './financeData';
import { ICONS } from './financeUi';
import { ClientModal, TxModal } from './modals';
import { DashboardTab } from './tabs/DashboardTab';
import { ClientsTab } from './tabs/ClientsTab';
import { HomeTab } from './tabs/HomeTab';
import { TransactionsTab } from './tabs/TransactionsTab';
import type { ClientDrillTab } from './financeData';
import type { Client, TransactionLine } from '../data';
import './theme.css';

const SUN = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z';
const MOON = 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z';
const DOLLAR = 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6';

export function FinanceRedesign() {
  const user = useSessionUser();
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [section, setSection] = useState<FinanceSection>('home');
  const [dashSub, setDashSub] = useState<DashSub>('debtors');
  const [booting, setBooting] = useState(true);
  const [bootPct, setBootPct] = useState(8);
  const [, tick] = useState(0);
  const [lastSync, setLastSync] = useState(() => new Date());
  const [toast, setToast] = useState<{ title: string; msg: string } | null>(null);
  const [txSel, setTxSel] = useState<TransactionLine | null>(null);
  const [clientSel, setClientSel] = useState<Client | null>(null);
  const [clientTab, setClientTab] = useState<ClientDrillTab>('invoices');
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    const bootInterval = setInterval(() => {
      setBootPct((p) => Math.min(100, p + 10 + Math.random() * 17));
    }, 150);
    const bootDone = setTimeout(() => {
      clearInterval(bootInterval);
      setBooting(false);
      setBootPct(100);
    }, 1650);
    const clock = setInterval(() => tick((n) => n + 1), 20_000);
    return () => {
      clearInterval(bootInterval);
      clearTimeout(bootDone);
      clearInterval(clock);
    };
  }, []);

  const pushToast = useCallback((title: string, msg: string) => {
    setToast({ title, msg });
    setTimeout(() => setToast(null), 3400);
  }, []);

  const go = useCallback((next: FinanceSection) => {
    setSection(next);
    setTxSel(null);
  }, []);

  const openTx = useCallback((tx: TransactionLine) => setTxSel(tx), []);
  const openClient = useCallback((client: Client, tab: ClientDrillTab = 'invoices') => {
    setClientSel(client);
    setClientTab(tab);
    setDrillLoading(true);
    setTimeout(() => setDrillLoading(false), 650);
  }, []);
  const refreshSync = useCallback(() => setLastSync(new Date()), []);

  const ctx = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      section,
      go,
      dashSub,
      setDashSub,
      pushToast,
      openTx,
      openClient,
      lastSync,
      refreshSync,
    }),
    [theme, section, go, dashSub, pushToast, openTx, openClient, lastSync, refreshSync],
  );

  const timeFmt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const debtorBadge = topDebtors().length;
  const suspendedBadge = suspendedCount();

  return (
    <FinanceContext.Provider value={ctx}>
      <div
        className={`mf-root ${theme === 'light' ? 'light' : ''}`}
        style={s('height:100vh;display:flex;flex-direction:row;background:radial-gradient(1200px 520px at 82% -10%, rgba(var(--accent-rgb),.11), transparent 60%), radial-gradient(900px 480px at -5% 110%, rgba(var(--teal-rgb),.07), transparent 55%), var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:14px;overflow:hidden;position:relative')}
      >
        {booting && (
          <div style={s('position:absolute;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:radial-gradient(700px 420px at 50% 42%, rgba(var(--accent-rgb),.10), transparent 70%), var(--bg)')}>
            <div style={s('position:absolute;top:0;left:0;right:0;height:2px;overflow:hidden')}>
              <div style={s('position:absolute;top:0;left:0;height:2px;width:32%;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:mf-sweep 1.5s linear infinite')} />
            </div>
            <div style={s('position:relative;width:118px;height:118px;display:flex;align-items:center;justify-content:center')}>
              <div style={s('position:absolute;inset:0;border-radius:50%;border:2px solid var(--border)')} />
              <div style={s('position:absolute;inset:0;border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-right-color:rgba(var(--accent-rgb),.5);animation:mf-spin 1s linear infinite')} />
              <div style={s('position:absolute;inset:15px;border-radius:50%;border:1.5px solid transparent;border-bottom-color:var(--accent-2);animation:mf-spin 1.5s linear infinite reverse')} />
              <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;letter-spacing:.13em;text-transform:uppercase;text-align:center;line-height:1.05")}>
                My<span style={s('color:var(--accent)')}>trion</span>
                <br />
                <span style={s('font-size:9px;letter-spacing:.28em;color:var(--muted)')}>FINANCE</span>
              </div>
            </div>
            <div style={s('text-align:center')}>
              <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:.09em;text-transform:uppercase')}>Connecting to Finance</div>
              <div style={s('font-size:12.5px;color:var(--muted);margin-top:5px')}>
                Securing your workspace<span style={{ animation: 'mf-pulse 1.2s infinite' }}>…</span>
              </div>
            </div>
            <div style={s('width:220px;height:3px;border-radius:99px;background:var(--raised);overflow:hidden')}>
              <div style={s(`height:100%;width:${bootPct}%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:99px;transition:width .18s ease`)} />
            </div>
          </div>
        )}

        <aside style={s('flex-shrink:0;width:236px;display:flex;flex-direction:column;background:color-mix(in srgb, var(--bg) 82%, transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-right:1px solid var(--border);position:relative;z-index:30')}>
          <div style={s('display:flex;align-items:center;gap:11px;padding:18px 18px 15px')}>
            <div style={s('width:37px;height:37px;border-radius:11px;background:linear-gradient(140deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;box-shadow:0 5px 16px rgba(var(--accent-rgb),.42);flex-shrink:0')}>
              <Svg d={DOLLAR} size={20} stroke="#04150F" strokeWidth={2.4} />
            </div>
            <div style={s('line-height:1.12;min-width:0')}>
              <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.08em;text-transform:uppercase")}>
                My<span style={s('color:var(--accent)')}>trion</span>
              </div>
              <div style={s('font-size:9px;color:var(--muted);font-weight:700;letter-spacing:.22em;text-transform:uppercase')}>Finance</div>
            </div>
          </div>
          <nav className="mf-scroll" style={s('flex:1;min-height:0;padding:8px 12px;display:flex;flex-direction:column;gap:3px')}>
            <div style={s('font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);padding:8px 10px 5px')}>Workspace</div>
            {NAV.map((item) => {
              const active = section === item.id;
              const badge =
                item.id === 'clients' && suspendedBadge > 0
                  ? String(suspendedBadge)
                  : item.id === 'dashboard' && debtorBadge > 0
                    ? String(debtorBadge)
                    : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  className="mf-nav"
                  style={s(navBtnStyle(active))}
                >
                  <Svg d={item.icon} size={18} />
                  <span style={s('flex:1;text-align:left')}>{item.label}</span>
                  {badge ? (
                    <span style={s('background:var(--accent-s);color:var(--accent);font-size:9.5px;font-weight:800;min-width:19px;height:18px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px')}>
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div style={s('padding:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px')}>
            <button type="button" onClick={ctx.toggleTheme} className="mf-ico" style={s('height:38px;padding:0 12px;display:flex;align-items:center;gap:9px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase')}>
              <Svg d={theme === 'light' ? MOON : SUN} size={16} />
              <span style={s('flex:1;text-align:left')}>{theme === 'light' ? 'Dark' : 'Light'} mode</span>
            </button>
            <div style={s('display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;background:var(--surface);border:1px solid var(--border)')}>
              <div style={s('width:33px;height:33px;border-radius:50%;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#04150F;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0')}>
                {user.initials}
              </div>
              <div style={s('line-height:1.25;min-width:0')}>
                <div style={s('font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{user.name}</div>
                <div style={s('font-size:10px;color:var(--muted);white-space:nowrap')}>{user.role}</div>
              </div>
            </div>
          </div>
        </aside>

        <div style={s('flex:1;min-width:0;display:flex;flex-direction:column')}>
          <div style={s('flex-shrink:0;height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--bg) 58%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;z-index:15')}>
            <div style={s('display:flex;align-items:center;gap:12px')}>
              <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.06em;text-transform:uppercase")}>{NAV_LABEL[section]}</div>
              <span style={s('display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent);background:var(--accent-s);padding:3px 9px;border-radius:99px')}>
                <span style={s('width:6px;height:6px;border-radius:50%;background:var(--accent);animation:mf-dot 1.6s ease-in-out infinite')} />
                Live
              </span>
            </div>
            <div style={s('display:flex;align-items:center;gap:16px')}>
              <div style={s('font-size:11.5px;color:var(--muted)')}>
                Synced <span style={s("color:var(--text2);font-family:'JetBrains Mono',monospace")}>{relTime(lastSync)}</span>
              </div>
              <div style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text2)")}>{timeFmt}</div>
            </div>
          </div>
          <main className="mf-scroll" style={s('flex:1;min-height:0;position:relative')}>
            <div style={s('max-width:1200px;margin:0 auto;padding:22px 24px 96px')}>
              {section === 'home' && <HomeTab />}
              {section === 'transactions' && <TransactionsTab />}
              {section === 'clients' && <ClientsTab />}
              {section === 'dashboard' && <DashboardTab />}
            </div>
          </main>
        </div>

        {txSel ? <TxModal tx={txSel} onClose={() => setTxSel(null)} /> : null}
        {clientSel ? (
          <ClientModal
            client={clientSel}
            tab={clientTab}
            setTab={(t) => {
              setClientTab(t);
              setDrillLoading(true);
              setTimeout(() => setDrillLoading(false), 450);
            }}
            drillLoading={drillLoading}
            onClose={() => setClientSel(null)}
          />
        ) : null}

        {toast ? (
          <div style={s('position:fixed;right:22px;bottom:22px;z-index:400;display:flex;align-items:flex-start;gap:12px;min-width:280px;max-width:380px;padding:14px 15px;border-radius:13px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);animation:mf-slidein .3s cubic-bezier(.2,0,0,1) both')}>
            <div style={s('width:34px;height:34px;border-radius:10px;background:var(--ok-s);color:var(--ok);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
              <Svg d={ICONS.check} size={17} strokeWidth={2.4} />
            </div>
            <div style={s('flex:1;min-width:0')}>
              <div style={s('font-size:13px;font-weight:700;color:var(--text)')}>{toast.title}</div>
              <div style={s('font-size:11.5px;color:var(--muted);margin-top:2px;line-height:1.4')}>{toast.msg}</div>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="mf-ico"
              style={s('width:24px;height:24px;border-radius:7px;border:none;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0')}
            >
              <Svg d={ICONS.close} size={13} strokeWidth={2.2} />
            </button>
          </div>
        ) : null}
      </div>
    </FinanceContext.Provider>
  );
}
