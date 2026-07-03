import { useEffect, useRef } from 'react';
import { Gem } from '../../components/Gem';
import { MessageBubble } from './MessageBubble';
import type { UiMessage } from './types';
import styles from './MessageList.module.css';

/** Scrolling transcript. Auto-sticks to the bottom as tokens stream in. */
export function MessageList({
  messages,
  onPick,
}: {
  messages: UiMessage[];
  onPick?: (value: string) => void;
}) {
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
          <Gem size={44} />
          <p className={styles.emptyTitle}>Ask Mytrion</p>
          <p className={styles.emptyHint}>
            Grounded in your knowledge base and scoped to your department — ask about policies,
            carriers, invoices, tickets, and more.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} onPick={onPick} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
