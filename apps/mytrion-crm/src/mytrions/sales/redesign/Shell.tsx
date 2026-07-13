/**
 * Sales Mytrion redesign — the bespoke self-contained shell (ported from the reference
 * prototype): boot loader, sidebar with nav badges, top bar + live clock, theme toggle,
 * user card, the shared detail + client modals, the floating AI copilot (streaming), and
 * the toast. Owns cross-tab chrome; each tab is a self-contained component under ./tabs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { s, Svg } from './dc';
import { SalesContext, type ClientRecord, type DetailVM, type SalesCtx } from './ctx';
import { badge, NAV, NAVLABEL, timeParts } from './salesData';
import { useSessionUser } from './sessionUser';
import { useLoad, loadClientCards, loadClientActivity } from './live';
import { useSidebarBadges } from './sidebarBadges';
import { getSession } from '@/api/session';
import { useUserContext } from '@/context/UserContextProvider';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { agentKeyFor } from '@/access/mytrions.config';
import { isAdmin } from '@/access/resolveAccess';
import { useChat } from '@/features/chat/useChat';
import { ViewAsPicker } from './ViewAsPicker';
import { LeadModal, DealModal } from './dataCenterModals';
import { RingCentralPhone } from './RingCentralPhone';
import { clickToDial } from './ringcentralDial';
import type { DealVM, LeadVM } from './dataCenterLive';
import './theme.css';

import { HomeTab } from './tabs/HomeTab';
import { InboxTab } from './tabs/InboxTab';
import { TicketsTab } from './tabs/TicketsTab';
import { PoolTab } from './tabs/PoolTab';
import { RecordsTab } from './tabs/RecordsTab';
import { CreateTab } from './tabs/CreateTab';
import { AutoTab } from './tabs/AutoTab';
import { DashTab } from './tabs/DashTab';
import { CarriersTab } from './tabs/CarriersTab';

const SUN = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z';
const MOON = 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z';
const SPARK = 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z';
const PANEL = 'M9 4v16M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z';

/** Tabs that render edge-to-edge (own scroll/height), bypassing the centered max-width wrapper. */
const FULL_BLEED = new Set(['tickets']);

