/**
 * Client News — the Octane→client announcement composer + feed (Admin Mytrion).
 *
 * Posts land in the mini-app's Inbox "news" tab (audience/role filtered server-side);
 * `important` + specific carriers additionally push a Telegram bot message. The editor is a
 * deliberately dependency-free contentEditable with a whitelist toolbar — the backend
 * re-sanitizes every save (modules/notifications/richText.ts), so this editor is UX, not
 * security. Four language tabs write the per-locale jsonb the mini-app picks from; EN is
 * the required fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClientNews, listClientNews, type ClientNewsPost, type NewsLocalized } from '../../api/clientNews';
import { ClientCombobox } from './ClientCombobox';
import { adminToast } from './toast';
import admin from './admin.module.css';
import styles from './ClientNews.module.css';

type Lang = 'en' | 'ru' | 'uz' | 'es';
const LANGS: Lang[] = ['en', 'ru', 'uz', 'es'];
type PerLang = Record<Lang, string>;
const emptyPerLang = (): PerLang => ({ en: '', ru: '', uz: '', es: '' });

/** contentEditable + execCommand toolbar. Controlled per language from OUTSIDE via key remount. */
function RichEditor({ initialHtml, onChange }: { initialHtml: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    onChange(ref.current?.innerHTML ?? '');
  };
  const addLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url && /^https?:\/\//i.test(url)) exec('createLink', url);
  };
  const addImage = () => {
    const url = window.prompt('Image URL (https://… — hosted image, e.g. a CDN link)');
    if (url && /^https:\/\//i.test(url)) exec('insertImage', url);
  };
  return (
    <div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolBtn} title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" className={styles.toolBtn} title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" className={styles.toolBtn} title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}><u>U</u></button>
        <span className={styles.toolSep} />
        <button type="button" className={styles.toolBtn} title="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h3>')}>H</button>
        <button type="button" className={styles.toolBtn} title="Paragraph" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<p>')}>¶</button>
        <span className={styles.toolSep} />
        <button type="button" className={styles.toolBtn} title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>•≡</button>
        <button type="button" className={styles.toolBtn} title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>1≡</button>
        <span className={styles.toolSep} />
        <button type="button" className={styles.toolBtn} title="Link" onMouseDown={(e) => e.preventDefault()} onClick={addLink}>🔗</button>
        <button type="button" className={styles.toolBtn} title="Image (https URL)" onMouseDown={(e) => e.preventDefault()} onClick={addImage}>🖼</button>
        <button type="button" className={styles.toolBtn} title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}>⌫</button>
      </div>
      <div
        ref={ref}
        className={styles.editor}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Write the announcement…"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onBlur={() => onChange(ref.current?.innerHTML ?? '')}
      />
    </div>
  );
}

const emptyToNull = (v: string): string | undefined => {
  const t = v.replace(/<br\s*\/?>(\s|&nbsp;)*/gi, '').replace(/<[^>]*>/g, '').trim();
  return t ? v : undefined;
};

