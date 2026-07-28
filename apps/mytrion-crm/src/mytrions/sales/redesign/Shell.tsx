/**
 * Sales Mytrion redesign — the bespoke self-contained shell (ported from the reference
 * prototype): sidebar with nav badges, top bar + live clock, theme toggle, user card, the
 * shared detail + client modals, and the toast. Owns cross-tab chrome; each tab is a
 * self-contained component under ./tabs. (AI chat launcher is disabled for now.)
 * Home gates on a full-page skeleton until primary fetches settle (see HomeTab);
 * other tabs own their own skeletons (no shell-level boot splash).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { s } from './dc';
import { Icon } from './icons';
import { SalesContext, type ClientRecord, type DetailVM, type SalesCtx } from './ctx';
import { ClientModal, type ClientModalTab } from './ClientModal';
import { NAV, NAV_GROUPS, NAVLABEL, TICKETS_ENABLED, timeParts } from './salesData';
import { useSessionUser } from './sessionUser';
import { useSidebarBadges } from './sidebarBadges';
import { MytrionSwitchLink } from '@/components/MytrionSwitchLink';
import { useRetentionRealtime } from './useRetentionRealtime';
import { LeadCallWizardHost } from './LeadCallWizard';
import { DealCallWizardHost } from './DealCallWizard';
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
import './ss-horizon.css';
// After ss-horizon so the tier card shell wins over the generic .ss-card-h surface.
import './dc-clients.css';

import { HomeTab } from './tabs/HomeTab';
import { InboxTab } from './tabs/InboxTab';
import { TicketsTab } from './tabs/TicketsTab';
import { RetentionTab } from './tabs/RetentionTab';
import { VerificationTab } from './tabs/VerificationTab';
import { RecordsTab } from './tabs/RecordsTab';
import { CreateTab } from './tabs/CreateTab';
import { AutoTab } from './tabs/AutoTab';
import { DashTab } from './tabs/DashTab';
import { CarriersTab } from './tabs/CarriersTab';
import { ComingSoonPanel } from './tabs/ComingSoonPanel';
import { TasksTab } from './tabs/TasksTab';
import { soonHue } from './soonTabs';
import { emitKpiActivity, useKpiPresence } from './kpiTelemetry';

/** Wayfinding hue per nav id — the shared --tone-* scale (theme-aware; see styles/horizon.css). */
const NAV_TONE: Record<string, string> = {
  home: 'var(--tone-sky)',
  inbox: 'var(--tone-cyan)',
  tasks: 'var(--tone-emerald)',
  records: 'var(--tone-blue)',
  create: 'var(--tone-emerald)',
  carriers: 'var(--tone-teal)',
  retention: 'var(--tone-orange)',
  tickets: 'var(--tone-amber)',
  verification: 'var(--tone-violet)',
  callHub: 'var(--tone-pink)',
  auto: 'var(--tone-indigo)',
  dash: 'var(--tone-rose)',
};

/** Tabs that render edge-to-edge (own scroll/height), bypassing the centered max-width wrapper. */
const FULL_BLEED = new Set(['tickets']);

