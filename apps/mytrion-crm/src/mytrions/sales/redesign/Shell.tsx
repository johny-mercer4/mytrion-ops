/**
 * Sales Mytrion redesign — the bespoke self-contained shell (ported from the reference
 * prototype): sidebar with nav badges, top bar + live clock, theme toggle, user card, the
 * shared detail + client modals, and the toast. Owns cross-tab chrome; each tab is a
 * self-contained component under ./tabs. (AI chat launcher is disabled for now.)
 * Boot splash removed — tabs own their own skeletons (avoids double loaders on Home).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RingCentralPhone } from '@/components/ringcentral/RingCentralPhone';

import { s } from './dc';
import { Icon } from './icons';
import { SalesContext, type ClientRecord, type DetailVM, type SalesCtx } from './ctx';
import { ClientModal, type ClientModalTab } from './ClientModal';
import { NAV, NAV_GROUPS, NAVLABEL, timeParts } from './salesData';
import { useSessionUser } from './sessionUser';
import { useSidebarBadges } from './sidebarBadges';
import { useRetentionRealtime } from './useRetentionRealtime';
import { getSession } from '@/api/session';
import { useUserContext } from '@/context/UserContextProvider';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { isAdmin } from '@/access/resolveAccess';
import { ViewAsPicker } from './ViewAsPicker';
import { LeadModal, DealModal } from './dataCenterModals';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import { setDialContext } from '@/components/ringcentral/ringcentralEvents';
import { useTheme } from '@/hooks/useTheme';
import type { DealVM, LeadVM } from './dataCenterLive';
import './theme.css';

import { HomeTab } from './tabs/HomeTab';
import { InboxTab } from './tabs/InboxTab';
import { TicketsTab } from './tabs/TicketsTab';
import { RetentionTab } from './tabs/RetentionTab';
import { RecordsTab } from './tabs/RecordsTab';
import { CreateTab } from './tabs/CreateTab';
import { AutoTab } from './tabs/AutoTab';
import { DashTab } from './tabs/DashTab';
import { CarriersTab } from './tabs/CarriersTab';
import { ComingSoonPanel } from './tabs/ComingSoonPanel';

/** Colorful SOON chip hues per parked nav id. */
const SOON_HUE: Record<string, string> = {
  retention: 'var(--orange)',
  verification: 'var(--violet)',
  tickets: 'var(--accent)',
  callHub: 'var(--ok)',
};

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
  const { theme, toggle: toggleTheme } = useTheme();
  const [section, setSection] = useState('home');
  const fullBleed = FULL_BLEED.has(section);
  const [, tick] = useState(0);
  const [toast, setToast] = useState<{ title: string; msg: string; tone: 'ok' | 'warn' | 'err' } | null>(null);
  const [detail, setDetail] = useState<DetailVM | null>(null);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [clientTab, setClientTab] = useState<ClientModalTab>('overview');
  const [lead, setLead] = useState<LeadVM | null>(null);
  const [deal, setDeal] = useState<DealVM | null>(null);
  const [focusTicket, setFocusTicket] = useState<string | null>(null);
  const [focusAutomation, setFocusAutomation] = useState<string | null>(null);
  const [navQuery, setNavQuery] = useState('');

  useEffect(() => {
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(clock);
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
  // Octane /v1/realtime — new retention cases (and pool/ops) push live to this agent.
  useRetentionRealtime(currentUserId, pushToast);
  const sectionComingSoon = NAV.some((n) => n.id === section && n.comingSoon === true);
  // Wayfinding: the top bar leads with the label the user actually clicked, then the author's
  // descriptive title as a muted secondary — so "Data Center" no longer silently becomes "Pipeline Hub".
  const activeLabel = NAV.find((n) => n.id === section)?.label ?? '';
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
      toggleTheme,
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

  const navFiltered = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((n) => n.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [navQuery]);

  return (
    <SalesContext.Provider value={ctx}>
      <div
        className={`ss-root ${theme === 'light' ? 'light' : ''}`}
        style={s('height:100vh;display:flex;flex-direction:row;background:radial-gradient(1200px 500px at 78% -8%, rgba(var(--accent-rgb),.10), transparent 60%), radial-gradient(900px 480px at 0% 108%, rgba(var(--violet-rgb),.08), transparent 55%), var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:14px;overflow:hidden;position:relative')}
      >
        <RingCentralPhone />

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
          {!navCollapsed && (
            <div style={s('padding:0 12px 8px')}>
              <div style={s('display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
                <Icon name="search" size={14} color="var(--muted)" />
                <input
                  value={navQuery}
                  onChange={(e) => setNavQuery(e.target.value)}
                  placeholder="Search tabs…"
                  aria-label="Search tabs"
                  style={s('flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--text);font-size:13px;font-weight:600')}
                />
                {navQuery ? (
                  <button
                    type="button"
                    onClick={() => setNavQuery('')}
                    aria-label="Clear search"
                    className="ss-ico-btn"
                    style={s('width:22px;height:22px;border:none;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0')}
                  >
                    <Icon name="close" size={12} strokeWidth={2.4} />
                  </button>
                ) : null}
              </div>
            </div>
          )}
          <nav className="ss-scroll" style={s('flex:1;min-height:0;padding:6px 12px;display:flex;flex-direction:column;gap:2px')}>
            {navFiltered.length === 0 && !navCollapsed && (
              <div style={s('padding:10px 12px;font-size:12px;color:var(--muted)')}>No tabs match.</div>
            )}
            {navFiltered.map((group, gi) => (
              <div key={group.id} style={s('display:flex;flex-direction:column;gap:2px')}>
                {gi > 0 && (
                  <div style={s(`height:1px;margin:${navCollapsed ? '6px 10px' : '8px 12px'};background:var(--border)`)} aria-hidden="true" />
                )}
                {group.items.map((n) => {
                  const active = section === n.id;
                  const soon = n.comingSoon === true;
                  const soonHue = SOON_HUE[n.id] ?? 'var(--warn)';
                  const style = `display:flex;align-items:center;gap:11px;padding:10px ${navCollapsed ? '0' : '12px'};${navCollapsed ? 'justify-content:center' : ''};border:none;width:100%;background:${active ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${active ? 'var(--accent)' : 'var(--muted)'};font-size:13px;font-weight:${active ? 700 : 600};cursor:pointer;opacity:${soon && !active ? '.72' : '1'};border-radius:var(--radius-md);box-shadow:${active ? 'inset 2.5px 0 0 var(--accent)' : 'none'};transition:background .14s,color .14s,opacity .14s`;
                  return (
                    <button
                      key={n.id}
                      onClick={() => go(n.id)}
                      title={soon ? `${n.label} — coming soon` : navCollapsed ? n.label : undefined}
                      className="ss-tab-x"
                      style={s(style)}
                    >
                      <span style={s('position:relative;flex-shrink:0;display:inline-flex')}>
                        <Icon name={n.icon} size={18} style={{ flexShrink: 0 }} />
                        {navCollapsed && soon ? (
                          <span style={s(`position:absolute;top:-5px;right:-6px;width:8px;height:8px;border-radius:50%;background:${soonHue};border:1.5px solid var(--bg);box-shadow:0 0 0 1px color-mix(in srgb, ${soonHue} 40%, transparent)`)} />
                        ) : null}
                        {navCollapsed && !soon && badgeCounts[n.id] ? (
                          <span style={s('position:absolute;top:-6px;right:-7px;background:var(--accent);color:#fff;font-size:8px;font-weight:800;min-width:14px;height:14px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid var(--bg)')}>{badgeCounts[n.id]}</span>
                        ) : null}
                      </span>
                      {!navCollapsed && <span style={s('flex:1;text-align:left')}>{n.label}</span>}
                      {!navCollapsed && soon ? (
                        <span style={s(`font-size:8.5px;font-weight:800;letter-spacing:.06em;padding:3px 8px;border-radius:99px;color:#fff;background:linear-gradient(135deg, color-mix(in srgb, ${soonHue} 92%, #fff), color-mix(in srgb, ${soonHue} 55%, var(--accent)));box-shadow:0 2px 8px color-mix(in srgb, ${soonHue} 40%, transparent)`)}>SOON</span>
                      ) : !navCollapsed && badgeCounts[n.id] ? (
                        <span style={s('background:var(--accent);color:#fff;font-size:9.5px;font-weight:800;min-width:18px;height:18px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px')}>{badgeCounts[n.id]}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div style={s('padding:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px')}>
            <button onClick={ctx.toggleTheme} title={navCollapsed ? 'Toggle theme' : undefined} aria-label="Toggle theme" className="ss-ico-btn" style={s(`height:38px;padding:0 ${navCollapsed ? '0' : '12px'};display:flex;align-items:center;${navCollapsed ? 'justify-content:center' : 'gap:9px'};border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase`)}>
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} style={{ flexShrink: 0 }} />
              {!navCollapsed && <span style={s('flex:1;text-align:left')}>{theme === 'light' ? 'Dark' : 'Light'} mode</span>}
            </button>
            <div title={navCollapsed ? displayName : undefined} style={s(`display:flex;align-items:center;gap:10px;padding:8px ${navCollapsed ? '0' : '10px'};${navCollapsed ? 'justify-content:center' : ''};border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)`)}>
              <div style={s('width:32px;height:32px;border-radius:50%;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0')}>{initials}</div>
              {!navCollapsed && (
                <div style={s('line-height:1.2;min-width:0')}>
                  <div style={s('font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{displayName}</div>
                  <div style={s('font-size:10px;color:var(--muted);white-space:nowrap')}>{user.role}</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN COLUMN */}
        <div style={s('flex:1;min-width:0;display:flex;flex-direction:column')}>
          <div style={s('flex-shrink:0;height:54px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--bg) 60%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;z-index:15')}>
            <div style={s('display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden')}>
              <span style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{activeLabel || NAVLABEL[section] || ''}</span>
              {activeLabel && NAVLABEL[section] && NAVLABEL[section] !== activeLabel && (
                <span style={s('font-size:12px;color:var(--muted);font-weight:500;white-space:nowrap;flex-shrink:0')}>{NAVLABEL[section]}</span>
              )}
            </div>
            {admin && <ViewAsPicker />}
            <div style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin-left:auto;flex-shrink:0")}>{T.timeFmt}</div>
          </div>
          <main className={fullBleed ? undefined : 'ss-scroll'} style={s(`flex:1;min-height:0;position:relative;${fullBleed ? 'overflow:hidden;display:flex' : ''}`)}>
            {/* Keyed on the acted-as agent: switching "View as" remounts the panels so every
                tab refetches under the new identity (the transport sends fresh x-act-as headers).
                Full-bleed tabs (Tickets) fill the whole panel; others center under a max-width. */}
            <div id="ss-panels" key={actAsKey} style={s(fullBleed && !sectionComingSoon ? 'flex:1;min-width:0;height:100%;padding:16px 18px' : 'max-width:1180px;margin:0 auto;padding:24px 24px 90px')}>
              {sectionComingSoon ? (
                <ComingSoonPanel sectionId={section} />
              ) : (
                <>
                  {section === 'home' && <HomeTab />}
                  {section === 'inbox' && <InboxTab />}
                  {section === 'tickets' && <TicketsTab />}
                  {section === 'retention' && <RetentionTab />}
                  {section === 'records' && <RecordsTab />}
                  {section === 'create' && <CreateTab />}
                  {section === 'auto' && <AutoTab />}
                  {section === 'dash' && <DashTab />}
                  {section === 'carriers' && <CarriersTab />}
                </>
              )}
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
                <div style={s('margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)')}>
                  <strong style={s('color:var(--text2)')}>{detail.metaLabel}</strong> {detail.meta}
                </div>
              </div>
              <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end')}>
                <button onClick={() => setDetail(null)} style={s('height:36px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:13px;cursor:pointer')}>Close</button>
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
            key={lead.id}
            lead={lead}
            onClose={() => setLead(null)}
            onCall={(phone) => {
              // Dial silently when RC isn't ready — no "Phone / backend" error toasts.
              setDialContext({ leadId: lead.id });
              if (clickToDial(phone)) pushToast('Calling', phone);
            }}
          />
        )}
        {deal && (
          <DealModal
            key={deal.id}
            deal={deal}
            onClose={() => setDeal(null)}
            onCall={(phone) => {
              setDialContext({ dealId: deal.id });
              if (clickToDial(phone)) pushToast('Calling', phone);
            }}
          />
        )}


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
              <div style={s('font-size:13px;font-weight:700;color:var(--text)')}>{toast.title}</div>
              <div style={s('font-size:12px;color:var(--muted);line-height:1.4')}>{toast.msg}</div>
            </div>
          </div>
        )}
      </div>
    </SalesContext.Provider>
  );
}
