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
import { DocIcon } from '../../components/icons';
import { ClientCombobox } from './ClientCombobox';
import { adminToast } from './toast';
import admin from './admin.module.css';
import styles from './ClientNews.module.css';

type Lang = 'en' | 'ru' | 'uz' | 'es';
const LANGS: Lang[] = ['en', 'ru', 'uz', 'es'];
type PerLang = Record<Lang, string>;
const emptyPerLang = (): PerLang => ({ en: '', ru: '', uz: '', es: '' });

/* The server caps every locale of title AND body at 4000 chars (clientNews.routes localizedSchema),
   and the body value is HTML — the markup counts. A zod 400 reaches the toast as the unactionable
   'Request validation failed' (the transport drops zod's `details`), so over-length has to be caught
   here, naming both the language and the field. */
const MAX_LEN = 4000;
/** Counter stays hidden until a post is close enough to the cap for the number to mean something. */
const COUNT_FROM = 3500;

/** contentEditable + execCommand toolbar. Controlled per language from OUTSIDE via key remount. */
function RichEditor({ initialHtml, onChange }: { initialHtml: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  /* The editable node is genuinely uncontrolled: `onInput` pushes innerHTML up into `bodies`, which
     comes straight back down as `initialHtml`. Handing React a live string would make react-dom
     re-run setInnerHTML after every keystroke (its diff is `lastHtml !== nextHtml`), destroying the
     text node the caret sits in — typing came out reversed. Seeding from a ref keeps `__html` byte
     identical across re-renders so that diff never fires; `key={lang}` remounts to re-seed. */
  const seed = useRef(initialHtml);
  const exec = (cmd: string, value?: string, range?: Range | null) => {
    ref.current?.focus();
    /* window.prompt can drop the document selection, so the link/image commands restore the Range
       they captured before asking — otherwise createLink applies to nothing and looks broken. */
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    document.execCommand(cmd, false, value);
    onChange(ref.current?.innerHTML ?? '');
  };
  const captureRange = (): Range | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return ref.current?.contains(range.commonAncestorContainer) ? range : null;
  };
  /** Operators type bare hosts, so a scheme-less input is assumed https instead of discarded. */
  const withScheme = (url: string) => (/^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`);
  const addLink = () => {
    const range = captureRange();
    const raw = window.prompt('Link URL (https://…)')?.trim();
    if (!raw) return;
    const url = withScheme(raw);
    if (!/^https?:\/\/\S+$/i.test(url)) {
      adminToast.error('Link needs a full URL', 'Start with https:// (or http://).');
      return;
    }
    exec('createLink', url, range);
  };
  const addImage = () => {
    const range = captureRange();
    const raw = window.prompt('Image URL (https://… — hosted image, e.g. a CDN link)')?.trim();
    if (!raw) return;
    const url = withScheme(raw);
    if (!/^https:\/\/\S+$/i.test(url)) {
      adminToast.error('Image must be an https URL', 'Clients open the mini-app over https, so an http:// image never renders.');
      return;
    }
    exec('insertImage', url, range);
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
        dangerouslySetInnerHTML={{ __html: seed.current }}
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

/** Only the locales `loc()` actually posts can trip the server cap, so blank tabs stay silent. */
const tooLong = (v: PerLang, field: 'title' | 'body'): string[] =>
  LANGS.filter((l) => (l === 'en' || emptyToNull(v[l])) && v[l].length > MAX_LEN).map(
    (l) => `${l.toUpperCase()} ${field} is ${v[l].length} / ${MAX_LEN} characters`,
  );

/**
 * Feed body: clipped to `.postBody`'s max-height, but only wearing the fade mask and the expand
 * control when it really overflowed — the mask is relative to the element box, so on a two-line
 * post it would dim text that is fully visible.
 */
function PostBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    /* Skip while expanded: scrollHeight then equals clientHeight, which would read as "not
       clipped" and take the collapse control away mid-read. */
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 2);
    measure();
    /* Images in the sanitized HTML load after paint and change scrollHeight, but the clamped box
       never resizes — so hook their load events rather than a ResizeObserver. */
    const imgs = Array.from(el.querySelectorAll('img'));
    imgs.forEach((img) => img.addEventListener('load', measure));
    window.addEventListener('resize', measure);
    return () => {
      imgs.forEach((img) => img.removeEventListener('load', measure));
      window.removeEventListener('resize', measure);
    };
  }, [html, open]);
  return (
    <>
      {/* Server-sanitized subset (b/i/u/p/br/ul/ol/li/h3/a) — safe to render. */}
      <div
        ref={ref}
        className={[styles.postBody, clipped && !open ? styles.postBodyClipped : '', open ? styles.postBodyOpen : ''].join(' ')}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {clipped && (
        <button type="button" className={styles.postExpand} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </>
  );
}

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
    const over = [...tooLong(titles, 'title'), ...tooLong(bodies, 'body')];
    if (over.length > 0) {
      adminToast.error('Too long to publish', `${over.join('; ')} — the body count includes its HTML markup.`);
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
    /* `panelWide` alone only sets a max-width — it carries none of `.panel`'s padding, flex column
       or gap, which is why this tab sat flush against the content edge while every other tab had a
       margin. It needs both classes. */
    <div className={`${admin.panel} ${admin.panelWide}`}>
      <div className={admin.head}>
        <div>
          <div className={admin.eyebrow}>Mini-app inbox</div>
          <h2 className={admin.h2}>Client News</h2>
          <p className={admin.sub}>
            Publishes straight into every client&rsquo;s mini-app inbox, in the language they use.
          </p>
        </div>
        <div className={admin.emptyCta}>
          {posts ? <span className={admin.pagerMeta}>{posts.length} published</span> : null}
          <button type="button" className={admin.primaryBtn} onClick={() => setComposerOpen((v) => !v)}>
            {composerOpen ? 'Close composer' : 'New post'}
          </button>
        </div>
      </div>

      {/* Two tracks only while the composer is mounted — with the feed as the grid's only child the
          second track was a permanently blank half-panel that read as content failing to load. */}
      <div className={[styles.layout, composerOpen ? styles.layoutSplit : ''].join(' ')}>
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
                  maxLength={MAX_LEN}
                  value={titles[lang]}
                  onChange={(e) => setTitles((cur) => ({ ...cur, [lang]: e.target.value }))}
                />
                {/* key remounts the editor per language so contentEditable swaps content cleanly */}
                <RichEditor key={lang} initialHtml={bodies[lang]} onChange={(html) => setBodies((cur) => ({ ...cur, [lang]: html }))} />
                {bodies[lang].length > COUNT_FROM && (
                  <div className={[styles.counter, bodies[lang].length > MAX_LEN ? styles.counterOver : ''].join(' ')}>
                    {bodies[lang].length} / {MAX_LEN} characters, HTML markup included
                  </div>
                )}
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
          {/* Was bare `postMeta` text for both states — the only tab in Admin without a skeleton
              loader or a standard empty state. */}
          {posts === null && (
            <>
              <span className={admin.srOnly} role="status">
                Loading client news…
              </span>
              <div className={admin.skelGrid} aria-hidden="true">
                <div className={admin.skelCard} />
                <div className={admin.skelCard} />
              </div>
            </>
          )}
          {posts?.length === 0 && (
            <div className={admin.none}>
              <span className={admin.emptyIcon} aria-hidden="true">
                <DocIcon />
              </span>
              <div className={admin.emptyTitle}>No news yet</div>
              <p className={admin.emptyBody}>
                Nothing published. Use <strong>New post</strong> above — it goes straight into every
                client&rsquo;s mini-app inbox, in the language they use.
              </p>
            </div>
          )}
          {posts?.map((p) => (
            <div key={p.id} className={styles.postCard}>
              <div className={styles.postHead}>
                <span className={styles.postTitle}>{p.pinned ? '📌 ' : ''}{p.title.en}</span>
                <span className={[admin.pill, p.severity === 'important' ? admin.pillBad : admin.pillInfo].join(' ')}>{p.severity}</span>
                <span className={[admin.pill, admin.pillNeutral].join(' ')}>{p.audienceScope === 'all' ? 'All clients' : `${p.carrierIds.length} carrier(s)`}</span>
                <span className={[admin.pill, admin.pillNeutral].join(' ')}>{p.roles.join(' + ')}</span>
              </div>
              <PostBody html={p.body.en} />
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
