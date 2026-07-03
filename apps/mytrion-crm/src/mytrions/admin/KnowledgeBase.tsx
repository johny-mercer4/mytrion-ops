import { useMemo, useState } from 'react';
import { DocIcon, PlusIcon, SearchIcon } from '../../components/icons';
import s from './admin.module.css';

type DocStatus = 'ready' | 'embedding' | 'failed';
interface KnowledgeDoc {
  id: string;
  title: string;
  department: string;
  chunks: number | null;
  status: DocStatus;
}

// TODO(live): replace with GET /v1/knowledge (admin scope, allDepartments).
const DOCS: KnowledgeDoc[] = [
  { id: '1', title: 'EFS_WEX_card_policy_v4.pdf', department: 'Sales', chunks: 142, status: 'ready' },
  { id: '2', title: 'Carrier_onboarding_playbook.md', department: 'Sales', chunks: 42, status: 'ready' },
  { id: '3', title: 'Refund_and_dispute_policy_2026.pdf', department: 'Billing', chunks: 18, status: 'ready' },
  { id: '4', title: 'Collection_escalation_playbook.md', department: 'Collection', chunks: 64, status: 'embedding' },
  { id: '5', title: 'Verification_hardstop_rules.docx', department: 'Verification', chunks: null, status: 'failed' },
];

const STATUS_LABEL: Record<DocStatus, string> = { ready: 'Ready', embedding: 'Embedding', failed: 'Failed' };
const COLS = { gridTemplateColumns: '2.6fr 1fr 1fr 1fr' } as const;

/** Admin Knowledge Base — the source documents grounding every Mytrion's answers. */
export function KnowledgeBase() {
  const [query, setQuery] = useState('');
  const docs = useMemo(
    () => DOCS.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );
  const totalChunks = DOCS.reduce((n, d) => n + (d.chunks ?? 0), 0);
  const ready = DOCS.filter((d) => d.status === 'ready').length;
  const embedding = DOCS.filter((d) => d.status === 'embedding').length;

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Knowledge Base</h2>
          <p className={s.sub}>Source documents grounding every Mytrion's answers.</p>
        </div>
        <button type="button" className={s.primaryBtn}>
          <PlusIcon size={14} />
          Add source
        </button>
      </div>

      <div className={s.statGrid}>
        <div className={s.statTile}>
          <div className={s.statNum}>{DOCS.length.toLocaleString()}</div>
          <div className={s.statLabel}>Documents</div>
        </div>
        <div className={s.statTile}>
          <div className={s.statNum}>{totalChunks.toLocaleString()}</div>
          <div className={s.statLabel}>Chunks</div>
        </div>
        <div className={s.statTile}>
          <div className={`${s.statNum} ${s.good}`}>{ready.toLocaleString()}</div>
          <div className={s.statLabel}>Ready</div>
        </div>
        <div className={s.statTile}>
          <div className={`${s.statNum} ${s.warn}`}>{embedding.toLocaleString()}</div>
          <div className={s.statLabel}>Embedding</div>
        </div>
      </div>

      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
        />
      </label>

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>Document</span>
          <span>Department</span>
          <span className={s.right}>Chunks</span>
          <span className={s.right}>Status</span>
        </div>
        {docs.map((d) => (
          <div key={d.id} className={s.tRow} style={COLS}>
            <span className={s.docCell}>
              <DocIcon size={16} />
              <span className={s.docTitle}>{d.title}</span>
            </span>
            <span className={s.deptText}>{d.department}</span>
            <span className={`${s.right} ${s.mono}`}>{d.chunks == null ? '—' : d.chunks}</span>
            <span className={s.right}>
              <StatusPill status={d.status} />
            </span>
          </div>
        ))}
        {docs.length === 0 && <div className={s.none}>No documents match “{query}”.</div>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: DocStatus }) {
  const tone = status === 'ready' ? s.pillGood : status === 'embedding' ? s.pillWarn : s.pillBad;
  return (
    <span className={`${s.pill} ${tone}`}>
      {status === 'embedding' ? <span className={s.spinner} /> : <span className={s.dot} />}
      {STATUS_LABEL[status]}
    </span>
  );
}
