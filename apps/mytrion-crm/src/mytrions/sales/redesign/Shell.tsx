/**
 * Sales Mytrion redesign — the bespoke self-contained shell (ported from the reference
 * prototype): sidebar with nav badges, top bar + live clock, theme toggle, user card, the
 * shared detail + client modals, and the toast. Owns cross-tab chrome; each tab is a
 * self-contained component under ./tabs. (AI chat launcher is disabled for now.)
 *
 * Two chrome invariants live here:
 *  - the top bar is the ONLY place a section is named, so no tab repeats its own title;
 *  - the Suspense fallback is the SAME skeleton shape the tab shows while its data loads, so a cold
 *    open plays one loading state instead of spinner → skeleton → content.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { s } from './dc';
import { Icon } from './icons';
import { SalesContext, type ClientRecord, type DetailVM, type SalesCtx } from './ctx';
import { MytrionShell, type NavSection } from '../../_shared/MytrionShell';
import { ClientModal, type ClientModalTab } from './ClientModal';
import { NAV, NAV_GROUPS, TICKETS_ENABLED, isSectionParked } from './salesData';
import { isAdmin } from '@/access/resolveAccess';
import { useUserContext } from '@/context/UserContextProvider';
import { useSidebarBadges } from './sidebarBadges';
import { useRetentionRealtime } from './useRetentionRealtime';
import { LeadCallWizardHost } from './LeadCallWizard';
import { DealCallWizardHost } from './DealCallWizard';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { LeadModal, DealModal } from './dataCenterModals';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import { setDialContext } from '@/components/ringcentral/ringcentralEvents';
import { useTheme } from '@/hooks/useTheme';
import type { DealVM, LeadVM } from './dataCenterLive';
import './theme.css';
import './ss-horizon.css';
import './verification.css';
import './verificationForms.css';
// After ss-horizon so the tier card shell wins over the generic .ss-card-h surface.
import './dc-clients.css';
// Last: the shared page scaffold (head / metrics / sub-tabs / empty / pager) wins over the
// per-tab surfaces it replaces.
import './sales-page.css';

import { HomeTab } from './tabs/HomeTab';
import { ComingSoonPanel } from './tabs/ComingSoonPanel';
import { emitKpiActivity, useKpiPresence } from './kpiTelemetry';
import { useAccessibleDialog } from './useAccessibleDialog';
import { SalesTabSkeleton, type SalesSkeletonVariant } from './SalesTabSkeleton';

// Home is above-the-fold and ships with the shell. Every other Sales workspace is split into its
// own chunk so a cold Home visit does not parse Verification, Tickets, exports, dashboards and the
// automation catalog before the user asks for them.
const InboxTab = lazy(() => import('./tabs/InboxTab').then((module) => ({ default: module.InboxTab })));
const TasksTab = lazy(() => import('./tabs/TasksTab').then((module) => ({ default: module.TasksTab })));
const TicketConsole = lazy(() => import('@/features/comms/TicketConsole').then((module) => ({ default: module.TicketConsole })));
const RetentionTab = lazy(() => import('./tabs/RetentionTab').then((module) => ({ default: module.RetentionTab })));
const VerificationTab = lazy(() => import('./tabs/VerificationTab').then((module) => ({ default: module.VerificationTab })));
const CallHubTab = lazy(() => import('./tabs/CallHubTab').then((module) => ({ default: module.CallHubTab })));
const RecordsTab = lazy(() => import('./tabs/RecordsTab').then((module) => ({ default: module.RecordsTab })));
const CreateTab = lazy(() => import('./tabs/CreateTab').then((module) => ({ default: module.CreateTab })));
const AutoTab = lazy(() => import('./tabs/AutoTab').then((module) => ({ default: module.AutoTab })));
const DashTab = lazy(() => import('./tabs/DashTab').then((module) => ({ default: module.DashTab })));
const CarriersTab = lazy(() => import('./tabs/CarriersTab').then((module) => ({ default: module.CarriersTab })));

/**
 * Chunk-load placeholder per section — the SAME shape the tab itself shows while its data loads,
 * so a cold open reads as one skeleton filling in rather than spinner → skeleton → content.
 * `metrics` mirrors whether that tab's header carries a metric strip.
 */
