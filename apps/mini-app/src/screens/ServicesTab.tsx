import { Pin } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Chevron, Icon, SearchGlyph } from '../components/icons';
import { useI18n } from '../lib/i18n';
import { getCatalog, type CatalogItem } from '../lib/serviceCatalog';
import type { OpenAction } from '../lib/actionTarget';

/** The "Services" tab (v2 design) — full catalog, grouped, searchable, with per-item pin toggles. */
export function ServicesTab({
  isDriver,
  pinned,
  onTogglePin,
  onOpen,
}: {
  isDriver: boolean;
  pinned: string[];
  onTogglePin: (key: string) => void;
  onOpen: (target: OpenAction) => void;
}): ReactElement {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const groups = getCatalog(isDriver)
    .map((g) => ({
      ...g,
      items: g.items
        .filter((it) => !q || t(it.labelKey).toLowerCase().includes(q))
        .slice()
        .sort((a, b) => Number(pinned.includes(b.key)) - Number(pinned.includes(a.key))),
    }))
    .filter((g) => g.items.length > 0);

  function openItem(item: CatalogItem) {
    if (!item.action) return;
    if (item.action === 'generic') onOpen({ kind: 'generic', key: item.key, title: t(item.labelKey) });
    else onOpen({ kind: 'service', key: item.action });
  }

  return (
    <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 4, margin: '0 -16px', padding: '8px 16px 12px', background: 'var(--background)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 46, padding: '0 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 13 }}>
          <SearchGlyph />
          <input className="selectable" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('services.search')} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 15 }} />
        </div>
      </div>

      {groups.length === 0 && <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('services.empty')}</div>}

      {groups.map((g) => (
        <div key={g.groupLabelKey} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--muted-fg)', margin: '0 2px' }}>{t(g.groupLabelKey)}</div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', borderRadius: 20, padding: '0 15px' }}>
            {g.items.map((it) => {
              const soon = !it.action;
              const isPinned = pinned.includes(it.key);
              return (
                <div
                  key={it.key}
                  onClick={() => openItem(it)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    padding: '16px 0',
                    borderTop: '1px solid var(--border)',
                    cursor: soon ? 'default' : 'pointer',
                  }}
                >
                  <span style={{ width: 38, height: 38, borderRadius: 11, flex: 'none', alignSelf: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--secondary)', color: soon ? 'var(--muted-fg)' : 'var(--fg)' }}>
                    <Icon name={it.icon} size={19} strokeWidth={1.7} className="" />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: soon ? 'var(--muted-fg)' : 'var(--fg)' }}>{t(it.labelKey)}</span>
                  {soon && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-fg)', background: 'var(--secondary)', padding: '4px 8px', borderRadius: 7, flex: 'none', alignSelf: 'center' }}>{t('services.soon')}</span>}
                  {!soon && (
                    <button
                      type="button"
                      className="press"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(it.key);
                      }}
                      style={{
                        flex: 'none',
                        alignSelf: 'center',
                        height: 40,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        border: 'none',
                        borderRadius: 10,
                        padding: '0 14px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: isPinned ? 'var(--primary)' : 'var(--secondary)',
                        color: isPinned ? '#FFFFFF' : 'var(--fg)',
                      }}
                    >
                      <Pin size={14} strokeWidth={2.2} fill={isPinned ? 'currentColor' : 'none'} aria-hidden />
                      {t(isPinned ? 'pin.pinned' : 'pin.pin')}
                    </button>
                  )}
                  {!soon && <Chevron style={{ alignSelf: 'center' }} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
