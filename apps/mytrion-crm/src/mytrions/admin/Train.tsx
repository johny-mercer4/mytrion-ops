import { useState } from 'react';
import { CheckIcon } from '../../components/icons';
import s from './admin.module.css';

interface Source {
  id: string;
  title: string;
  meta: string;
  fresh: 'ready' | 'stale';
}

// TODO(live): from GET /v1/knowledge — the corpus available to re-embed.
const SOURCES: Source[] = [
  { id: '1', title: 'EFS_WEX_card_policy_v4.pdf', meta: 'Sales · 142 chunks', fresh: 'ready' },
  { id: '2', title: 'Carrier_onboarding_playbook.md', meta: 'Sales · 42 chunks', fresh: 'ready' },
  { id: '3', title: 'Refund_and_dispute_policy_2026.pdf', meta: 'Billing · 18 chunks', fresh: 'stale' },
  { id: '4', title: 'Collection_escalation_playbook.md', meta: 'Collection · 64 chunks', fresh: 'ready' },
  { id: '5', title: 'Money_code_approval_matrix.md', meta: 'Sales · 12 chunks', fresh: 'stale' },
  { id: '6', title: 'Verification_hardstop_rules.docx', meta: 'Verification · 31 chunks', fresh: 'ready' },
];

/** Admin Train — select sources, tune chunking, and re-embed the knowledge base. */
export function Train() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(SOURCES.map((x) => x.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const n = selected.size;

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Train Agents</h2>
          <p className={s.sub}>Select sources, tune chunking, and re-embed the knowledge base.</p>
        </div>
      </div>

      <div className={s.grid2}>
        {/* Sources */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>
              Sources <span className={s.count}>· {n} of 1,204 selected</span>
            </span>
            <span className={s.eyebrow}>Filter by department</span>
          </div>
          {SOURCES.map((src) => {
            const on = selected.has(src.id);
            return (
              <label key={src.id} className={s.checkRow}>
                <span className={`${s.checkbox} ${on ? s.checkboxOn : ''}`} aria-hidden="true">
                  {on && <CheckIcon size={11} />}
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(src.id)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                <span className={s.checkMain}>
                  <div className={`${s.checkName} ${on ? s.on : ''}`}>{src.title}</div>
                  <div className={s.checkMeta}>{src.meta}</div>
                </span>
                <span className={`${s.pill} ${src.fresh === 'ready' ? s.pillGood : s.pillWarn}`}>
                  {src.fresh === 'ready' ? 'Ready' : 'Stale'}
                </span>
              </label>
            );
          })}
        </div>

        {/* Training run */}
        <div className={`${s.card} ${s.cardPad}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3_5)' }}>
          <span className={s.cardTitle}>Training run</span>
          <div className={s.field}>
            <span className={s.fieldLabel}>Target scope</span>
            <select className={s.select}>
              <option>All departments</option>
              <option>Sales</option>
              <option>Collection</option>
              <option>Billing</option>
            </select>
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Embedding model</span>
            <select className={`${s.select} ${s.mono}`}>
              <option>text-embedding-3-large</option>
              <option>text-embedding-3-small</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className={s.field}>
              <span className={s.fieldLabel}>Chunk size</span>
              <input className={`${s.input} ${s.mono}`} defaultValue="512" inputMode="numeric" />
            </div>
            <div className={s.field}>
              <span className={s.fieldLabel}>Overlap</span>
              <input className={`${s.input} ${s.mono}`} defaultValue="64" inputMode="numeric" />
            </div>
          </div>
          <button type="button" className={`${s.primaryBtn} ${s.tall}`} disabled={n === 0}>
            Run training on {n} source{n === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      {/* Active run */}
      <div className={`${s.card} ${s.cardPad}`}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <span className={s.cardTitle}>Active run</span>
          <span className={`${s.pill} ${s.pillInfo}`}>
            <span className={s.spinner} />
            Embedding · 64%
          </span>
        </div>
        <div className={s.progressTrack}>
          <div className={s.progressFill} style={{ width: '64%' }} />
        </div>
        <div className={s.runStats}>
          <span>
            Chunks <strong>4,210 / 6,580</strong>
          </span>
          <span>
            Tokens <strong>2.7M</strong>
          </span>
          <span>
            Elapsed <strong>1m 48s</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
