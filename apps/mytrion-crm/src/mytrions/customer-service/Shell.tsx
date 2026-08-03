/**
 * Customer Service shell — gold CSMYTRION chrome, sidebar + content + mobile bottom nav.
 * Retention Cases / Open Pool Activity / CITI Folder sit alongside Citifuel Clients.
 */
import { useCallback, useState, type ReactNode } from 'react';

import { isAdmin } from '../../access/resolveAccess';
import { ActAsPicker } from '../../components/ActAsPicker';
import { MytrionSwitchLink } from '../../components/MytrionSwitchLink';
import { useImpersonation } from '../../context/ImpersonationProvider';
import { useUserContext } from '../../context/UserContextProvider';
import { useTheme } from '../../hooks/useTheme';
import { Analytics } from './Analytics';
import { Applications } from './Applications';
import { CitiFuel } from './CitiFuel';
import { TicketConsole } from '@/features/comms/TicketConsole';
import type { CsSectionId } from './csNav';
import { Home } from './Home';
import { Maintenance } from './Maintenance';
import { CasesPanel } from './retention/CasesPanel';
import { OpenPoolReadonlyPanel } from './retention/OpenPoolReadonlyPanel';
import { CitiFolderPanel } from './retention/CitiFolderPanel';
import { useCsRetentionRealtime } from './retention/useCsRetentionRealtime';
import { Toast, type ToastState } from './Toast';

interface NavDef {
  id: CsSectionId;
  label: string;
  shortLabel: string;
  iconPath: string;
  disabled: boolean;
}

const NAV_ITEMS: NavDef[] = [
  {
    id: 'home',
    label: 'Home',
    shortLabel: 'Home',
    iconPath:
      'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    disabled: false,
  },
  {
    id: 'applications',
    label: 'Applications',
    shortLabel: 'Apps',
    iconPath:
      'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    disabled: false,
  },
  {
    id: 'retention-cases',
    label: 'Retention Cases',
    shortLabel: 'Retain',
    iconPath:
      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    disabled: false,
  },
  {
    id: 'open-pool',
    label: 'Open Pool',
    shortLabel: 'Pool',
    iconPath:
      'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    disabled: false,
  },
  {
    id: 'citi-folder',
    label: 'CITI Folder',
    shortLabel: 'CITI',
    iconPath:
      'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
    disabled: false,
  },
  {
    id: 'citi-fuel',
    label: 'Citifuel Clients',
    shortLabel: 'Citifuel',
    iconPath:
      'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
    disabled: false,
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    shortLabel: 'Maint',
    // Wrench — the maintenance case queue (Postgres-backed, migrated off the Zoho module).
    iconPath:
      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    disabled: false,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    shortLabel: 'Stats',
    iconPath:
      'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    disabled: false,
  },
  {
    id: 'data-center',
    label: 'Data Center',
    shortLabel: 'DC',
    iconPath:
      'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
    disabled: true,
  },
  {
    id: 'inbox',
    label: 'Inbox',
    shortLabel: 'Inbox',
    iconPath:
      'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
    disabled: true,
  },
  {
    id: 'tickets',
    label: 'Tickets',
    shortLabel: 'Tickets',
    // chat bubbles
    iconPath:
      'M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    // PARKED (2026-08-03). Sales files tickets into Zoho Desk again, so this queue would read empty
    // while the real work sits in Desk. The console itself is untouched — drop this flag to un-park.
    disabled: true,
  },
  {
    id: 'service-center',
    label: 'Service Center',
    shortLabel: 'Service',
    iconPath:
      'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
    disabled: true,
  },
];

/** Single source for the parked Tickets queue — read from NAV_ITEMS so the flag cannot drift. */
const TICKETS_PARKED = NAV_ITEMS.some((i) => i.id === 'tickets' && i.disabled);

