import { useState } from 'react';
import type { UserContext } from '../../context/userContext';
import type { AgentKey } from '../../access/mytrions.config';
import { Gem } from '../../components/Gem';
import { Sparkle, HistoryIcon, PlusIcon } from '../../components/icons';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { useChat } from './useChat';
import styles from './ChatPanel.module.css';

/**
 * The docked AI Chat (right rail of every Mytrion): header (gem + scope + History + New), the
 * streaming transcript, and the composer. Shared by all Mytrions; `department` is the active scope
 * forwarded to the backend (null = broad/admin), and `agentKey` selects the department agent for
 * direct-to-child (null = orchestrator mode). History is an in-dock overlay; the last conversation
 * restores on reload (useChat).
 */
export function ChatPanel({
  context,
  department,
  agentKey = null,
  variant = 'dock',
}: {
  context: UserContext;
  department?: string | string[] | null;
  agentKey?: AgentKey | null;
  variant?: 'dock' | 'full';
}) {
  const chat = useChat(context, department ?? null, agentKey);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scope =
    department == null ? 'admin' : Array.isArray(department) ? department.join(', ') : department;

  // The one live status line for screen readers: transitions only, never per token.
  const liveStatus = (() => {
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return '';
    if (last.streaming) return last.status || 'Assistant is responding';
    if (last.stopped) return 'Generation stopped';
    return '';
  })();

  return (
    <div className={variant === 'full' ? styles.full : styles.dock}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Sparkle size={26} />
          <div>
            <div className={styles.name}>Horizon AI</div>
            <div className={styles.sub}>Knowledge-grounded · scope: {scope}</div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.new}
            aria-expanded={historyOpen}
            aria-label="Conversation history"
            onClick={() => {
              setHistoryOpen((v) => !v);
              if (!historyOpen) void chat.refreshConversations();
            }}
          >
            <HistoryIcon size={12} />
            History
          </button>
          {/* New stays enabled during streaming — it aborts safely and starts fresh. */}
          <button type="button" className={styles.new} onClick={chat.newConversation}>
            <PlusIcon size={12} />
            New
          </button>
        </div>
      </div>

      <div className={styles.bodyWrap}>
        <MessageList messages={chat.messages} onPick={chat.send} onRetry={chat.retry} />
        {historyOpen && (
          <ConversationList
            conversations={chat.conversations}
            activeId={chat.conversationId}
            streaming={chat.streaming}
            onOpen={(id) => void chat.openConversation(id)}
            onRemove={(id) => void chat.removeConversation(id)}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>

      <p className={styles.srOnly} aria-live="polite">
        {liveStatus}
      </p>

      {chat.error && (
        <p className={styles.error} role="alert">
          {chat.error}
        </p>
      )}

      <div className={styles.composerWrap}>
        <Composer streaming={chat.streaming} onSend={chat.send} onStop={chat.stop} />
      </div>
    </div>
  );
}