const TAB_SKELETON: Record<string, { variant: SalesSkeletonVariant; metrics?: boolean; width?: 'narrow' }> = {
  inbox: { variant: 'rows' },
  tasks: { variant: 'board', metrics: true },
  tickets: { variant: 'rows' },
  retention: { variant: 'board', metrics: true },
  verification: { variant: 'grid' },
  callHub: { variant: 'rows', metrics: true },
  records: { variant: 'grid' },
  create: { variant: 'form', width: 'narrow' },
  auto: { variant: 'grid' },
  dash: { variant: 'panels' },
  carriers: { variant: 'rows' },
};

function SalesTabLoader({ section, label }: { section: string; label: string }): JSX.Element {
  const shape = TAB_SKELETON[section] ?? { variant: 'rows' as SalesSkeletonVariant };
  return (
    <SalesTabSkeleton
      variant={shape.variant}
      metrics={shape.metrics === true}
      label={label}
      {...(shape.width ? { width: shape.width } : {})}
    />
  );
}

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

/**
 * Tabs that render edge-to-edge (own scroll/height), bypassing the centered max-width wrapper.
 * Only consulted for a LIVE tab — a parked one shows the ComingSoonPanel, which wants the normal
 * page padding, not a full-height flex child.
 */
const FULL_BLEED = new Set(['tickets']);

