/**
 * Conversation history — an overlay inside the chat dock (toggled from the header), not a
 * sidebar: the 404px dock has no room for a second column. Escape or outside-click closes;
 * selecting a conversation opens it and closes the panel.
 */
import { useEffect, useRef } from 'react';
import type { ConversationSummary } from '../../api/chat';
import styles from './ConversationList.module.css';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  /** A turn is streaming: switching/deleting waits (New in the header interrupts instead). */
  streaming: boolean;
  onOpen(id: string): void;
  onRemove(id: string): void;
  onClose(): void;
}

export function ConversationList({
  conversations,
  activeId,
  streaming,
  onOpen,
  onRemove,
  onClose,
}: ConversationListProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-label="Conversation history"
      tabIndex={-1}
    >
      <div className={styles.panelHead}>History</div>
      <div className={styles.scroll}>
        {conversations.length === 0 && <p className={styles.empty}>No conversations yet.</p>}
        {conversations.map((c) => (
          <div key={c.id} className={`${styles.item} ${c.id === activeId ? styles.active : ''}`}>
            <button
              type="button"
              className={styles.openBtn}
              onClick={() => {
                onOpen(c.id);
                onClose();
              }}
              disabled={streaming}
              title={c.title ?? 'Untitled'}
            >
              <span className={styles.title}>{c.title?.trim() || 'Untitled chat'}</span>
              <span className={styles.meta}>
                {c.messageCount} msg · {relativeTime(c.lastMessageAt)}
              </span>
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
    </div>
  );
}
