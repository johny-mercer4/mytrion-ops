/**
 * Sales Mytrion redesign — the bespoke self-contained shell (ported from the reference
 * prototype): boot loader, sidebar with nav badges, top bar + live clock, theme toggle,
 * user card, the shared detail + client modals, and the toast. Owns cross-tab chrome; each
 * tab is a self-contained component under ./tabs. (AI chat launcher is disabled for now.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { s } from './dc';
import { Icon } from './icons';
import { SalesContext, type ClientRecord, type DetailVM, type SalesCtx } from './ctx';
import { badge, NAV, NAVLABEL, timeParts } from './salesData';
import { useSessionUser } from './sessionUser';
import { useLoad } from './live';
import {
  loadClientCards,
  loadClientActivity,
  CLIENT_ACTIVITY_PAGE,
  type ClientActivityVM,
} from './clientDrilldown';
import { useSidebarBadges } from './sidebarBadges';
import { getSession } from '@/api/session';
import { useUserContext } from '@/context/UserContextProvider';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { isAdmin } from '@/access/resolveAccess';
import { ViewAsPicker } from './ViewAsPicker';
import { LeadModal, DealModal } from './dataCenterModals';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
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
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [section, setSection] = useState('home');
  const fullBleed = FULL_BLEED.has(section);
  const [booting, setBooting] = useState(true);
  const [, tick] = useState(0);
  const [toast, setToast] = useState<{ title: string; msg: string; tone: 'ok' | 'warn' | 'err' } | null>(null);
  const [detail, setDetail] = useState<DetailVM | null>(null);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [clientTab, setClientTab] = useState<'overview' | 'cards' | 'activity'>('overview');
  const [lead, setLead] = useState<LeadVM | null>(null);
  const [deal, setDeal] = useState<DealVM | null>(null);
  const [focusTicket, setFocusTicket] = useState<string | null>(null);
  const [focusAutomation, setFocusAutomation] = useState<string | null>(null);

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
    const t = title.toLowerCase();
    const tone: 'ok' | 'warn' | 'err' =
      /couldn|can.t|fail|error|too large/.test(t) ? 'err'
        : /already exists|couldn.t be attached|partial/.test(t) ? 'warn'
          : 'ok';
    setToast({ title, msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === 'err' ? 4200 : 3200);
  }, []);

  // Live, UNREAD sidebar counts over one servercrm socket: Inbox = messages not yet read (drops as
  // the tab marks them read); Tickets = unread ticket messages (bumped by WS, cleared on open). Shell-
  // level (not tab-scoped) so the toast on a new inbox message fires no matter which tab is open.
  const liveBadges = useSidebarBadges(currentUserId, pushToast);
  const ticketsComingSoon = NAV.some((n) => n.id === 'tickets' && n.comingSoon === true);
  const badgeCounts: Record<string, number | undefined> = {
    inbox: liveBadges.inbox || undefined,
    // Hide the unread badge while Tickets is parked as Coming soon.
    tickets: ticketsComingSoon ? undefined : liveBadges.tickets || undefined,
  };

  const go = useCallback((next: string) => {
    setSection(next);
    setDetail(null);
  }, []);
  const openClient = useCallback((c: ClientRecord) => {
    setClient(c);
    setClientTab('overview');
  }, []);
  // Jump to Tickets and flag the ticket the tab should auto-open (e.g. after Create).
  const openTicket = useCallback((ticketId: string) => {
    if (NAV.some((n) => n.id === 'tickets' && n.comingSoon === true)) {
      pushToast('Tickets', 'Coming soon — use Data Center for leads and deals.');
      return;
    }
    setFocusTicket(ticketId);
    setSection('tickets');
    setDetail(null);
  }, [pushToast]);
  const clearFocusTicket = useCallback(() => setFocusTicket(null), []);
  // Jump to Automations and open the matching catalog action (Create Ticket Instant redirect).
  const openAutomation = useCallback((automationId: string) => {
    setFocusAutomation(automationId);
    setSection('auto');
    setDetail(null);
  }, []);
  const clearFocusAutomation = useCallback(() => setFocusAutomation(null), []);

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
      openTicket,
      focusTicketId: focusTicket,
      clearFocusTicket,
      openAutomation,
      focusAutomationId: focusAutomation,
      clearFocusAutomation,
    }),
    [theme, pushToast, openClient, go, openTicket, focusTicket, clearFocusTicket, openAutomation, focusAutomation, clearFocusAutomation],
  );

  const T = timeParts();
  const displayName = user.name;
  const initials = user.initials;

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
            <div style={s('width:36px;height:36px;border-radius:var(--radius-md);background:linear-gradient(140deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(var(--accent-rgb),.4);flex-shrink:0')}>
              <Icon name="rocket" size={20} color="#fff" />
            </div>
            {!navCollapsed && (
              <>
                <div style={s('line-height:1.1;min-width:0')}>
                  <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.08em;text-transform:uppercase")}>
                    Sales <span style={s('color:var(--accent)')}>Mytrion</span>
                  </div>
                </div>
                <button onClick={toggleNav} aria-label="Collapse sidebar" title="Collapse sidebar" className="ss-ico-btn" style={s('margin-left:auto;width:28px;height:28px;flex-shrink:0;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                  <Icon name="panel" size={15} />
                </button>
              </>
            )}
          </div>
          {navCollapsed && (
            <div style={s('display:flex;justify-content:center;padding:0 0 8px')}>
              <button onClick={toggleNav} aria-label="Expand sidebar" title="Expand sidebar" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
                <Icon name="panel" size={15} />
              </button>
            </div>
          )}
          <nav className="ss-scroll" style={s('flex:1;min-height:0;padding:6px 12px;display:flex;flex-direction:column;gap:3px')}>
            {NAV.map((n) => {
              const active = section === n.id;
              const soon = n.comingSoon === true;
              const style = `display:flex;align-items:center;gap:11px;padding:10px ${navCollapsed ? '0' : '12px'};${navCollapsed ? 'justify-content:center' : ''};border:none;width:100%;background:${active ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${active ? 'var(--accent)' : 'var(--muted)'};font-size:13px;font-weight:${active ? 700 : 600};cursor:${soon ? 'default' : 'pointer'};opacity:${soon ? '.5' : '1'};border-radius:var(--radius-md);box-shadow:${active ? 'inset 2.5px 0 0 var(--accent)' : 'none'};transition:background .14s,color .14s`;
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
                    <Icon name={n.icon} size={18} style={{ flexShrink: 0 }} />
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
            <button onClick={ctx.toggleTheme} title={navCollapsed ? 'Toggle theme' : undefined} aria-label="Toggle theme" className="ss-ico-btn" style={s(`height:38px;padding:0 ${navCollapsed ? '0' : '12px'};display:flex;align-items:center;${navCollapsed ? 'justify-content:center' : 'gap:9px'};border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase`)}>
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} style={{ flexShrink: 0 }} />
              {!navCollapsed && <span style={s('flex:1;text-align:left')}>{theme === 'light' ? 'Dark' : 'Light'} mode</span>}
            </button>
            <div title={navCollapsed ? displayName : undefined} style={s(`display:flex;align-items:center;gap:10px;padding:8px ${navCollapsed ? '0' : '10px'};${navCollapsed ? 'justify-content:center' : ''};border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)`)}>
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
              {section === 'tickets' && !ticketsComingSoon && <TicketsTab />}
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
            <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:520px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
              <div style={s('display:flex;align-items:flex-start;gap:13px;padding:20px 22px;border-bottom:1px solid var(--border)')}>
                <div style={s(detail.iconStyle)}><Icon name={detail.icon} size={19} /></div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-size:16px;font-weight:700;line-height:1.3')}>{detail.title}</div>
                  <div style={s('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
                    {detail.badges.map((b, i) => <span key={i} style={s(b.style)}>{b.text}</span>)}
                  </div>
                </div>
                <button onClick={() => setDetail(null)} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
                  <Icon name="close" size={15} strokeWidth={2.4} />
                </button>
              </div>
              <div style={s('padding:20px 22px;max-height:52vh;overflow-y:auto')}>
                <p style={s('font-size:13.5px;line-height:1.7;color:var(--text2);white-space:pre-wrap;margin:0')}>{detail.body}</p>
                <div style={s('margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-size:11.5px;color:var(--muted)')}>
                  <strong style={s('color:var(--text2)')}>{detail.metaLabel}</strong> {detail.meta}
                </div>
              </div>
              <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end')}>
                <button onClick={() => setDetail(null)} style={s('height:36px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
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


        {/* TOAST */}
        {toast && (
          <div
            role="status"
            style={s(`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:140;display:flex;align-items:center;gap:11px;padding:13px 18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${toast.tone === 'err' ? 'color-mix(in srgb,var(--danger) 35%,var(--border))' : toast.tone === 'warn' ? 'color-mix(in srgb,var(--warn) 35%,var(--border))' : 'var(--border)'};box-shadow:var(--shadow);animation:ss-pop .2s both;max-width:min(420px,92vw)`)}
          >
            <span style={s(`width:28px;height:28px;border-radius:var(--radius-md);flex:none;display:flex;align-items:center;justify-content:center;background:${toast.tone === 'err' ? 'color-mix(in srgb,var(--danger) 16%,transparent)' : toast.tone === 'warn' ? 'color-mix(in srgb,var(--warn) 16%,transparent)' : 'color-mix(in srgb,var(--ok) 16%,transparent)'};color:${toast.tone === 'err' ? 'var(--danger)' : toast.tone === 'warn' ? 'var(--warn)' : 'var(--ok)'}`)}>
              <Icon
                name={toast.tone === 'err' ? 'alert' : toast.tone === 'warn' ? 'warn' : 'check'}
                size={16}
                strokeWidth={2.4}
              />
            </span>
            <div style={s('min-width:0')}>
              <div style={s('font-size:12.5px;font-weight:700;color:var(--text)')}>{toast.title}</div>
              <div style={s('font-size:11.5px;color:var(--muted);line-height:1.4')}>{toast.msg}</div>
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
  const initials = client.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const cardsL = useLoad(() => loadClientCards(client.id), [client.id]);
  const [actRows, setActRows] = useState<ClientActivityVM[]>([]);
  const [actLimit, setActLimit] = useState(CLIENT_ACTIVITY_PAGE);
  const [actHasMore, setActHasMore] = useState(false);
  const [actLoading, setActLoading] = useState(false);
  const [actLoadingMore, setActLoadingMore] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setActRows([]);
    setActLimit(CLIENT_ACTIVITY_PAGE);
    setActHasMore(false);
    setActError(null);
    setActLoading(true);
    void loadClientActivity(client.id, CLIENT_ACTIVITY_PAGE)
      .then((page) => {
        if (off) return;
        setActRows(page.rows);
        setActHasMore(page.hasMore);
        setActLimit(page.limit);
      })
      .catch((e: unknown) => {
        if (!off) setActError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!off) setActLoading(false);
      });
    return () => {
      off = true;
    };
  }, [client.id]);

  const loadMoreActivity = (): void => {
    if (actLoadingMore || !actHasMore) return;
    const next = actLimit + CLIENT_ACTIVITY_PAGE;
    setActLoadingMore(true);
    void loadClientActivity(client.id, next)
      .then((page) => {
        setActRows(page.rows);
        setActHasMore(page.hasMore && page.rows.length > actRows.length);
        setActLimit(page.limit);
      })
      .catch((e: unknown) => setActError(e instanceof Error ? e.message : 'Failed to load more'))
      .finally(() => setActLoadingMore(false));
  };

  const avStyle = `width:52px;height:52px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
  const tabs: Array<['overview' | 'cards' | 'activity', string]> = [['overview', 'Overview'], ['cards', 'Cards'], ['activity', 'Activity']];
  const tile = 'padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:118;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle)}>{initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{client.name}</div>
            <div style={s("font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.carrier} · MC {client.mc} · DOT {client.dot}</div>
          </div>
          <span style={s(statusBadge.style)}>{statusBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Icon name="close" size={15} strokeWidth={2.4} />
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
              <div style={s(`grid-column:1 / span 2;${tile}`)}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Primary Contact</div>
                <div style={s('font-size:14px;font-weight:700;margin-top:5px')}>{client.contact}</div>
                <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.phone}</div>
              </div>
              <div style={s(tile)}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Cards</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px")}>{client.active}<span style={s('color:var(--muted);font-size:14px')}>/{client.cards}</span> active</div>
              </div>
              <div style={s(tile)}>
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
                <div key={`${card.num}-${i}`} style={s('display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                  <span style={s("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600")}>{card.num}</span>
                  <span style={s(`font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,${card.tone} 16%,transparent);color:${card.tone}`)}>{card.status}</span>
                </div>
              ))}
            </div>
          )}
          {clientTab === 'activity' && (
            <div style={s('display:flex;flex-direction:column;gap:0')}>
              {actLoading && <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>Loading activity…</div>}
              {actError && <div style={s('font-size:12.5px;color:var(--danger);padding:8px 2px')}>Couldn't load activity — {actError}</div>}
              {!actLoading && !actError && actRows.length === 0 && (
                <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>No transactions for this carrier.</div>
              )}
              {actRows.map((ev, i, arr) => {
                const line = i < arr.length - 1;
                return (
                  <div key={`${ev.title}-${i}`} style={s('display:flex;gap:12px')}>
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
              {actHasMore && (
                <button
                  type="button"
                  disabled={actLoadingMore}
                  onClick={loadMoreActivity}
                  style={s('margin-top:16px;height:36px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12px;cursor:pointer;opacity:' + (actLoadingMore ? '.6' : '1'))}
                >
                  {actLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
          <button onClick={onRun} className="ss-btn-p" style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer')}>Run an action</button>
        </div>
      </div>
    </div>
  );
}
