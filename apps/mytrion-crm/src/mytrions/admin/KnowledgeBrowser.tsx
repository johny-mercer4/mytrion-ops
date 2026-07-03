import { useMemo, useState } from 'react';
import { SearchIcon } from '../../components/icons';
import s from './admin.module.css';

interface Passage {
  id: string;
  score: number;
  source: string;
  dept: string;
  text: string;
}

// TODO(live): from POST /v1/knowledge/search (hybrid vector + BM25).
const PASSAGES: Passage[] = [
  {
    id: '1',
    score: 0.91,
    source: 'Collection_escalation_playbook.md · chunk 12',
    dept: 'Collection',
    text: 'A money code is generated as a percentage of the carrier’s latest invoice, for LOC carriers only, and is limited to one code per invoice. It requires approval before issuance.',
  },
  {
    id: '2',
    score: 0.86,
    source: 'EFS_WEX_card_policy_v4.pdf · chunk 4',
    dept: 'Sales',
    text: 'Cards placed on hold for fraud are eligible for two free overnight replacements; the $21.50 fee is waived. Release requires a request to the fraud team.',
  },
  {
    id: '3',
    score: 0.81,
    source: 'Carrier_onboarding_playbook.md · chunk 7',
    dept: 'Sales',
    text: 'LOC carriers spend against an approved credit limit and are billed on a cycle; prepay carriers load a balance up front and spend it down with no credit exposure.',
  },
];

const FILTERS = ['All', 'Sales', 'Billing', 'Collection', 'Verification', 'Global'];

/** Admin Knowledge Browser — semantic search across every embedded passage. */
export function KnowledgeBrowser() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PASSAGES.filter(
      (p) =>
        (filter === 'All' || p.dept === filter) &&
        (!q || p.text.toLowerCase().includes(q) || p.source.toLowerCase().includes(q)),
    );
  }, [query, filter]);

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Knowledge Browser</h2>
          <p className={s.sub}>Semantic search across every embedded passage.</p>
        </div>
      </div>

      <label className={`${s.search} ${s.searchTall}`}>
        <SearchIcon size={16} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search passages…"
        />
        <span className={s.modeChip}>vector + BM25</span>
      </label>

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
        <span className={s.chipMeta}>
          {results.length} passage{results.length === 1 ? '' : 's'} · 312ms
        </span>
      </div>

      <div className={s.results}>
        {results.map((p) => (
          <div key={p.id} className={s.resultCard}>
            <div className={s.resultTop}>
              <span className={`${s.scoreBadge} ${p.score >= 0.85 ? s.high : ''}`}>{p.score.toFixed(2)}</span>
              <span className={s.srcRef}>{p.source}</span>
              <span className={`${s.pill} ${s.pillNeutral}`} style={{ marginLeft: 'auto' }}>
                {p.dept}
              </span>
            </div>
            <p className={s.passage}>{p.text}</p>
          </div>
        ))}
        {results.length === 0 && <div className={s.none}>No passages match your search.</div>}
      </div>
    </div>
  );
}
