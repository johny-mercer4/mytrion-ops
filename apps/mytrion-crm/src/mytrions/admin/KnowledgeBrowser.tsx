import { useEffect, useState, type FormEvent } from 'react';
import { listDocs, queryKnowledge, type RetrievedPassage } from '../../api/knowledge';
import { SearchIcon } from '../../components/icons';
import s from './admin.module.css';

const FILTERS = [
  'All',
  'sales',
  'marketing',
  'billing',
  'collection',
  'verification',
  'customer-service',
  'finance',
  'retention',
  'Global',
] as const;
type Filter = (typeof FILTERS)[number];

/** Admin Knowledge Browser — live semantic retrieval over the embedded passages. */
export function KnowledgeBrowser() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [passages, setPassages] = useState<RetrievedPassage[] | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Doc titles for the source refs (passages only carry docId) — state, so results
  // re-render with real titles once the list arrives.
  const [titles, setTitles] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let alive = true;
    listDocs({ limit: 200 })
      .then((res) => {
        if (alive) setTitles(new Map(res.docs.map((d) => [d.id, d.title])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function run(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    const started = performance.now();
    try {
      const res = await queryKnowledge({
        query: q,
        limit: 8,
        ...(filter === 'All'
          ? { allDepartments: true }
          : filter === 'Global'
            ? { departmentAccess: [] }
            : { departmentAccess: [filter] }),
      });
      setPassages(res.passages);
      setTookMs(Math.round(performance.now() - started));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassages(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Knowledge Browser</h2>
          <p className={s.sub}>Semantic retrieval test — exactly what the agents' knowledge_search sees.</p>
        </div>
      </div>

      <form onSubmit={(e) => void run(e)}>
        <label className={`${s.search} ${s.searchTall}`}>
          <SearchIcon size={16} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask the knowledge base… (Enter to search)"
          />
          <span className={s.modeChip}>{busy ? 'searching…' : 'vector kNN'}</span>
        </label>
      </form>

      <div className={s.chipRow}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`${s.filterChip} ${filter === f ? s.filterChipOn : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        {passages !== null && (
          <span className={s.chipMeta}>
            {passages.length} passage{passages.length === 1 ? '' : 's'}
            {tookMs != null ? ` · ${tookMs}ms` : ''}
          </span>
        )}
      </div>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={s.results}>
        {busy && (
          <div className={s.loadingBlock} role="status">
            <span className={s.loadingSpin} aria-hidden="true" />
            Searching knowledge base…
          </div>
        )}
        {!busy && passages === null && !error && (
          <div className={s.none}>Run a search to test retrieval (scoped by the selected filter).</div>
        )}
        {!busy &&
          passages?.map((p) => (
          <div key={`${p.docId}:${p.chunkIndex}`} className={s.resultCard}>
            <div className={s.resultTop}>
              <span className={`${s.scoreBadge} ${p.score >= 0.85 ? s.high : ''}`}>
                {p.score.toFixed(2)}
              </span>
              <span className={s.srcRef}>
                {titles.get(p.docId) ?? p.docId} · chunk {p.chunkIndex}
              </span>
            </div>
            <p className={s.passage}>{p.content}</p>
          </div>
        ))}
        {!busy && passages?.length === 0 && (
          <div className={s.none}>No passages found for that query in this scope.</div>
        )}
      </div>
    </div>
  );
}
