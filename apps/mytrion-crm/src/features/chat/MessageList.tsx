import { useEffect, useRef } from 'react';
import { Gem } from '../../components/Gem';
import { MessageBubble } from './MessageBubble';
import { useStickToBottom } from './useStickToBottom';
import type { UiMessage } from './types';
import styles from './MessageList.module.css';

/**
 * Scrolling transcript. Follows the stream only while the user is at the bottom — scrolling up
 * to read detaches (no mid-read yank); a floating button jumps back down. Sending always snaps.
 */
export function MessageList({
  messages,
  onPick,
  onRetry,
  hydrating = false,
}: {
  messages: UiMessage[];
  onPick?: (value: string) => void;
  onRetry?: (assistantId: string) => void;
  /** Restoring the previous conversation — show its shape instead of the welcome copy. */
  hydrating?: boolean;
}) {
  const { containerRef, onScroll, followIfSticky, scrollToBottom, atBottom } = useStickToBottom();
  const lastUserIdRef = useRef<string | null>(null);

  // The reducer returns a fresh `messages` array on every relevant change (token, tool, status,
  // grounding, done). A NEW user message force-sticks (sending snaps down); everything else
  // follows only while the user is already at the bottom.
  useEffect(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser && lastUser.id !== lastUserIdRef.current) {
      lastUserIdRef.current = lastUser.id;
      scrollToBottom();
      return;
    }
    followIfSticky();
  }, [messages, followIfSticky, scrollToBottom]);

  // One affordance for this region: skeleton turns that mirror the transcript, never a spinner on
  // top of them and never the welcome copy we are about to replace.
  if (hydrating && messages.length === 0) {
    return (
      <div className={styles.list} role="status" aria-label="Restoring your conversation">
        <div className={styles.skeleton} aria-hidden="true">
          {[
            { role: 'user', widths: ['62%'] },
            { role: 'assistant', widths: ['94%', '88%', '71%'] },
            { role: 'user', widths: ['48%'] },
            { role: 'assistant', widths: ['92%', '64%'] },
          ].map((turn, i) => (
            <div
              key={i}
              className={turn.role === 'user' ? styles.skelTurnUser : styles.skelTurnAssistant}
            >
              <div className={turn.role === 'user' ? styles.skelUserBubble : styles.skelAssistant}>
                {turn.widths.map((w, j) => (
                  <span key={j} className={styles.skelLine} style={{ width: w }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={styles.list}>
        <div className={styles.empty}>
          <Gem size={56} />
          <p className={styles.emptyTitle}>Horizon AI</p>
          <p className={styles.emptyHint}>
            Grounded in your knowledge base and scoped to your department — ask about policies,
            carriers, invoices, tickets, and more.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.listWrap}>
      <div
        ref={containerRef}
        className={styles.list}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation"
      >
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onPick={onPick} onRetry={onRetry} />
        ))}
      </div>
      {!atBottom && (
        <button
          type="button"
          className={styles.toBottom}
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
        >
          ↓
        </button>
      )}
    </div>
  );
}
