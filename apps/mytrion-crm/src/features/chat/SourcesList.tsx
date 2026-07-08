/**
 * Grounding footnote for an answer: when the backend reports actual citation sources, an
 * expandable titled list; otherwise the legacy count-only line (older backend — graceful
 * degradation is the compatibility story).
 */
import { useState } from 'react';
import { CheckIcon, DocIcon } from '../../components/icons';
import type { Citation } from './types';
import styles from './MessageBubble.module.css';

export function SourcesList({ passages, citations }: { passages: number | null; citations: Citation[] | null }) {
  const [open, setOpen] = useState(false);
  const hasSources = Boolean(citations && citations.length > 0);

  if (!hasSources) {
    if (passages == null || passages === 0) return null;
    return (
      <div className={styles.grounding}>
        <CheckIcon size={11} />
        Grounded in {passages} passage{passages === 1 ? '' : 's'}
      </div>
    );
  }

  const list = citations ?? [];
  return (
    <div className={`${styles.grounding} ${styles.groundingCol}`}>
      <button
        type="button"
        className={styles.sourcesToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CheckIcon size={11} />
        {list.length} source{list.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className={styles.sourcesList}>
          {list.map((c) => (
            <li key={`${c.id}:${c.marker ?? ''}`} className={styles.sourceItem}>
              <DocIcon size={12} />
              <span className={styles.sourceTitle}>{c.title}</span>
              {c.marker && <span className={styles.sourceMarker}>[{c.marker}]</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
