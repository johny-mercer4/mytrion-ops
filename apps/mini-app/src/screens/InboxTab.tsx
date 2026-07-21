import { useEffect, useState, type ReactElement } from 'react';
import { Icon } from '../components/icons';
import { SlideIn } from '../components/SlideIn';
import { useI18n } from '../lib/i18n';
import { useSlideDirection } from '../lib/useSlideDirection';
import type { InboxCategory, InboxItem } from '../lib/demo';

const TABS: InboxCategory[] = ['news', 'notifications'];

/** The "Inbox" tab (v2 design) — split into News / Notifications sub-tabs; no search/filter. */
/** Client-side re-sanitize of a news body before innerHTML. The backend already whitelists
 *  (modules/notifications/richText.ts) — this is defense in depth, same tag set. */
const RICH_ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'BR', 'UL', 'OL', 'LI', 'H3', 'A', 'IMG']);

function sanitizeNewsHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      walk(child);
      if (!RICH_ALLOWED.has(child.tagName)) {
        // unwrap: keep the text/children, drop the tag itself
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const keep =
          (child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value)) ||
          (child.tagName === 'IMG' && attr.name === 'src' && /^https:/i.test(attr.value)) ||
          (child.tagName === 'IMG' && attr.name === 'alt');
        if (!keep) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Rich (server-sanitized) news body — plain items keep the plain-text path. */
function RichBody({ html, style }: { html: string; style: React.CSSProperties }) {
  // eslint-disable-next-line react/no-danger
  return <div className="rich-news" style={style} dangerouslySetInnerHTML={{ __html: sanitizeNewsHtml(html) }} />;
}

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
  const [subTab, setSubTab] = useState<InboxCategory>('notifications');
  const [sortDesc, setSortDesc] = useState(true);
  const [viewItem, setViewItem] = useState<InboxItem | null>(null);
  const slideDir = useSlideDirection(subTab, TABS);

  const unreadCount = items.filter((n) => n.unread).length;
  const shown = items
    .filter((n) => n.category === subTab)
    .sort((a, b) => (sortDesc ? a.minutesAgo - b.minutesAgo : b.minutesAgo - a.minutesAgo));

  function openFull(n: InboxItem) {
    setViewItem(n);
    if (n.unread) onRead(n.id);
  }

  useEffect(() => {
    if (!viewItem) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [viewItem]);

  return (
    <div style={{ padding: '16px 16px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg)' }}>{t('inbox.title')}</span>
          {unreadCount > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--link-accent)', whiteSpace: 'nowrap', flexShrink: 0 }}>{t('inbox.new', { n: unreadCount })}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <button
            type="button"
            className="press"
            onClick={() => setSortDesc((v) => !v)}
            aria-label={t('inbox.sortByDate')}
            title={t('inbox.sortByDate')}
            style={{ width: 40, height: 40, border: 'none', borderRadius: 11, background: 'var(--secondary)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Icon name="sort" size={18} strokeWidth={2} className="" />
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              className="press"
              onClick={onMarkAllRead}
              aria-label={t('inbox.markAllRead')}
              title={t('inbox.markAllRead')}
              style={{ width: 40, height: 40, border: 'none', borderRadius: 11, background: 'var(--secondary)', color: 'var(--link-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <Icon name="checkcheck" size={18} strokeWidth={2} className="" />
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--secondary)', borderRadius: 12 }}>
        {TABS.map((tab) => {
          const active = subTab === tab;
          return (
            <button
              key={tab}
              type="button"
              className="press"
              onClick={() => setSubTab(tab)}
              style={{ flex: 1, height: 40, border: 'none', borderRadius: 9, fontFamily: "'Geist'", fontWeight: 700, fontSize: 14, cursor: 'pointer', background: active ? 'var(--card)' : 'transparent', color: active ? 'var(--fg)' : 'var(--muted-fg)', boxShadow: active ? 'var(--card-shadow)' : 'none' }}
            >
              {t(`inbox.tab.${tab}`)}
            </button>
          );
        })}
      </div>

      <SlideIn key={subTab} dir={slideDir}>
      {shown.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '46px 24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-fg)' }}>
            <Icon name="doc" size={28} strokeWidth={1.6} className="" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{t(subTab === 'news' ? 'inbox.newsEmptyTitle' : 'inbox.emptyTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 4 }}>{t(subTab === 'news' ? 'inbox.newsEmptyBody' : 'inbox.emptyBody')}</div>
          </div>
        </div>
      )}

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
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t(n.atKey, n.atN !== undefined ? { n: n.atN } : undefined)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFull(n);
                    }}
                    aria-label={t('inbox.viewFull')}
                    title={t('inbox.viewFull')}
                    style={{ width: 32, height: 32, margin: '-5px -5px -5px 0', border: 'none', background: 'transparent', color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}
                  >
                    <Icon name="maximize" size={14} strokeWidth={2} className="" />
                  </button>
                </span>
              </div>
              {n.category === 'news' && n.bodyText ? (
                <RichBody html={n.bodyText} style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3, lineHeight: 1.45 }} />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3, lineHeight: 1.45 }}>{n.bodyText ?? t(n.bodyKey, n.bodyParams)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      </SlideIn>

      {viewItem && (
        <>
          <div onClick={() => setViewItem(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.42)', animation: 'octfade .2s ease' }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 51, background: 'var(--card)', borderRadius: '24px 24px 0 0', padding: '10px 20px calc(28px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 40px rgba(0,0,0,.28)', animation: 'octsheet .28s cubic-bezier(.32,.72,0,1)' }}
          >
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 18px' }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
              <span style={{ width: 44, height: 44, borderRadius: 13, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--secondary)', color: viewItem.color ?? 'var(--link-accent)' }}>
                <Icon name={viewItem.icon} size={20} strokeWidth={1.9} className="" />
              </span>
              <button type="button" onClick={() => setViewItem(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--secondary)', color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
                <Icon name="x" size={14} strokeWidth={1.8} className="" />
              </button>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)', marginTop: 10 }}>{viewItem.titleText ?? t(viewItem.titleKey)}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)', marginTop: 4 }}>{t(viewItem.atKey, viewItem.atN !== undefined ? { n: viewItem.atN } : undefined)}</div>
            {viewItem.category === 'news' && viewItem.bodyText ? (
              <RichBody html={viewItem.bodyText} style={{ fontSize: 14.5, color: 'var(--fg)', marginTop: 14, lineHeight: 1.55 }} />
            ) : (
              <div style={{ fontSize: 14.5, color: 'var(--fg)', marginTop: 14, lineHeight: 1.55 }}>{viewItem.bodyText ?? t(viewItem.bodyKey, viewItem.bodyParams)}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
