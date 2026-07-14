import type { ReactElement } from 'react';
import { TabBarIcon } from '../components/icons';
import { useI18n } from '../lib/i18n';

export type HomeTab = 'home' | 'services' | 'inbox';

const TABS: HomeTab[] = ['home', 'services', 'inbox'];

/**
 * Bottom tab bar (v2 design) — only shown while the signed-in Home screen is active. A single
 * underline indicator slides beneath whichever tab is active (one shared element sliding by
 * `translateX`, not per-tab styling) — the icon/label just recolor, no box or fill.
 */
export function TabBar({ active, unreadCount, onSelect }: { active: HomeTab; unreadCount: number; onSelect: (tab: HomeTab) => void }): ReactElement {
  const { t } = useI18n();
  const activeIndex = TABS.indexOf(active);
  return (
    <div style={{ position: 'relative', flex: 'none', display: 'flex', background: 'var(--card)', borderTop: '1px solid var(--border)', padding: '10px 0 calc(8px + env(safe-area-inset-bottom))' }}>
      {TABS.map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            type="button"
            className="press"
            onClick={() => onSelect(tab)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? 'var(--primary)' : 'var(--muted-fg)',
              padding: '4px 0',
            }}
          >
            <span style={{ position: 'relative', height: 26, display: 'flex', alignItems: 'center' }}>
              <TabBarIcon kind={tab} active={isActive} />
              {tab === 'inbox' && unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -10,
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: 'var(--destructive)',
                    color: '#FFFFFF',
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 0 2px var(--card)',
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500 }}>{t(`tab.${tab}`)}</span>
          </button>
        );
      })}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          bottom: 'calc(4px + env(safe-area-inset-bottom))',
          width: `${100 / TABS.length}%`,
          display: 'flex',
          justifyContent: 'center',
          transform: `translateX(${activeIndex * 100}%)`,
          transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
          pointerEvents: 'none',
        }}
      >
        <span style={{ width: 28, height: 3, borderRadius: 2, background: 'var(--primary)' }} />
      </div>
    </div>
  );
}
