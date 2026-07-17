/**
 * Billing Mytrion shell — 1:1 port of the zoho-octane/app/billing-mytrion app.js template
 * (bm-header / bm-body = bm-sidebar + bm-content / bm-bottom-nav), machine-scoped under
 * `.bm-root`. Billing defaults to DARK; `.light-mode` on the root flips the palette (theme
 * persisted under the widget's own key `mytrion-billing-theme`).
 *
 * Phase 1: Data Center / Transactions / Debtors are live; Prepay / Returns are "Soon" stubs
 * (Phase 2), and the AI copilot lands as a floating launcher in Phase 3 (no nav tab, matching
 * how CS/Sales expose it).
 */
import { useEffect, useState, type ReactNode } from 'react';

import { useUserContext } from '../../context/UserContextProvider';
import { DataCenter } from './DataCenter';
import { Debtors } from './Debtors';
import { Transactions } from './Transactions';

type SectionId = 'datacenter' | 'transactions' | 'debtors' | 'prepay' | 'returns';

interface NavDef {
  id: SectionId;
  label: string;
  shortLabel: string;
  iconPath: string;
  disabled: boolean;
}

/* Widget nav (icon paths verbatim). Prepay/Returns are Phase-2 "Soon" stubs. */
const NAV_ITEMS: NavDef[] = [
  {
    id: 'datacenter',
    label: 'Data Center',
    shortLabel: 'Data',
    iconPath:
      'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
    disabled: false,
  },
  {
    id: 'transactions',
    label: 'Transactions',
    shortLabel: 'Payments',
    iconPath:
      'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    disabled: false,
  },
  {
    id: 'debtors',
    label: 'Debtors',
    shortLabel: 'Debtors',
    iconPath:
      'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
    disabled: false,
  },
  {
    id: 'prepay',
    label: 'Prepay',
    shortLabel: 'Prepay',
    iconPath:
      'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
    disabled: true,
  },
  {
    id: 'returns',
    label: 'Returns',
    shortLabel: 'Returns',
    iconPath: 'M3 10h10a5 5 0 015 5v1M3 10l4-4M3 10l4 4',
    disabled: true,
  },
];

const THEME_KEY = 'mytrion-billing-theme';

function initialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark'; // billing defaults to dark (widget parity)
}

export function BillingShell() {
  const user = useUserContext();
  const [active, setActive] = useState<SectionId>('datacenter');
  // Widget parity: panels lazy-mount on first visit and stay mounted (state survives tab hops).
  const [mounted, setMounted] = useState<Partial<Record<SectionId, boolean>>>({ datacenter: true });
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const done = setTimeout(() => setBooting(false), 1400);
    return () => clearTimeout(done);
  }, []);

  function navigate(id: SectionId, disabled: boolean) {
    if (disabled) return;
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }

  const panel = (id: SectionId, node: ReactNode): ReactNode =>
    mounted[id] ? (
      <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>
    ) : null;

  return (
    <div className={`bm-root${theme === 'light' ? ' light-mode' : ''}`}>
      {/* ═══ HEADER ═══ */}
      <header className="bm-header">
        <div className="bm-header-title">
          My<span>trion</span>
          <span className="bm-header-badge" style={{ marginLeft: '0.5rem' }}>
            BILLING
          </span>
        </div>
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          ) : (
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          )}
        </button>
      </header>

      {/* ═══ BODY ═══ */}
      <div className="bm-body">
        <aside className="bm-sidebar">
          <nav className="bm-sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`bm-nav-item${active === item.id ? ' active' : ''}${item.disabled ? ' bm-nav-disabled' : ''}`}
                disabled={item.disabled}
                aria-current={active === item.id ? 'page' : undefined}
                title={item.disabled ? 'Coming soon' : item.label}
                onClick={() => navigate(item.id, item.disabled)}
              >
                <svg className="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.iconPath} />
                </svg>
                <span className="nav-label">{item.label}</span>
                {item.disabled ? <span className="nav-soon">Soon</span> : null}
              </button>
            ))}
          </nav>
          <div className="bm-sidebar-footer">Mytrion Billing · v1.0</div>
        </aside>

        <main className="bm-content">
          {booting ? <BootLoader /> : null}
          {panel('datacenter', <DataCenter />)}
          {panel('transactions', <Transactions />)}
          {panel('debtors', <Debtors />)}
        </main>
      </div>

      {/* ═══ MOBILE BOTTOM NAV ═══ */}
      <nav className="bm-bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`bottom-nav-btn${active === item.id ? ' active' : ''}${item.disabled ? ' bottom-nav-disabled' : ''}`}
            disabled={item.disabled}
            onClick={() => navigate(item.id, item.disabled)}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.iconPath} />
            </svg>
            <span>{item.disabled ? 'Soon' : item.shortLabel}</span>
          </button>
        ))}
      </nav>

      {/* user context is available for the Phase-3 floating copilot */}
      <span data-billing-user={user.userName} hidden />
    </div>
  );
}

/** Branded boot splash — the widget's own loader markup (uses the ported scanSweep/spin/
 *  dots/loaderBar keyframes), so it reads identically to the zoho widget. */
function BootLoader() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary)',
        gap: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '-60%',
            width: '60%',
            height: '100%',
            background: 'var(--billing-accent)',
            animation: 'scanSweep 4s linear infinite',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle,var(--accent-bg-subtle) 0%,transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', width: 80, height: 80 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--accent-bg)' }} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: 'var(--billing-accent)',
            borderRightColor: 'var(--accent-border-strong)',
            animation: 'spin 1.1s linear infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            border: '1px solid var(--accent-bg-strong)',
            borderTopColor: 'var(--accent-border-strong)',
            animation: 'spin 0.7s linear infinite reverse',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 16,
            borderRadius: '50%',
            background: 'var(--accent-bg-subtle)',
            border: '1px solid var(--accent-bg)',
          }}
        />
      </div>
      <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
        <div
          style={{
            fontSize: '0.875rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '0.3rem',
            fontFamily: "'Rajdhani',Inter,sans-serif",
          }}
        >
          Connecting to Billing
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
          Loading your billing data
          <span style={{ animation: 'dots 1.4s steps(4,end) infinite' }}>...</span>
        </div>
      </div>
      <div
        style={{
          marginTop: '1.25rem',
          width: 120,
          height: 1,
          background: 'var(--accent-bg)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'var(--billing-accent)',
            borderRadius: 999,
            animation: 'loaderBar 2s ease-in-out infinite',
          }}
        />
      </div>
    </div>
  );
}