export function ClientNews() {
  const [posts, setPosts] = useState<ClientNewsPost[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [titles, setTitles] = useState<PerLang>(emptyPerLang);
  const [bodies, setBodies] = useState<PerLang>(emptyPerLang);
  const [scope, setScope] = useState<'all' | 'carriers'>('all');
  const [carriers, setCarriers] = useState<Array<{ id: string; name: string }>>([]);
  const [roles, setRoles] = useState<Array<'owner' | 'driver'>>(['owner', 'driver']);
  const [severity, setSeverity] = useState<'info' | 'important'>('info');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listClientNews()
      .then(setPosts)
      .catch((e) => adminToast.error('Could not load news', e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const toggleRole = (r: 'owner' | 'driver') =>
    setRoles((cur) => (cur.includes(r) ? (cur.length > 1 ? cur.filter((x) => x !== r) : cur) : [...cur, r]));

  const reset = () => {
    setTitles(emptyPerLang());
    setBodies(emptyPerLang());
    setScope('all');
    setCarriers([]);
    setRoles(['owner', 'driver']);
    setSeverity('info');
    setPinned(false);
    setLang('en');
  };

  async function publish() {
    if (!titles.en.trim() || !emptyToNull(bodies.en)) {
      adminToast.error('English is required', 'EN is the fallback every client can read.');
      return;
    }
    if (scope === 'carriers' && carriers.length === 0) {
      adminToast.error('Pick at least one carrier', 'Or switch the audience to “All clients”.');
      return;
    }
    setBusy(true);
    try {
      const loc = (v: PerLang): NewsLocalized => ({
        en: v.en,
        ...(emptyToNull(v.ru) ? { ru: v.ru } : {}),
        ...(emptyToNull(v.uz) ? { uz: v.uz } : {}),
        ...(emptyToNull(v.es) ? { es: v.es } : {}),
      });
      await createClientNews({
        title: loc(titles),
        body: loc(bodies),
        audience_scope: scope,
        carrier_ids: scope === 'carriers' ? carriers.map((c) => c.id) : [],
        roles,
        severity,
        pinned,
      });
      adminToast.success('News published', severity === 'important' && scope === 'carriers' ? 'Clients also get a Telegram message.' : 'Visible in the mini-app inbox.');
      reset();
      setComposerOpen(false);
      load();
    } catch (e) {
      adminToast.error('Publish failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const filled = (l: Lang) => Boolean(titles[l].trim() || emptyToNull(bodies[l]));

  return (
    <div className={admin.panelWide}>
      <div className={admin.cardHead}>
        <div className={admin.cardTitle}>
          Client News {posts && <span className="count">{posts.length}</span>}
        </div>
        <button type="button" className={admin.primaryBtn} onClick={() => setComposerOpen((v) => !v)}>
          {composerOpen ? 'Close composer' : 'New post'}
        </button>
      </div>

      <div className={styles.layout}>
        {composerOpen && (
          <div className={styles.postCard}>
            <div className={styles.formGrid}>
              <div>
                <div className={styles.groupLabel}>Language</div>
                <div className={styles.langTabs}>
                  {LANGS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={[styles.langTab, lang === l ? styles.langTabOn : '', filled(l) ? styles.langTabFilled : ''].join(' ')}
                      onClick={() => setLang(l)}
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                <input
                  className={admin.input}
                  style={{ width: '100%', marginBottom: 8 }}
                  placeholder={`Title (${lang.toUpperCase()}${lang === 'en' ? ', required' : ''})`}
                  value={titles[lang]}
                  onChange={(e) => setTitles((cur) => ({ ...cur, [lang]: e.target.value }))}
                />
                {/* key remounts the editor per language so contentEditable swaps content cleanly */}
                <RichEditor key={lang} initialHtml={bodies[lang]} onChange={(html) => setBodies((cur) => ({ ...cur, [lang]: html }))} />
              </div>

              <div>
                <div className={styles.groupLabel}>Audience</div>
                <div className={styles.segRow}>
                  <button type="button" className={[styles.seg, scope === 'all' ? styles.segOn : ''].join(' ')} onClick={() => setScope('all')}>All clients</button>
                  <button type="button" className={[styles.seg, scope === 'carriers' ? styles.segOn : ''].join(' ')} onClick={() => setScope('carriers')}>Specific carriers</button>
                </div>
                {scope === 'carriers' && (
                  <div style={{ marginTop: 10 }}>
                    <ClientCombobox
                      onPick={(c) => setCarriers((cur) => (cur.some((x) => x.id === String(c.carrierId)) ? cur : [...cur, { id: String(c.carrierId), name: c.companyName ?? String(c.carrierId) }]))}
                      onManual={() => adminToast.error('Pick from the list', 'News targets known carriers only.')}
                    />
                    <div className={styles.chipRow}>
                      {carriers.map((c) => (
                        <span key={c.id} className={styles.chip}>
                          {c.name}
                          <button type="button" className={styles.chipX} onClick={() => setCarriers((cur) => cur.filter((x) => x.id !== c.id))}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className={styles.groupLabel}>Who sees it</div>
                <div className={styles.segRow}>
                  <button type="button" className={[styles.seg, roles.includes('owner') ? styles.segOn : ''].join(' ')} onClick={() => toggleRole('owner')}>Owners</button>
                  <button type="button" className={[styles.seg, roles.includes('driver') ? styles.segOn : ''].join(' ')} onClick={() => toggleRole('driver')}>Drivers</button>
                </div>
              </div>

              <div>
                <div className={styles.groupLabel}>Delivery</div>
                <div className={styles.segRow}>
                  <button type="button" className={[styles.seg, severity === 'info' ? styles.segOn : ''].join(' ')} onClick={() => setSeverity('info')}>Inbox only</button>
                  <button type="button" className={[styles.seg, styles.segDanger, severity === 'important' ? styles.segOn : ''].join(' ')} title="Also sends a Telegram bot message (specific carriers only)" onClick={() => setSeverity('important')}>Important — bot push</button>
                  <button type="button" className={[styles.seg, pinned ? styles.segOn : ''].join(' ')} onClick={() => setPinned((v) => !v)}>📌 Pinned</button>
                </div>
              </div>

              <div>
                <button type="button" className={admin.primaryBtn} disabled={busy} onClick={() => void publish()}>
                  {busy ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div>
          {posts === null && <div className={styles.postMeta}>Loading…</div>}
          {posts?.length === 0 && <div className={styles.postMeta}>No news yet — the composer on the left publishes straight into every client's mini-app inbox.</div>}
          {posts?.map((p) => (
            <div key={p.id} className={styles.postCard}>
              <div className={styles.postHead}>
                <span className={styles.postTitle}>{p.pinned ? '📌 ' : ''}{p.title.en}</span>
                <span className={[admin.pill, p.severity === 'important' ? admin.pillBad : admin.pillInfo].join(' ')}>{p.severity}</span>
                <span className={[admin.pill, admin.pillNeutral].join(' ')}>{p.audienceScope === 'all' ? 'All clients' : `${p.carrierIds.length} carrier(s)`}</span>
                <span className={[admin.pill, admin.pillNeutral].join(' ')}>{p.roles.join(' + ')}</span>
              </div>
              {/* Server-sanitized subset (b/i/u/p/br/ul/ol/li/h3/a) — safe to render. */}
              {/* eslint-disable-next-line react/no-danger */}
              <div className={styles.postBody} dangerouslySetInnerHTML={{ __html: p.body.en }} />
              <div className={styles.postMeta}>
                {new Date(p.publishAt).toLocaleString()} · by {p.createdBy}
                {LANGS.filter((l) => l !== 'en' && p.title[l]).length > 0 && ` · +${LANGS.filter((l) => l !== 'en' && p.title[l]).map((l) => l.toUpperCase()).join('/')}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
