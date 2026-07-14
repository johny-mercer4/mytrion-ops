import { useState, type ReactElement } from 'react';
import { Icon, SearchGlyph } from '../components/icons';
import { useI18n } from '../lib/i18n';
import type { InboxItem } from '../lib/demo';

/** The "Inbox" tab (v2 design) — notification list, replaces v1's flat "Recent activity" card. */
export function InboxTab({
  items,
  onMarkAllRead,
  onRead,
}: {
  items: InboxItem[];
  onMarkAllRead: () => void;
  onRead: (id: string) => void;
}): ReactElement {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const unreadCount = items.filter((n) => n.unread).length;
  const shown = items.filter((n) => !q || (n.titleText ?? t(n.titleKey)).toLowerCase().includes(q) || (n.bodyText ?? t(n.bodyKey)).toLowerCase().includes(q));

  return (
    <div style={{ padding: '16px 16px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 4, margin: '0 -16px', padding: '8px 16px 12px', background: 'var(--background)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 46, padding: '0 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 13 }}>
          <SearchGlyph />
          <input className="selectable" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('inbox.search')} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 15 }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg)' }}>{t('inbox.title')}</span>
          {unreadCount > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--link-accent)' }}>{t('inbox.new', { n: unreadCount })}</span>}
        </div>
        {unreadCount > 0 && (
          <button type="button" className="press" onClick={onMarkAllRead} style={{ background: 'var(--secondary)', border: 'none', borderRadius: 11, padding: '8px 13px', fontSize: 13, fontWeight: 700, color: 'var(--fg)', cursor: 'pointer' }}>
            {t('inbox.markAllRead')}
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '46px 24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-fg)' }}>
            <Icon name="doc" size={28} strokeWidth={1.6} className="" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{t('inbox.emptyTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 4 }}>{t('inbox.emptyBody')}</div>
          </div>
        </div>
      )}

      {items.length > 0 && shown.length === 0 && <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('inbox.noMatch')}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map((n) => (
          <div
            key={n.id}
            className="row-press"
            onClick={() => onRead(n.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '13px 14px',
              borderRadius: 16,
              cursor: 'pointer',
              background: n.unread ? 'color-mix(in srgb, var(--primary) 10%, var(--card))' : 'var(--card)',
              border: n.unread ? '1px solid color-mix(in srgb, var(--primary) 26%, transparent)' : '1px solid var(--border)',
            }}
          >
            <span style={{ width: 42, height: 42, borderRadius: 12, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--secondary)', color: n.color ?? 'var(--link-accent)' }}>
              <Icon name={n.icon} size={18} strokeWidth={1.9} className="" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: n.unread ? 700 : 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.titleText ?? t(n.titleKey)}</span>
                  {n.unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--link-accent)', flex: 'none' }} />}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)', flex: 'none' }}>{t(n.atKey, n.atN !== undefined ? { n: n.atN } : undefined)}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3, lineHeight: 1.45 }}>{n.bodyText ?? t(n.bodyKey)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