export function CsShell() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const { actingAs } = useImpersonation();
  const actAsKey = actingAs?.zohoUserId ?? 'self';
  const [active, setActive] = useState<CsSectionId>('home');
  const [mounted, setMounted] = useState<Partial<Record<CsSectionId, boolean>>>({ home: true });
  const { theme, toggle: toggleTheme } = useTheme();
  const [toast, setToast] = useState<ToastState | null>(null);
  // Icons-only rail — persisted like Sales (`ss.nav.collapsed`).
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('cs.nav.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleNav = useCallback(() => {
    setNavCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('cs.nav.collapsed', next ? '1' : '0');
      } catch {
        /* storage disabled — in-memory toggle still works */
      }
      return next;
    });
  }, []);

  const onPoolToast = useCallback((title: string, detail: string) => {
    setToast({ id: Date.now(), kind: 'info', message: `${title}: ${detail}` });
  }, []);

  useCsRetentionRealtime(true, onPoolToast);

  const workerName = user.userName || 'Agent';
  const workerRole = user.role || user.profile || 'Customer Service';
  const workerInitials =
    workerName
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'CS';

  const navigate = useCallback((id: CsSectionId) => {
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }, []);

  const panel = (id: CsSectionId, node: ReactNode): ReactNode =>
    mounted[id] ? (
      <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>
    ) : null;

  return (
    <div
      className={`cs-root${theme === 'dark' ? ' dark-mode' : ''}${navCollapsed ? ' cs-nav-collapsed' : ''}`}
    >
      {/* Ambient Horizon backdrop — mesh + 64px grid + vignette behind the whole module. */}
      <div className="cs-ambience" aria-hidden="true" />
      <div className="cs-body">
        <aside className="cs-sidebar" aria-expanded={!navCollapsed}>
          <div className="cs-sidebar-brand">
            {!navCollapsed ? (
              <>
                <div className="cs-brand-text">
                  <div className="cs-brand-word">
                    MY<span>TRION</span>
                  </div>
                  <div className="cs-brand-sub">Customer Service</div>
                </div>
                <button
                  type="button"
                  className="cs-nav-collapse-btn"
                  onClick={toggleNav}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                  </svg>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="cs-nav-collapse-btn"
                onClick={toggleNav}
                aria-label="Expand sidebar"
                title="Expand sidebar"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            )}
          </div>
          <nav className="cs-sidebar-nav">
            {/* Real <button>s, not role="button" divs. Chrome applies :focus-visible to a
                tabIndex'd div on MOUSE click, which left a hard accent ring stuck on the tab you
                just clicked; native buttons only show it for keyboard focus. It also removes the
                hand-rolled Enter/Space handler — the browser does that for free. */}
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`cs-nav-item${active === item.id ? ' active' : ''}${item.disabled ? ' cs-nav-disabled' : ''}${
                  item.id === 'citi-folder' ? ' is-citi-folder' : ''
                }`}
                disabled={item.disabled}
                aria-label={item.label}
                aria-current={active === item.id ? 'page' : undefined}
                title={item.disabled ? 'Coming soon' : item.label}
                onClick={() => navigate(item.id)}
              >
                <span className="cs-nav-icon-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={item.iconPath} />
                  </svg>
                  {navCollapsed && item.disabled ? (
                    <span className="cs-nav-soon-dot" aria-hidden="true" />
                  ) : null}
                </span>
                <span className="nav-label">{item.label}</span>
                {!navCollapsed && item.disabled ? <span className="nav-soon">Soon</span> : null}
              </button>
            ))}
          </nav>

          <div className="cs-sidebar-footer">
            {/* Route back to the picker — CS has bespoke chrome and never renders TopBar, so without
                this it is a dead end for anyone holding more than one Mytrion. */}
            <MytrionSwitchLink
              className="cs-theme-toggle"
              label={navCollapsed ? '' : 'Switch Mytrion'}
            />
            <button
              type="button"
              className="cs-theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme !== 'dark' ? (
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              ) : (
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              )}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            {admin && !navCollapsed ? (
              <div className="cs-view-as">
                <ActAsPicker placement="sidebar" />
              </div>
            ) : null}
            <div className="cs-user-card" title={navCollapsed ? workerName : undefined}>
              <span className="cs-user-avatar">{workerInitials}</span>
              <div className="cs-user-meta">
                <div className="cs-user-name">{workerName}</div>
                <div className="cs-user-role">{workerRole}</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="cs-content" key={actAsKey}>
          {panel('home', <Home onNavigate={navigate} />)}
          {panel('applications', <Applications />)}
          {panel('retention-cases', <CasesPanel />)}
          {panel('open-pool', <OpenPoolReadonlyPanel />)}
          {panel('citi-folder', <CitiFolderPanel />)}
          {panel('citi-fuel', <CitiFuel />)}
          {panel('maintenance', <Maintenance />)}
          {panel('analytics', <Analytics />)}
          {/* The SHARED console, PARKED — see the NAV_ITEMS entry. Left mounted-by-id so un-parking is
              one flag, but gated on the same flag so a deep link cannot open an empty queue. */}
          {TICKETS_PARKED
            ? null
            : panel(
                'tickets',
                <TicketConsole mode="queue" department="customer-service" title="Customer Service tickets" />,
              )}
        </main>
      </div>

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}

      <nav className="cs-bottom-nav">
        {NAV_ITEMS.filter((i) => !i.disabled).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav-btn${active === item.id ? ' active' : ''}`}
            onClick={() => navigate(item.id)}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.iconPath} />
            </svg>
            <span>{item.shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
