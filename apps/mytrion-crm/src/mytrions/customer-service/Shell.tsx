/**
 * Customer Service shell — 1:1 port of the zoho-octane widget's app.js template
 * (cs-sidebar / cs-body / cs-content + mobile bottom nav + light/dark theme with the
 * widget's localStorage key). Improvements over the widget: the AI copilot is a floating
 * launcher (CsCopilot, like Sales Mytrion) rather than a nav tab, and the sidebar footer
 * carries a Switch-Mytrion link. Data Center / Inbox / Service Center are "Soon" stubs.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useUserContext } from '../../context/UserContextProvider';
import { Analytics } from './Analytics';
import { Applications } from './Applications';
import { CitiFuel } from './CitiFuel';
import { CsCopilot } from './CsCopilot';
import { Home } from './Home';

type SectionId =
  | 'home'
  | 'applications'
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
}

/* Widget nav (icon paths verbatim); Data Center + AI enabled in this port. */
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

const THEME_KEY = 'mytrion-cs-theme';

function initialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function CsShell() {
  const user = useUserContext();
  const [active, setActive] = useState<SectionId>('home');
  // Widget parity: panels lazy-mount on first visit and stay mounted (state survives tab hops).
  const [mounted, setMounted] = useState<Partial<Record<SectionId, boolean>>>({ home: true });
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

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
        {/* ── SIDEBAR NAV (desktop) ── */}
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
              </div>
            ))}
          </nav>

          <div className="cs-sidebar-footer">
            <Link to="/" className="cs-switch-link" title="Switch Mytrion">
              ⇄ Switch
            </Link>
            <span>Mytrion CS · v1.0</span>
            <button
              className="cs-theme-toggle"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme !== 'dark' ? (
                /* Moon — shown in light mode */
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              ) : (
                /* Sun — shown in dark mode */
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              )}
            </button>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="cs-content">
          {panel('home', <Home />)}
          {panel('applications', <Applications />)}
          {panel('citi-fuel', <CitiFuel />)}
          {panel('analytics', <Analytics />)}
        </main>
      </div>

      {/* Floating AI copilot (replaces the old AI Chat nav tab) */}
      <CsCopilot user={user} />

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="cs-bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`bottom-nav-btn${active === item.id ? ' active' : ''}${item.disabled ? ' bottom-nav-disabled' : ''}`}
            onClick={() => !item.disabled && navigate(item.id)}
            disabled={item.disabled}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.iconPath} />
            </svg>
            <span>{item.disabled ? 'Soon' : item.shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
