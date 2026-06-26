import type { ConversationSummary } from '../../api/chat';
import styles from './ConversationList.module.css';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  /** A turn is streaming. New chat stays enabled (it interrupts); switching/deleting waits. */
  streaming: boolean;
  onNew(): void;
  onOpen(id: string): void;
  onRemove(id: string): void;
}

/** The session sidebar: New chat + the user's recent conversations. */
export function ConversationList({ conversations, activeId, streaming, onNew, onOpen, onRemove }: ConversationListProps) {
  return (
    <aside className={styles.sidebar}>
      <button type="button" className={styles.newBtn} onClick={onNew}>
        {streaming ? '+ New chat (stop)' : '+ New chat'}
      </button>

      <div className={styles.scroll}>
        {conversations.length === 0 && <p className={styles.empty}>No conversations yet.</p>}
        {conversations.map((c) => (
          <div key={c.id} className={`${styles.item} ${c.id === activeId ? styles.active : ''}`}>
            <button
              type="button"
              className={styles.openBtn}
              onClick={() => onOpen(c.id)}
              disabled={streaming}
              title={c.title ?? 'Untitled'}
            >
              <span className={styles.title}>{c.title?.trim() || 'Untitled chat'}</span>
              <span className={styles.count}>{c.messageCount} msg</span>
            </button>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => onRemove(c.id)}
              disabled={streaming}
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
