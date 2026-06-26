import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { UiMessage } from './types';
import styles from './MessageList.module.css';

/** Scrolling transcript. Auto-sticks to the bottom as tokens stream in. */
export function MessageList({ messages }: { messages: UiMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  // The reducer returns a fresh `messages` array on every relevant change (token, tool, status,
  // grounding, done), so depending on the array reference re-pins to the bottom for all of them.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className={styles.list}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Ask the Octane assistant</p>
          <p className={styles.emptyHint}>
            It searches the knowledge base and calls CRM / Desk tools, scoped to your department.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