export function SalesRedesign() {
  const user = useSessionUser();
  const userCtx = useUserContext();
  const admin = isAdmin(userCtx);
  const { actingAs } = useImpersonation();
  const actAsKey = actingAs?.zohoUserId ?? 'self';
  // The effective CRM user (acted-as agent for an admin, else the signed-in worker).
  const currentUserId = String(actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '');
  // Live, UNREAD sidebar counts over one servercrm socket: Inbox = messages not yet read (drops as
  // the tab marks them read); Tickets = unread ticket messages (bumped by WS, cleared on open).
  const liveBadges = useSidebarBadges(currentUserId);
  const badgeCounts: Record<string, number | undefined> = {
    inbox: liveBadges.inbox || undefined,
    tickets: liveBadges.tickets || undefined,
  };
  // Collapsible sidebar (icons-only), persisted. Full-bleed tabs (Tickets) fill the whole panel.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ss.nav.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleNav = useCallback(() => {
    setNavCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('ss.nav.collapsed', next ? '1' : '0');
      } catch {
        /* storage disabled — state still toggles for this tab */
      }
      return next;
    });
  }, []);
  // The bespoke copilot is the department's real agent (streams from /v1/agent, tool-grounded),
  // scoped to Sales — the same runtime the shared ChatPanel uses, just in this shell's chrome.
  const chat = useChat(userCtx, 'sales', agentKeyFor('sales'));
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [section, setSection] = useState('home');
  const fullBleed = FULL_BLEED.has(section);
  const [booting, setBooting] = useState(true);
  const [, tick] = useState(0);
  const [toast, setToast] = useState<{ title: string; msg: string } | null>(null);
  const [detail, setDetail] = useState<DetailVM | null>(null);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [clientTab, setClientTab] = useState<'overview' | 'cards' | 'activity'>('overview');
  const [lead, setLead] = useState<LeadVM | null>(null);
  const [deal, setDeal] = useState<DealVM | null>(null);

  // chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatBody = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1750);
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(clock);
    };
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToast = useCallback((title: string, msg: string) => {
    setToast({ title, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const go = useCallback((next: string) => {
    setSection(next);
    setDetail(null);
  }, []);
  const openClient = useCallback((c: ClientRecord) => {
    setClient(c);
    setClientTab('overview');
  }, []);

  const scrollChat = useCallback(() => {
    requestAnimationFrame(() => {
      if (chatBody.current) chatBody.current.scrollTop = chatBody.current.scrollHeight;
    });
  }, []);
  // Keep the transcript pinned to the newest token as the agent streams.
  useEffect(() => {
    if (chatOpen) scrollChat();
  }, [chat.messages, chatOpen, scrollChat]);

  const sendChat = useCallback(
    (raw?: string) => {
      const t = (raw ?? chatInput).trim();
      if (!t || chat.streaming) return;
      chat.send(t);
      setChatInput('');
      scrollChat();
    },
    [chatInput, chat, scrollChat],
  );

  const ctx: SalesCtx = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      pushToast,
      openDetail: setDetail,
      openClient,
      openLead: setLead,
      openDeal: setDeal,
      go,
    }),
    [theme, pushToast, openClient, go],
  );

  const T = timeParts();
  const displayName = user.name;
  const initials = user.initials;
  const chatChips = ['Any stuck applications?', 'Which clients need attention?', 'Summarize my portfolio', "This week's fuel volume?"];

  return (
    <SalesContext.Provider value={ctx}>
      <div
        className={`ss-root ${theme === 'light' ? 'light' : ''}`}
        style={s('height:100vh;display:flex;flex-direction:row;background:radial-gradient(1200px 500px at 78% -8%, rgba(var(--accent-rgb),.10), transparent 60%), radial-gradient(900px 480px at 0% 108%, rgba(var(--violet-rgb),.08), transparent 55%), var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:14px;overflow:hidden;position:relative')}
      >
        {booting && (
          <div style={s('position:absolute;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:radial-gradient(700px 400px at 50% 40%, rgba(var(--accent-rgb),.10), transparent 70%), var(--bg)')}>
            <div style={s('position:absolute;top:0;left:0;right:0;height:2px;overflow:hidden')}>
              <div style={s('position:absolute;top:0;left:0;height:2px;width:34%;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:ss-sweep 1.5s linear infinite')} />
            </div>
            <div style={s('position:relative;width:120px;height:120px;display:flex;align-items:center;justify-content:center')}>
              <div style={s('position:absolute;inset:0;border-radius:50%;border:2px solid var(--border)')} />
              <div style={s('position:absolute;inset:0;border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-right-color:rgba(var(--accent-rgb),.5);animation:ss-spin 1s linear infinite')} />
              <div style={s('position:absolute;inset:16px;border-radius:50%;border:1.5px solid transparent;border-bottom-color:var(--accent-2);animation:ss-spin 1.4s linear infinite reverse')} />
              <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.12em;text-transform:uppercase;text-align:center;line-height:1")}>
                Sales<br />
                <span style={s('color:var(--accent)')}>Mytrion</span>
              </div>
            </div>
            <div style={s('text-align:center')}>
              <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:.08em;text-transform:uppercase;color:var(--text)')}>Connecting to Mytrion</div>
              <div style={s('font-size:12.5px;color:var(--muted);margin-top:5px')}>
                Loading your pipeline<span style={s('animation:ss-pulse 1.2s infinite')}>…</span>
              </div>
            </div>
          </div>
        )}

        {/* SIDEBAR */}
        <aside style={s(`flex-shrink:0;width:${navCollapsed ? '68px' : '238px'};transition:width .18s cubic-bezier(.2,0,0,1);display:flex;flex-direction:column;background:color-mix(in srgb, var(--bg) 84%, transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-right:1px solid var(--border);position:relative;z-index:30`)}>
          <div style={s(`display:flex;align-items:center;gap:11px;padding:18px ${navCollapsed ? '0' : '18px'} 16px;${navCollapsed ? 'justify-content:center' : ''}`)}>
            <div style={s('width:36px;height:36px;border-radius:11px;background:linear-gradient(140deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(var(--accent-rgb),.4);flex-shrink:0')}>
              <Svg d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" size={20} stroke="#fff" />
            </div>
            {!navCollapsed && (
              <>
                <div style={s('line-height:1.1;min-width:0')}>
                  <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.08em;text-transform:uppercase")}>
                    Sales <span style={s('color:var(--accent)')}>Mytrion</span>
                  </div>
                  <div style={s("font-size:9.5px;color:var(--muted);font-weight:600;letter-spacing:.07em;text-transform:uppercase")}>Sales Intelligence</div>
                </div>
                <button onClick={toggleNav} aria-label="Collapse sidebar" title="Collapse sidebar" className="ss-ico-btn" style={s('margin-left:auto;width:28px;height:28px;flex-shrink:0;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                  <Svg d={PANEL} size={15} />
                </button>
              </>
            )}
          </div>
          {navCollapsed && (
            <div style={s('display:flex;justify-content:center;padding:0 0 8px')}>
              <button onClick={toggleNav} aria-label="Expand sidebar" title="Expand sidebar" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                <Svg d={PANEL} size={15} />
              </button>
            </div>
          )}
          <nav className="ss-scroll" style={s('flex:1;min-height:0;padding:6px 12px;display:flex;flex-direction:column;gap:3px')}>
            {NAV.map((n) => {
              const active = section === n.id;
              const soon = n.comingSoon === true;
              const style = `display:flex;align-items:center;gap:11px;padding:10px ${navCollapsed ? '0' : '12px'};${navCollapsed ? 'justify-content:center' : ''};border:none;width:100%;background:${active ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${active ? 'var(--accent)' : 'var(--muted)'};font-size:13px;font-weight:${active ? 700 : 600};cursor:${soon ? 'default' : 'pointer'};opacity:${soon ? '.5' : '1'};border-radius:10px;box-shadow:${active ? 'inset 2.5px 0 0 var(--accent)' : 'none'};transition:background .14s,color .14s`;
              return (
                <button
                  key={n.id}
                  onClick={soon ? undefined : () => go(n.id)}
                  disabled={soon}
                  title={soon ? `${n.label} — coming soon` : navCollapsed ? n.label : undefined}
                  className={soon ? undefined : 'ss-tab-x'}
                  style={s(style)}
                >
                  <span style={s('position:relative;flex-shrink:0;display:inline-flex')}>
                    <Svg d={n.icon} size={18} style={{ flexShrink: 0 }} />
                    {navCollapsed && badgeCounts[n.id] ? (
                      <span style={s('position:absolute;top:-6px;right:-7px;background:var(--accent);color:#fff;font-size:8px;font-weight:800;min-width:14px;height:14px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid var(--bg)')}>{badgeCounts[n.id]}</span>
                    ) : null}
                  </span>
                  {!navCollapsed && <span style={s('flex:1;text-align:left')}>{n.label}</span>}
                  {!navCollapsed && soon ? (
                    <span style={s('font-size:8.5px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)')}>SOON</span>
                  ) : !navCollapsed && badgeCounts[n.id] ? (
                    <span style={s('background:var(--accent);color:#fff;font-size:9.5px;font-weight:800;min-width:18px;height:18px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px')}>{badgeCounts[n.id]}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div style={s('padding:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px')}>
            <button onClick={ctx.toggleTheme} title={navCollapsed ? 'Toggle theme' : undefined} aria-label="Toggle theme" className="ss-ico-btn" style={s(`height:38px;padding:0 ${navCollapsed ? '0' : '12px'};display:flex;align-items:center;${navCollapsed ? 'justify-content:center' : 'gap:9px'};border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase`)}>
              <Svg d={theme === 'light' ? MOON : SUN} size={16} style={{ flexShrink: 0 }} />
              {!navCollapsed && <span style={s('flex:1;text-align:left')}>{theme === 'light' ? 'Dark' : 'Light'} mode</span>}
            </button>
            <div title={navCollapsed ? displayName : undefined} style={s(`display:flex;align-items:center;gap:10px;padding:8px ${navCollapsed ? '0' : '10px'};${navCollapsed ? 'justify-content:center' : ''};border-radius:12px;background:var(--surface);border:1px solid var(--border)`)}>
              <div style={s('width:32px;height:32px;border-radius:50%;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0')}>{initials}</div>
              {!navCollapsed && (
                <div style={s('line-height:1.2;min-width:0')}>
                  <div style={s('font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{displayName}</div>
                  <div style={s('font-size:10px;color:var(--muted);white-space:nowrap')}>{user.role}</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN COLUMN */}
        <div style={s('flex:1;min-width:0;display:flex;flex-direction:column')}>
          <div style={s('flex-shrink:0;height:54px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--bg) 60%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;z-index:15')}>
            <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0")}>{NAVLABEL[section] ?? ''}</div>
            {admin && <ViewAsPicker />}
            <div style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin-left:auto;flex-shrink:0")}>{T.timeFmt}</div>
          </div>
          <main className={fullBleed ? undefined : 'ss-scroll'} style={s(`flex:1;min-height:0;position:relative;${fullBleed ? 'overflow:hidden;display:flex' : ''}`)}>
            {/* Keyed on the acted-as agent: switching "View as" remounts the panels so every
                tab refetches under the new identity (the transport sends fresh x-act-as headers).
                Full-bleed tabs (Tickets) fill the whole panel; others center under a max-width. */}
            <div id="ss-panels" key={actAsKey} style={s(fullBleed ? 'flex:1;min-width:0;height:100%;padding:16px 18px' : 'max-width:1180px;margin:0 auto;padding:24px 24px 90px')}>
              {section === 'home' && <HomeTab />}
              {section === 'inbox' && <InboxTab />}
              {section === 'tickets' && <TicketsTab />}
              {section === 'pool' && <PoolTab />}
              {section === 'records' && <RecordsTab />}
              {section === 'create' && <CreateTab />}
              {section === 'auto' && <AutoTab />}
              {section === 'dash' && <DashTab />}
              {section === 'carriers' && <CarriersTab />}
            </div>
          </main>
        </div>

        {/* DETAIL MODAL */}
        {detail && (
          <div onClick={() => setDetail(null)} style={s('position:fixed;inset:0;z-index:120;background:rgba(3,7,14,.6);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
            <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:520px;border-radius:18px;background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
              <div style={s('display:flex;align-items:flex-start;gap:13px;padding:20px 22px;border-bottom:1px solid var(--border)')}>
                <div style={s(detail.iconStyle)}><Svg d={detail.icon} size={19} /></div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-size:16px;font-weight:700;line-height:1.3')}>{detail.title}</div>
                  <div style={s('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
                    {detail.badges.map((b, i) => <span key={i} style={s(b.style)}>{b.text}</span>)}
                  </div>
                </div>
                <button onClick={() => setDetail(null)} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
                  <Svg d="M18 6L6 18M6 6l12 12" size={15} strokeWidth={2.4} />
                </button>
              </div>
              <div style={s('padding:20px 22px;max-height:52vh;overflow-y:auto')}>
                <p style={s('font-size:13.5px;line-height:1.7;color:var(--text2);white-space:pre-wrap;margin:0')}>{detail.body}</p>
                <div style={s('margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-size:11.5px;color:var(--muted)')}>
                  <strong style={s('color:var(--text2)')}>{detail.metaLabel}</strong> {detail.meta}
                </div>
              </div>
              <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end')}>
                <button onClick={() => setDetail(null)} style={s('height:36px;padding:0 18px;border-radius:9px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* CLIENT MODAL */}
        {client && (
          <ClientModal
            client={client}
            clientTab={clientTab}
            setClientTab={setClientTab}
            onClose={() => setClient(null)}
            onRun={() => { setClient(null); go('auto'); }}
          />
        )}

        {/* DATA CENTER — LEAD / DEAL DRILLDOWNS */}
        {lead && (
          <LeadModal
            lead={lead}
            onClose={() => setLead(null)}
            onCall={(phone) => {
              const ok = clickToDial(phone);
              if (!ok) {
                pushToast(
                  'Phone',
                  phone.trim()
                    ? 'RingCentral is still loading — try again in a moment.'
                    : 'No phone number on this lead.',
                );
              } else {
                pushToast('Calling', phone);
              }
            }}
          />
        )}
        {deal && <DealModal deal={deal} onClose={() => setDeal(null)} />}

        {/* RingCentral Embeddable softphone (floating widget; click-to-dial from Lead modal) */}
        <RingCentralPhone />

        {/* AI CHAT LAUNCHER */}
        <button onClick={() => setChatOpen((o) => { const next = !o; if (next) scrollChat(); return next; })} aria-label="Open Mytrion AI" className="ss-btn-p" style={s('position:fixed;right:24px;bottom:24px;z-index:90;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));box-shadow:0 8px 28px rgba(var(--accent-rgb),.5);display:flex;align-items:center;justify-content:center')}>
          <span style={s('position:absolute;inset:0;border-radius:50%;border:2px solid var(--accent);animation:ss-ring 2.2s ease-out infinite;pointer-events:none')} />
          {chatOpen ? <Svg d="M18 6L6 18M6 6l12 12" size={24} stroke="#fff" strokeWidth={2.4} /> : <Svg d={SPARK} size={25} stroke="#fff" />}
        </button>

        {/* AI CHAT PANEL */}
        {chatOpen && (
          <div style={s('position:fixed;right:24px;bottom:94px;z-index:95;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 130px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;background:var(--surface);border:1px solid var(--border);box-shadow:0 24px 60px rgba(0,0,0,.5);animation:ss-pop .24s cubic-bezier(.2,0,0,1) both')}>
            <div style={s('flex-shrink:0;padding:15px 17px;display:flex;align-items:center;gap:11px;background:linear-gradient(120deg,rgba(var(--accent-rgb),.16),rgba(var(--violet-rgb),.12)),var(--surface);border-bottom:1px solid var(--border)')}>
              <div style={s('position:relative;width:36px;height:36px;border-radius:11px;background:linear-gradient(140deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(var(--accent-rgb),.4)')}>
                <Svg d={SPARK} size={19} stroke="#fff" />
                <span style={s('position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:var(--ok);border:2px solid var(--surface)')} />
              </div>
              <div style={s('flex:1;line-height:1.2')}>
                <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase")}>Mytrion AI</div>
                <div style={s('font-size:10.5px;color:var(--ok);font-weight:600')}>● Online · Sales copilot</div>
              </div>
              <button onClick={() => setChatOpen(false)} aria-label="Close chat" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                <Svg d="M18 6L6 18M6 6l12 12" size={15} strokeWidth={2.4} />
              </button>
            </div>
            <div ref={chatBody} className="ss-scroll" style={s('flex:1;min-height:0;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--bg)')}>
              {chat.messages.length === 0 && (
                <div style={s('display:flex;gap:8px;align-items:flex-end')}>
                  <div style={s('width:26px;height:26px;border-radius:8px;background:linear-gradient(140deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                    <Svg d={SPARK} size={14} stroke="#fff" />
                  </div>
                  <div style={s('max-width:80%;padding:11px 13px;border-radius:14px 14px 14px 4px;background:var(--surface);border:1px solid var(--border);font-size:13px;line-height:1.5;color:var(--text)')}>
                    Hey {user.first} — I'm Mytrion, your sales copilot. Ask me about your pipeline, a carrier, cards, or invoices and I'll pull it up.
                  </div>
                </div>
              )}
              {chat.messages.map((m) => {
                const ai = m.role !== 'user';
                const dots = ai && m.streaming && !m.text;
                return (
                  <div key={m.id} style={s(`display:flex;gap:8px;align-items:flex-end;${ai ? '' : 'flex-direction:row-reverse'}`)}>
                    {ai && (
                      <div style={s('width:26px;height:26px;border-radius:8px;background:linear-gradient(140deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                        <Svg d={SPARK} size={14} stroke="#fff" />
                      </div>
                    )}
                    {dots ? (
                      <div style={s('display:flex;gap:4px;padding:12px 14px;border-radius:14px 14px 14px 4px;background:var(--surface);border:1px solid var(--border)')}>
                        <span style={s('width:6px;height:6px;border-radius:50%;background:var(--muted);animation:ss-dot 1.2s infinite')} />
                        <span style={s('width:6px;height:6px;border-radius:50%;background:var(--muted);animation:ss-dot 1.2s infinite .2s')} />
                        <span style={s('width:6px;height:6px;border-radius:50%;background:var(--muted);animation:ss-dot 1.2s infinite .4s')} />
                      </div>
                    ) : (
                      <div style={s(ai ? 'max-width:80%;padding:11px 13px;border-radius:14px 14px 14px 4px;background:var(--surface);border:1px solid var(--border);font-size:13px;line-height:1.5;color:var(--text);white-space:pre-wrap' : 'max-width:80%;padding:11px 13px;border-radius:14px 14px 4px 14px;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-size:13px;line-height:1.5;white-space:pre-wrap')}>
                        {m.error ? <span style={s('color:var(--danger)')}>{m.error}</span> : m.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={s('flex-shrink:0;border-top:1px solid var(--border);background:var(--surface)')}>
              <div style={s('display:flex;gap:7px;padding:11px 13px 0;overflow-x:auto')}>
                {chatChips.map((c) => (
                  <button key={c} onClick={() => sendChat(c)} disabled={chat.streaming} className="ss-tab-x" style={s('flex-shrink:0;padding:6px 11px;border-radius:99px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap')}>{c}</button>
                ))}
              </div>
              <div style={s('display:flex;gap:9px;align-items:flex-end;padding:11px 13px 13px')}>
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } }} placeholder="Ask about pipeline, cards, invoices…" className="ss-in" style={s('flex:1;height:40px;padding:0 13px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px')} />
                <button onClick={() => sendChat()} aria-label="Send" className="ss-btn-p" style={s('width:40px;height:40px;flex-shrink:0;border-radius:11px;border:none;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TOAST */}
        {toast && (
          <div style={s('position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:130;display:flex;align-items:center;gap:11px;padding:13px 18px;border-radius:12px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);animation:ss-pop .2s both')}>
            <span style={s('width:28px;height:28px;border-radius:8px;background:rgba(52,211,153,.16);color:var(--ok);display:flex;align-items:center;justify-content:center')}><Svg d="M20 6L9 17l-5-5" size={16} strokeWidth={2.4} /></span>
            <div>
              <div style={s('font-size:12.5px;font-weight:700')}>{toast.title}</div>
              <div style={s('font-size:11.5px;color:var(--muted)')}>{toast.msg}</div>
            </div>
          </div>
        )}
      </div>
    </SalesContext.Provider>
  );
}

// ---- client drilldown modal (reference CLIENT DETAIL MODAL) ----

const REC_STATUS: Record<ClientRecord['status'], [string, string]> = {
  active: ['Active', 'var(--ok)'],
  attention: ['Needs attention', 'var(--orange)'],
  debtor: ['Debtor', 'var(--danger)'],
};

function ClientModal({
  client,
  clientTab,
  setClientTab,
  onClose,
  onRun,
}: {
  client: ClientRecord;
  clientTab: 'overview' | 'cards' | 'activity';
  setClientTab: (t: 'overview' | 'cards' | 'activity') => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const [lbl, col] = REC_STATUS[client.status];
  const statusBadge = badge(lbl, col);
  const balColor = client.balance.startsWith('-') ? 'var(--danger)' : 'var(--ok)';
  const initials = client.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const cardsL = useLoad(() => loadClientCards(client.id), [client.id]);
  const actL = useLoad(() => loadClientActivity(client.id), [client.id]);
  const avStyle = `width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
  const tabs: Array<['overview' | 'cards' | 'activity', string]> = [['overview', 'Overview'], ['cards', 'Cards'], ['activity', 'Activity']];
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:118;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:20px;background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle)}>{initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{client.name}</div>
            <div style={s("font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.carrier} · MC {client.mc} · DOT {client.dot}</div>
          </div>
          <span style={s(statusBadge.style)}>{statusBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Svg d="M18 6L6 18M6 6l12 12" size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div style={s('display:flex;gap:4px;padding:0 22px;border-bottom:1px solid var(--border)')}>
          {tabs.map(([id, label]) => {
            const on = clientTab === id;
            return (
              <button key={id} onClick={() => setClientTab(id)} style={s(`padding:8px 15px;border:none;background:none;border-bottom:2px solid ${on ? 'var(--accent)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer`)}>{label}</button>
            );
          })}
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
          {clientTab === 'overview' && (
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
              <div style={s('padding:15px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Primary Contact</div>
                <div style={s('font-size:14px;font-weight:700;margin-top:5px')}>{client.contact}</div>
                <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.phone}</div>
              </div>
              <div style={s('padding:15px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Balance</div>
                <div style={s(`font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px;color:${balColor}`)}>{client.balance}</div>
              </div>
              <div style={s('padding:15px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Cards</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px")}>{client.active}<span style={s('color:var(--muted);font-size:14px')}>/{client.cards}</span> active</div>
              </div>
              <div style={s('padding:15px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Gallons · Cycle</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px;color:var(--violet)")}>{client.gallons}</div>
              </div>
            </div>
          )}
          {clientTab === 'cards' && (
            <div style={s('display:flex;flex-direction:column;gap:10px')}>
              {cardsL.loading && <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>Loading cards…</div>}
              {cardsL.error && <div style={s('font-size:12.5px;color:var(--danger);padding:8px 2px')}>Couldn't load cards — {cardsL.error}</div>}
              {!cardsL.loading && !cardsL.error && (cardsL.data?.length ?? 0) === 0 && (
                <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>No cards on file for this carrier.</div>
              )}
              {(cardsL.data ?? []).map((card, i) => (
                <div key={`${card.num}-${i}`} style={s('display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                  <span style={s("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600")}>{card.num}</span>
                  <span style={s(`font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,${card.tone} 16%,transparent);color:${card.tone}`)}>{card.status}</span>
                </div>
              ))}
            </div>
          )}
          {clientTab === 'activity' && (
            <div style={s('display:flex;flex-direction:column;gap:0')}>
              {actL.loading && <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>Loading activity…</div>}
              {actL.error && <div style={s('font-size:12.5px;color:var(--danger);padding:8px 2px')}>Couldn't load activity — {actL.error}</div>}
              {!actL.loading && !actL.error && (actL.data?.length ?? 0) === 0 && (
                <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>No recent transactions for this carrier.</div>
              )}
              {(actL.data ?? []).map((ev, i, arr) => {
                const line = i < arr.length - 1;
                return (
                  <div key={i} style={s('display:flex;gap:12px')}>
                    <div style={s('display:flex;flex-direction:column;align-items:center')}>
                      <div style={s(`width:9px;height:9px;border-radius:50%;background:${ev.tone}`)} />
                      {line ? <div style={s('width:2px;flex:1;background:var(--border)')} /> : null}
                    </div>
                    <div style={s(line ? 'padding-bottom:18px' : '')}>
                      <div style={s('font-size:12.5px;font-weight:700')}>{ev.title}</div>
                      <div style={s('font-size:11px;color:var(--muted);margin-top:2px')}>{ev.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
          <button onClick={onRun} className="ss-btn-p" style={s('height:38px;padding:0 18px;border-radius:10px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer')}>Run an action</button>
        </div>
      </div>
    </div>
  );
}