export function SalesRedesign() {
  useKpiPresence();
  const { actingAs } = useImpersonation();
  const actAsKey = actingAs?.zohoUserId ?? 'self';
  // The effective CRM user (acted-as agent for an admin, else the signed-in worker).
  const currentUserId = String(actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '');
  // Collapsible sidebar (icons-only), persisted. Full-bleed tabs (Tickets) fill the whole panel.
  const { theme, toggle: toggleTheme } = useTheme();
  const [section, setSection] = useState('home');
  // Admin sees the Sales-side Verification tab; everyone else gets Coming soon. Verification's own
  // Mytrion is unaffected — this is the Sales projection of it only.
  const admin = isAdmin(useUserContext());  // hook call is unconditional — same position every render
  const parkedSection = isSectionParked(section, admin);
  const fullBleed = FULL_BLEED.has(section) && !parkedSection;
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
  const closeDetail = useCallback(() => setDetail(null), []);
  const detailDialogRef = useAccessibleDialog(detail !== null, closeDetail);


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
  // the tab marks them read); Tickets = unread comms messages from /v1/comms. Shell-level (not tab-scoped)
  // so the toast on a new inbox message fires no matter which tab is open.
  const liveBadges = useSidebarBadges(currentUserId);
  // Octane /v1/realtime — new retention cases (and pool/ops) push live to this agent.
  useRetentionRealtime(currentUserId, pushToast);
  const sectionComingSoon = parkedSection;
  /**
   * The top bar is the ONLY place a section is named — it prints exactly the label the user clicked
   * in the sidebar. It used to append a second, author-written title ("MY TASKS · Assignments") while
   * the page below printed the same pair again as a chip over a heading; three renderings of two
   * words. Tabs now open straight into their content (see SalesPage/SalesPageHead).
   */
  const activeLabel = NAV.find((n) => n.id === section)?.label ?? '';
  const badgeCounts: Record<string, number | undefined> = {
    inbox: liveBadges.inbox || undefined,
    // Hide the unread badge while Tickets is parked as Coming soon.
    tickets: TICKETS_ENABLED ? liveBadges.tickets || undefined : undefined,
    tasks: NAV.some((item) => item.id === 'tasks' && item.comingSoon === true)
      ? undefined
      : liveBadges.tasks || undefined,
  };

  const go = useCallback((next: string) => {
    setSection(next);
    setDetail(null);
  }, []);
  // Observe the rendered section, not the click callback: this covers initial Home, direct jumps,
  // and avoids counting a click on an already-active item as another exposure.
  useEffect(() => {
    emitKpiActivity('navigation.tab_open', { entityType: 'tab', entityId: section });
  }, [section]);
  const openDash = useCallback((sub?: 'sales' | 'company' | 'debtors' | 'powerbi') => {
    setFocusDashSub(sub ?? 'sales');
    setSection('dash');
    setDetail(null);
  }, []);
  const clearFocusDashSub = useCallback(() => setFocusDashSub(null), []);
  const openClient = useCallback((c: ClientRecord) => {
    emitKpiActivity('ui.record_open', { entityType: 'client', entityId: c.id });
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


  const GROUP_LABEL: Record<string, string> = {
    daily: 'Daily',
    sell: 'Sell',
    measure: 'Measure',
    // Renamed from 'soon': the group holds two LIVE tabs (My Tasks, Call Hub), so the old name was
    // a lie the moment either was unparked.
    soon: 'More',
  };

  /**
   * NAV_GROUPS is already grouped and maps 1:1 onto the shell's sections. badgeCounts lands on
   * `trailing` — which is exactly why that field belongs on NavItem rather than staying a
   * Sales-local rendering hack — and NAV_TONE's values are already `var(--tone-*)`.
   */
  const navSections: NavSection[] = NAV_GROUPS.map((g) => ({
    id: g.id,
    label: GROUP_LABEL[g.id] ?? g.id,
    items: g.items.map((n) => {
      const soon = isSectionParked(n.id, admin);
      const count = badgeCounts[n.id];
      return {
        key: n.id,
        label: n.label,
        icon: <Icon name={n.icon} size={19} />,
        active: section === n.id,
        soon,
        ...(count ? { trailing: count } : {}),
        ...(NAV_TONE[n.id] ? { tone: NAV_TONE[n.id]! } : {}),
        ...(soon ? {} : { onClick: () => go(n.id) }),
        ...((n.id === 'home' || n.id === 'inbox' || n.id === 'records' || n.id === 'verification')
          ? { primary: true }
          : {}),

      };
    }),
  }));

  return (
    <SalesContext.Provider value={ctx}>
      <MytrionShell
        id="sales"
        navSections={navSections}
        enableNavSearch
        /* Sales keeps its own scroller: `.ss-scroll` and the full-bleed Tickets console both
           manage their own height, and a second scroll parent would fight them. */
        contentScroll="content"
      >
        <div className={`ss-root ${theme === 'light' ? 'light' : ''}`}>
          <div className={fullBleed ? undefined : 'ss-scroll'} style={s(`flex:1;min-height:0;position:relative;${fullBleed ? 'overflow:hidden;display:flex' : ''}`)}>
            {/* Keyed on the acted-as agent: switching "View as" remounts the panels so every
                tab refetches under the new identity (the transport sends fresh x-act-as headers).
                Full-bleed tabs (Tickets) fill the whole panel; others center under a max-width. */}
            {/* A Coming-soon placeholder is chrome, not reading content, so it takes the FULL panel
                width rather than the 1180px measure — clamped, it read as a small card floating in a
                large empty page. Its vertical padding matches a normal tab so navigating in and out
                of a parked section doesn't nudge everything up by 8px. */}
            <div id="ss-panels" className="ss-panels" key={actAsKey} style={s(fullBleed ? 'flex:1;min-width:0;height:100%;padding:16px 18px' : sectionComingSoon ? 'min-width:0;padding:24px 24px 90px' : 'max-width:1180px;margin:0 auto;padding:24px 24px 90px')}>
              {sectionComingSoon ? (
                <ComingSoonPanel sectionId={section} />
              ) : (
                <Suspense fallback={<SalesTabLoader section={section} label={activeLabel || 'workspace'} />}>
                  {section === 'home' && <HomeTab />}
                  {section === 'inbox' && <InboxTab />}
                  {section === 'tasks' && <TasksTab />}
                  {/* The SHARED console in requester mode: "the tickets and escalations I raised", which
                      the server's participant arm decides. The same component serves the CS, Billing and
                      Verification queues — Sales does not have its own chat implementation. */}
                  {section === 'tickets' && (
                    <TicketConsole
                      mode="requester"
                      title="My tickets & escalations"
                      // Create → "opening it now" lands on the new ticket with its chat already open.
                      focusTicketId={focusTicket}
                      onFocusConsumed={clearFocusTicket}
                    />
                  )}
                  {section === 'retention' && <RetentionTab />}
                  {section === 'verification' && <VerificationTab />}
                  {section === 'callHub' && <CallHubTab />}
                  {section === 'records' && <RecordsTab />}
                  {section === 'create' && <CreateTab />}
                  {section === 'auto' && <AutoTab />}
                  {section === 'dash' && <DashTab />}
                  {section === 'carriers' && <CarriersTab />}
                </Suspense>
              )}
            </div>
          </div>

        {/* DETAIL MODAL */}
        {detail && (
          <div onClick={closeDetail} style={s('position:fixed;inset:0;z-index:var(--z-modal);background:var(--scrim);backdrop-filter:blur(var(--scrim-blur));-webkit-backdrop-filter:blur(var(--scrim-blur));display:flex;align-items:center;justify-content:center;padding:var(--space-6)')}>
            <div
              ref={detailDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="sales-detail-title"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              /* Three rows, and only the middle one moves. `max-height:100%` respects the overlay's
                 own --space-6 gutter (a vh cap does not, which is how a long detail body used to push
                 the panel's top edge off-screen); `flex:none` stops the panel being shrunk below that
                 cap and handing the overflow back to the page. Accent is 1px — same as DetailSheet —
                 so the radius stays honest. */
              style={s('width:100%;max-width:520px;max-height:100%;flex:none;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:1px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}
            >
              <div style={s('flex:none;display:flex;align-items:flex-start;gap:13px;padding:20px 22px;border-bottom:1px solid var(--border)')}>
                <div style={s(detail.iconStyle)}><Icon name={detail.icon} size={19} /></div>
                <div style={s('flex:1;min-width:0')}>
                  <div id="sales-detail-title" style={s('font-size:17px;font-weight:700;line-height:1.3')}>{detail.title}</div>
                  <div style={s('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
                    {detail.badges.map((b, i) => <span key={i} style={s(b.style)}>{b.text}</span>)}
                  </div>
                </div>
                <button onClick={closeDetail} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
                  <Icon name="close" size={15} strokeWidth={2.4} />
                </button>
              </div>
              {/* The one scrolling row. `min-height:0` is required — without it the row floors at
                  min-content and refuses to scroll, pushing the panel past its cap instead. */}
              <div style={s('flex:1;min-height:0;padding:20px 22px;overflow-y:auto')}>
                <p style={s('font-size:14px;line-height:1.7;color:var(--text2);white-space:pre-wrap;margin:0')}>{detail.body}</p>
                <div style={s('margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-size:13px;color:var(--muted)')}>
                  <strong style={s('color:var(--text2)')}>{detail.metaLabel}</strong> {detail.meta}
                </div>
              </div>
              <div style={s('flex:none;padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end')}>
                <button onClick={closeDetail} style={s('height:36px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:14px;cursor:pointer')}>Close</button>
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

        {/* TOAST — portaled under .ss-root. --z-toast (3000) sits above --z-modal/--z-popover by
            construction, which is what the old magic 200 was reaching for back when the force modals
            were at 150/160; at 200 it would now be buried under any open modal. */}
        {toast &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              role="status"
              style={s(
                `position:fixed;bottom:calc(24px + var(--layout-bottom-inset, 0px));left:50%;transform:translateX(-50%);z-index:var(--z-toast);display:flex;align-items:center;gap:11px;padding:13px 18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${toast.tone === 'err' ? 'color-mix(in srgb,var(--danger) 40%,var(--border))' : toast.tone === 'warn' ? 'color-mix(in srgb,var(--warn) 40%,var(--border))' : 'color-mix(in srgb,var(--ok) 35%,var(--border))'};box-shadow:var(--shadow);animation:ss-pop .2s both;max-width:min(420px,92vw)`,
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
      </MytrionShell>
    </SalesContext.Provider>
  );
}
