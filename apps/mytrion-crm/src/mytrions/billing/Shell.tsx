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
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useUserContext } from '../../context/UserContextProvider';
import { useTheme } from '../../hooks/useTheme';
import { BillingCopilot } from './BillingCopilot';
import { DataCenter } from './DataCenter';
import { Debtors } from './Debtors';
import { Prepay } from './Prepay';
import { Returns } from './Returns';
import { Transactions } from './Transactions';
import { MytrionLoader } from '../../components/MytrionLoader';

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
    disabled: false,
  },
  {
    id: 'returns',
    label: 'Returns',
    shortLabel: 'Returns',
    iconPath: 'M3 10h10a5 5 0 015 5v1M3 10l4-4M3 10l4 4',
    disabled: false,
  },
];



export function BillingShell() {
  const user = useUserContext();
  const [active, setActive] = useState<SectionId>('datacenter');
  // Widget parity: panels lazy-mount on first visit and stay mounted (state survives tab hops).
  const [mounted, setMounted] = useState<Partial<Record<SectionId, boolean>>>({ datacenter: true });
  const { theme, toggle: toggleTheme } = useTheme();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const done = setTimeout(() => setBooting(false), 1400);
    return () => clearTimeout(done);
  }, []);

  // Topbar avatar: initials + name from the session identity.
  const workerName = user.userName || 'Agent';
  const workerInitials =
    workerName
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'BM';

  function navigate(id: SectionId, disabled: boolean) {
    if (disabled) return;
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }

  // Stable element instances — panels are kept mounted (keep-alive) and take no props, so
  // memoizing the elements lets React skip re-rendering them when the shell re-renders on a tab
  // switch. Without this, every tab change re-ran the ~1.6k-row Transactions render (~200ms stall).
  const els = useMemo(
    () => ({
      datacenter: <DataCenter />,
      transactions: <Transactions />,
      debtors: <Debtors />,
      prepay: <Prepay />,
      returns: <Returns />,
    }),
    [],
  );

  const panel = (id: SectionId, node: ReactNode): ReactNode =>
    mounted[id] ? (
      <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>
    ) : null;

  return (
    <div className={`bm-root${theme === 'light' ? ' light-mode' : ''}`}>
      {booting ? <MytrionLoader appName="Billing" /> : null}

      {/* ═══ HEADER (design: logo · BILLING · spacer · theme · avatar) ═══ */}
      <header className="bm-header">
        <div className="bm-header-title">My<span>trion</span></div>
        <span className="bm-header-badge">BILLING</span>
        <div style={{ flex: 1 }} />
        <button
          className="bm-header-theme"
          onClick={toggleTheme}
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
        <div className="bm-header-avatar" title={workerName}>
          {workerInitials}
        </div>
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

          {/* Sidebar footer (design): version string only. */}
          <div className="bm-sidebar-footer">Mytrion Billing · v2.0</div>
        </aside>

        <main className="bm-content">
          {panel('datacenter', els.datacenter)}
          {panel('transactions', els.transactions)}
          {panel('debtors', els.debtors)}
          {panel('prepay', els.prepay)}
          {panel('returns', els.returns)}
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

      {/* Floating AI copilot (replaces the widget's disabled AI Chat nav tab) */}
      <BillingCopilot user={user} />
    </div>
  );
}

