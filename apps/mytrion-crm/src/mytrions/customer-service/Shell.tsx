/**
 * Customer Service shell — sidebar + content + mobile bottom nav.
 * Retention Cases / Open Pool Claims / CITI Folder sit alongside Citifuel Clients.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { csRetention } from '../../api/csRetention';
import { useUserContext } from '../../context/UserContextProvider';
import { useTheme } from '../../hooks/useTheme';
import { Analytics } from './Analytics';
import { Applications } from './Applications';
import { CitiFuel } from './CitiFuel';
import { CsCopilot } from './CsCopilot';
import { Home } from './Home';
import { CasesPanel } from './retention/CasesPanel';
import { ClaimsPanel } from './retention/ClaimsPanel';
import { CitiFolderPanel } from './retention/CitiFolderPanel';
import { subscribeCsRetentionLive } from './retention/retentionLiveBus';
import { useCsRetentionRealtime } from './retention/useCsRetentionRealtime';
import { Toast, type ToastState } from './Toast';

type SectionId =
  | 'home'
  | 'applications'
  | 'retention-cases'
  | 'open-pool-claims'
  | 'citi-folder'
  | 'citi-fuel'
  | 'analytics'
  | 'data-center'
  | 'inbox'
  | 'service-center';

interface NavDef {
  id: SectionId;
  label: string;
  shortLabel: string;
  iconPath: string;
  disabled: boolean;
  badge?: boolean;
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
    id: 'open-pool-claims',
    label: 'Open Pool Claims',
    shortLabel: 'Claims',
    iconPath:
      'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    disabled: false,
    badge: true,
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
    id: 'service-center',
    label: 'Service Center',
    shortLabel: 'Service',
    iconPath:
      'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
    disabled: true,
  },
];

export function CsShell() {
  const user = useUserContext();
  const [active, setActive] = useState<SectionId>('home');
  const [mounted, setMounted] = useState<Partial<Record<SectionId, boolean>>>({ home: true });
  const { theme, toggle: toggleTheme } = useTheme();
  const [claimsBadge, setClaimsBadge] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  const onClaimsToast = useCallback((title: string, detail: string) => {
    setToast({ id: Date.now(), kind: 'info', message: `${title}: ${detail}` });
  }, []);

  useCsRetentionRealtime(true, onClaimsToast);

  const refreshClaimsBadge = useCallback(() => {
    void csRetention
      .claimsBadge()
      .then((r) => setClaimsBadge(r.count))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshClaimsBadge();
    return subscribeCsRetentionLive((p) => {
      if (
        p.type === 'retention.claim_request' ||
        p.type === 'retention.claim_approved' ||
        p.type === 'retention.claim_declined'
      ) {
        refreshClaimsBadge();
      }
    });
  }, [refreshClaimsBadge]);

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

  function navigate(id: SectionId) {
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }

  const panel = (id: SectionId, node: ReactNode): ReactNode =>
    mounted[id] ? (
      <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>
    ) : null;

  return (
    <div className={`cs-root${theme === 'dark' ? ' dark-mode' : ''}`}>
      <div className="cs-body">
        <aside className="cs-sidebar">
          <div className="cs-sidebar-brand">
            <div className="cs-brand-word">
              My<span>trion</span>
            </div>
            <div className="cs-brand-sub">Customer Service</div>
          </div>
          <nav className="cs-sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`cs-nav-item${active === item.id ? ' active' : ''}${item.disabled ? ' cs-nav-disabled' : ''}`}
                role="button"
                tabIndex={item.disabled ? -1 : 0}
                aria-label={item.label}
                aria-current={active === item.id ? 'page' : undefined}
                title={item.disabled ? 'Coming soon' : item.label}
                onClick={() => !item.disabled && navigate(item.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !item.disabled) {
                    e.preventDefault();
                    navigate(item.id);
                  }
                }}
              >
                <span className="nav-label">{item.label}</span>
                {item.disabled ? <span className="nav-soon">Soon</span> : null}
                {item.badge && claimsBadge > 0 ? (
                  <span className="cs-nav-badge">{claimsBadge > 99 ? '99+' : claimsBadge}</span>
                ) : null}
              </div>
            ))}
          </nav>

          <div className="cs-sidebar-footer">
            <button
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
            <div className="cs-user-card">
              <span className="cs-user-avatar">{workerInitials}</span>
              <div className="cs-user-meta">
                <div className="cs-user-name">{workerName}</div>
                <div className="cs-user-role">{workerRole}</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="cs-content">
          {panel('home', <Home />)}
          {panel('applications', <Applications />)}
          {panel('retention-cases', <CasesPanel />)}
          {panel('open-pool-claims', <ClaimsPanel onBadge={setClaimsBadge} />)}
          {panel('citi-folder', <CitiFolderPanel />)}
          {panel('citi-fuel', <CitiFuel />)}
          {panel('analytics', <Analytics />)}
        </main>
      </div>

      <CsCopilot user={user} />
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}

      <nav className="cs-bottom-nav">
        {NAV_ITEMS.filter((i) => !i.disabled).map((item) => (
          <button
            key={item.id}
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