export function SalesRedesign() {
  useKpiPresence();
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
  const [focusDashSub, setFocusDashSub] = useState<'sales' | 'company' | 'debtors' | 'powerbi' | null>(
    null,
  );
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
  const badgeCounts: Record<string, number | undefined> = {
    inbox: liveBadges.inbox || undefined,
    // Hide the unread badge while Tickets is parked as Coming soon.
    tickets: TICKETS_ENABLED ? liveBadges.tickets || undefined : undefined,
  };

  const go = useCallback((next: string) => {
    setSection(next);
    setDetail(null);
    emitKpiActivity('navigation.tab_open', {
      entityType: 'tab',
      entityId: next,
    });
  }, []);
  const openDash = useCallback((sub?: 'sales' | 'company' | 'debtors' | 'powerbi') => {
    setFocusDashSub(sub ?? 'sales');
    setSection('dash');
    setDetail(null);
  }, []);
  const clearFocusDashSub = useCallback(() => setFocusDashSub(null), []);
  const openClient = useCallback((c: ClientRecord) => {
    setClient(c);
    setClientTab('overview');
  }, []);
  // Jump to Tickets and flag the ticket the tab should auto-open (e.g. after Create).
  const openTicket = useCallback((ticketId: string) => {
    if (!TICKETS_ENABLED) {
      pushToast('Tickets', 'Coming soon.');
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
      openLead: (nextLead) => {
        emitKpiActivity('crm.lead_open', { entityType: 'lead', entityId: nextLead.id });
        setLead(nextLead);
      },
      openDeal: (nextDeal) => {
        emitKpiActivity('crm.deal_open', { entityType: 'deal', entityId: nextDeal.id });
        setDeal(nextDeal);
      },
      go,
      openDash,
      focusDashSub,
      clearFocusDashSub,
      openTicket,
      focusTicketId: focusTicket,
      clearFocusTicket,
      openAutomation,
      focusAutomationId: focusAutomation,
      clearFocusAutomation,
    }),
    [
      theme,
      pushToast,
      openClient,
      go,
      openDash,
      focusDashSub,
      clearFocusDashSub,
      openTicket,
      focusTicket,
      clearFocusTicket,
      openAutomation,
      focusAutomation,
      clearFocusAutomation,
    ],
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
        style={s('height:100vh;display:flex;flex-direction:row;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:15px;overflow:hidden;position:relative')}
      >
        {/* Ambient Horizon backdrop — the shared mesh + 64px grid + vignette, replacing the two
            bespoke radial gradients that used to live on the root's inline background. z-index:-1
            (with `isolation:isolate` on .ss-root) keeps it above the root's own background and below
            all in-flow content, so it can never cover a panel. */}
        <div className="ss-ambience" aria-hidden="true" style={{ zIndex: -1 }} />
        {/* SIDEBAR */}
        <aside style={s(`flex-shrink:0;width:${navCollapsed ? '68px' : '238px'};transition:width .18s cubic-bezier(.2,0,0,1);display:flex;flex-direction:column;background:color-mix(in srgb, var(--bg) 84%, transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-right:1px solid var(--border);position:relative;z-index:30`)}>
          <div style={s(`display:flex;align-items:flex-start;gap:10px;padding:20px ${navCollapsed ? '0' : '16px'} 14px;${navCollapsed ? 'justify-content:center' : ''}`)}>
            {!navCollapsed && (
              <>
                <div style={s('line-height:1.05;min-width:0;flex:1')}>
                  <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:24px;letter-spacing:.1em;text-transform:uppercase;color:var(--text)")}>
                    MY<span style={s('color:var(--accent-text)')}>TRION</span>
                  </div>
                  <div
                    className="ss-brand-sub"
                    style={s(
                      "margin-top:5px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;letter-spacing:.18em;text-transform:uppercase;line-height:1.15;background:linear-gradient(105deg,var(--accent) 0%,var(--accent-2) 55%,var(--violet) 100%);-webkit-background-clip:text;background-clip:text;color:transparent",
                    )}
                  >
                    Sales
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
                  style={s('flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--text);font-size:14px;font-weight:600')}
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
              <div style={s('padding:10px 12px;font-size:13px;color:var(--muted)')}>No tabs match.</div>
            )}
            {navFiltered.map((group, gi) => (
              <div key={group.id} style={s('display:flex;flex-direction:column;gap:2px')}>
                {gi > 0 && (
                  <div style={s(`height:1px;margin:${navCollapsed ? '6px 10px' : '8px 12px'};background:var(--border)`)} aria-hidden="true" />
                )}
                {group.items.map((n) => {
                  const active = section === n.id;
                  const soon = n.comingSoon === true;
                  const chipHue = soonHue(n.id);
                  // Active background / colour / rail now live in ss-horizon.css (.ss-tab-x.is-active)
                  // so the rail can be a gradient — an inline inset box-shadow cannot be.
                  const style = `display:flex;align-items:center;gap:11px;padding:11px ${navCollapsed ? '0' : '12px'};${navCollapsed ? 'justify-content:center' : ''};width:100%;background:transparent;color:var(--muted);font-size:14px;font-weight:${active ? 700 : 600};cursor:pointer;opacity:${soon && !active ? '.72' : '1'};border-radius:var(--radius-md);overflow:hidden`;
                  return (
                    <button
                      key={n.id}
                      onClick={() => go(n.id)}
                      title={soon ? `${n.label} — coming soon` : navCollapsed ? n.label : undefined}
                      className={`ss-tab-x${active ? ' is-active' : ''}`}
                      style={{ ...s(style), ['--ss-tone' as string]: NAV_TONE[n.id] ?? 'var(--accent)' }}
                    >
                      <span className="ss-tab-ico" style={s('position:relative;flex-shrink:0;display:inline-flex')}>
                        <Icon name={n.icon} size={18} style={{ flexShrink: 0 }} />
                        {navCollapsed && soon ? (
                          <span style={s(`position:absolute;top:-5px;right:-6px;width:8px;height:8px;border-radius:50%;background:${chipHue};border:1.5px solid var(--bg);box-shadow:0 0 0 1px color-mix(in srgb, ${chipHue} 40%, transparent)`)} />
                        ) : null}
                        {navCollapsed && !soon && badgeCounts[n.id] ? (
                          <span style={s('position:absolute;top:-6px;right:-7px;background:var(--accent);color:#fff;font-size:11px;font-weight:800;min-width:14px;height:14px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid var(--bg)')}>{badgeCounts[n.id]}</span>
                        ) : null}
                      </span>
                      {!navCollapsed && <span style={s('flex:1;text-align:left')}>{n.label}</span>}
                      {!navCollapsed && soon ? (
                        <span className="ss-soon-chip" style={{ ['--ss-soon-hue' as string]: chipHue }}>SOON</span>
                      ) : !navCollapsed && badgeCounts[n.id] ? (
                        <span style={s('background:var(--accent);color:#fff;font-size:11px;font-weight:800;min-width:18px;height:18px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px')}>{badgeCounts[n.id]}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div style={s('padding:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px')}>
            {/* Route back to the Mytrion picker. Sales agents now hold more than one Mytrion, and the
                sidebar was a dead end — the only exit was the top bar, which the full-bleed tabs cover.
                Hidden automatically for anyone with a single Mytrion (see MytrionSwitchLink). */}
            <MytrionSwitchLink
              className="ss-ico-btn"
              label={navCollapsed ? '' : 'Switch Mytrion'}
              style={s(`height:38px;padding:0 ${navCollapsed ? '0' : '12px'};display:flex;align-items:center;${navCollapsed ? 'justify-content:center' : 'gap:9px'};border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase`)}
            />
            <button onClick={ctx.toggleTheme} title={navCollapsed ? 'Toggle theme' : undefined} aria-label="Toggle theme" className="ss-ico-btn" style={s(`height:38px;padding:0 ${navCollapsed ? '0' : '12px'};display:flex;align-items:center;${navCollapsed ? 'justify-content:center' : 'gap:9px'};border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase`)}>
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} style={{ flexShrink: 0 }} />
              {!navCollapsed && <span style={s('flex:1;text-align:left')}>{theme === 'light' ? 'Dark' : 'Light'} mode</span>}
            </button>
            <div title={navCollapsed ? displayName : undefined} style={s(`display:flex;align-items:center;gap:10px;padding:8px ${navCollapsed ? '0' : '10px'};${navCollapsed ? 'justify-content:center' : ''};border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)`)}>
              <div style={s('width:32px;height:32px;border-radius:50%;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0')}>{initials}</div>
              {!navCollapsed && (
                <div style={s('line-height:1.2;min-width:0')}>
                  <div style={s('font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{displayName}</div>
                  <div style={s('font-size:11px;color:var(--muted);white-space:nowrap')}>{user.role}</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN COLUMN */}
        <div style={s('flex:1;min-width:0;display:flex;flex-direction:column')}>
          <div style={s('flex-shrink:0;height:54px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--bg) 60%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;z-index:15')}>
            <div style={s('display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden')}>
              <span style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{activeLabel || NAVLABEL[section] || ''}</span>
              {activeLabel && NAVLABEL[section] && NAVLABEL[section] !== activeLabel && (
                <span style={s('font-size:13px;color:var(--muted);font-weight:500;white-space:nowrap;flex-shrink:0')}>{NAVLABEL[section]}</span>
              )}
            </div>
            {admin && <ViewAsPicker />}
            <div style={s("font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted);margin-left:auto;flex-shrink:0")}>{T.timeFmt}</div>
          </div>
          <main className={fullBleed ? undefined : 'ss-scroll'} style={s(`flex:1;min-height:0;position:relative;${fullBleed ? 'overflow:hidden;display:flex' : ''}`)}>
            {/* Keyed on the acted-as agent: switching "View as" remounts the panels so every
                tab refetches under the new identity (the transport sends fresh x-act-as headers).
                Full-bleed tabs (Tickets) fill the whole panel; others center under a max-width. */}
            {/* A Coming-soon placeholder is chrome, not reading content, so it takes the FULL panel
                width rather than the 1180px measure — clamped, it read as a small card floating in a
                large empty page. */}
            <div id="ss-panels" key={actAsKey} style={s((fullBleed || sectionComingSoon) ? 'flex:1;min-width:0;height:100%;padding:16px 18px' : 'max-width:1180px;margin:0 auto;padding:24px 24px 90px')}>
              {sectionComingSoon ? (
                <ComingSoonPanel sectionId={section} />
              ) : (
                <>
                  {section === 'home' && <HomeTab />}
                  {section === 'inbox' && <InboxTab />}
                  {section === 'tasks' && <TasksTab />}
                  {section === 'tickets' && <TicketsTab />}
                  {section === 'retention' && <RetentionTab />}
                  {section === 'verification' && <VerificationTab />}
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
                  <div style={s('font-size:17px;font-weight:700;line-height:1.3')}>{detail.title}</div>
                  <div style={s('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
                    {detail.badges.map((b, i) => <span key={i} style={s(b.style)}>{b.text}</span>)}
                  </div>
                </div>
                <button onClick={() => setDetail(null)} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
                  <Icon name="close" size={15} strokeWidth={2.4} />
                </button>
              </div>
              <div style={s('padding:20px 22px;max-height:52vh;overflow-y:auto')}>
                <p style={s('font-size:14px;line-height:1.7;color:var(--text2);white-space:pre-wrap;margin:0')}>{detail.body}</p>
                <div style={s('margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-size:13px;color:var(--muted)')}>
                  <strong style={s('color:var(--text2)')}>{detail.metaLabel}</strong> {detail.meta}
                </div>
              </div>
              <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end')}>
                <button onClick={() => setDetail(null)} style={s('height:36px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:14px;cursor:pointer')}>Close</button>
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
              emitKpiActivity('crm.call_click', { entityType: 'lead', entityId: lead.id, outcome: 'attempted' });
              // Dial silently when RC isn't ready — no "Phone / backend" error toasts.
              setDialContext({ leadId: lead.id });
              clickToDial(phone);
            }}
          />
        )}
        {deal && (
          <DealModal
            key={deal.id}
            deal={deal}
            onClose={() => setDeal(null)}
            onCall={(phone) => {
              emitKpiActivity('crm.call_click', { entityType: 'deal', entityId: deal.id, outcome: 'attempted' });
              setDialContext({ dealId: deal.id });
              clickToDial(phone);
            }}
          />
        )}


        {/* Forced post-call Lead status wizard — fires on any tab when an outbound lead call ends. */}
        <LeadCallWizardHost pushToast={pushToast} />
        {/* Forced post-call Deal note wizard — fires when an outbound deal call ends. */}
        <DealCallWizardHost pushToast={pushToast} />

        {/* TOAST — portaled under .ss-root, above force modals (z 160). */}
        {toast &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              role="status"
              style={s(
                `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:200;display:flex;align-items:center;gap:11px;padding:13px 18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${toast.tone === 'err' ? 'color-mix(in srgb,var(--danger) 40%,var(--border))' : toast.tone === 'warn' ? 'color-mix(in srgb,var(--warn) 40%,var(--border))' : 'color-mix(in srgb,var(--ok) 35%,var(--border))'};box-shadow:var(--shadow);animation:ss-pop .2s both;max-width:min(420px,92vw)`,
              )}
            >
              <span
                style={s(
                  `width:28px;height:28px;border-radius:var(--radius-md);flex:none;display:flex;align-items:center;justify-content:center;background:${toast.tone === 'err' ? 'color-mix(in srgb,var(--danger) 16%,transparent)' : toast.tone === 'warn' ? 'color-mix(in srgb,var(--warn) 16%,transparent)' : 'color-mix(in srgb,var(--ok) 16%,transparent)'};color:${toast.tone === 'err' ? 'var(--danger)' : toast.tone === 'warn' ? 'var(--warn)' : 'var(--ok)'}`,
                )}
              >
                <Icon
                  name={toast.tone === 'err' ? 'alert' : toast.tone === 'warn' ? 'warn' : 'check'}
                  size={16}
                  strokeWidth={2.4}
                />
              </span>
              <div style={s('min-width:0')}>
                <div style={s('font-size:14px;font-weight:700;color:var(--text)')}>{toast.title}</div>
                <div style={s('font-size:13px;color:var(--muted);line-height:1.4')}>{toast.msg}</div>
              </div>
            </div>,
            document.querySelector('.ss-root') ?? document.body,
          )}
      </div>
    </SalesContext.Provider>
  );
}
