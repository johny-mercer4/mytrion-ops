import { useMemo, useState } from 'react';
import { DocIcon, SearchIcon } from '../../components/icons';
import styles from './KnowledgeBase.module.css';

type DocStatus = 'ready' | 'embedding' | 'failed';
interface KnowledgeDoc {
  id: string;
  title: string;
  department: string;
  deptHue: string;
  chunks: number;
  status: DocStatus;
}

// TODO(design agent): replace with live data from GET /v1/knowledge (admin scope, allDepartments).
const DOCS: KnowledgeDoc[] = [
  { id: '1', title: 'Carrier Onboarding Playbook v4', department: 'Sales', deptHue: '--success', chunks: 42, status: 'ready' },
  { id: '2', title: 'Refund & Dispute Policy 2026', department: 'Billing', deptHue: '--purple', chunks: 18, status: 'ready' },
  { id: '3', title: 'EFS / WEX Fuel Card FAQ', department: 'Global', deptHue: '--text-muted', chunks: 9, status: 'embedding' },
];

const STATUS_LABEL: Record<DocStatus, string> = { ready: 'Ready', embedding: 'Embedding', failed: 'Failed' };

/** Admin Knowledge Base panel (design 1c center): doc count + search + status-badged doc list. */
export function KnowledgeBase() {
  const [query, setQuery] = useState('');
  const docs = useMemo(
    () => DOCS.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );
  const totalChunks = DOCS.reduce((n, d) => n + d.chunks, 0);

  return (
    <div className={styles.wrap}>
      <div>
        <h1 className={styles.title}>Knowledge Base</h1>
        <div className={styles.sub}>
          {DOCS.length} documents · {totalChunks.toLocaleString()} embedded chunks
        </div>
      </div>

      <label className={styles.search}>
        <SearchIcon size={15} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
        />
      </label>

      <div className={styles.list}>
        {docs.map((d) => (
          <div key={d.id} className={styles.row}>
            <span className={styles.docIcon}>
              <DocIcon size={14} />
            </span>
            <div className={styles.docMain}>
              <div className={styles.docTitle}>{d.title}</div>
              <div className={styles.docMeta}>
                <span style={{ color: `var(${d.deptHue})`, fontWeight: 600 }}>{d.department}</span> · {d.chunks} chunks
              </div>
            </div>
            <span className={`${styles.status} ${styles[d.status]}`}>{STATUS_LABEL[d.status]}</span>
          </div>
        ))}
        {docs.length === 0 && <div className={styles.none}>No documents match “{query}”.</div>}
      </div>
    </div>
  );
}
