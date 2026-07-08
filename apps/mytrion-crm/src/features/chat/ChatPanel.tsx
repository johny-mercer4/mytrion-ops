import { useState } from 'react';
import type { UserContext } from '../../context/userContext';
import type { AgentKey } from '../../access/mytrions.config';
import { Gem } from '../../components/Gem';
import { ExternalLinkIcon, HistoryIcon, PlusIcon, XIcon } from '../../components/icons';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { useChat } from './useChat';
import styles from './ChatPanel.module.css';

/**
 * The AI Chat content — header (gem + scope + pop-out + close + History + New), the streaming
 * transcript, and the composer. Rendered inside the launcher's modal (`onClose` closes it) or,
 * standalone, as the full `/m/:mytrion/chat` page (no close/pop-out — it IS the popped-out tab).
 * `department` is the active scope forwarded to the backend (null = broad/admin); `agentKey`
 * selects the department agent for direct-to-child (null = orchestrator mode). History is an
 * in-panel overlay; the last conversation restores on reload (useChat).
 */
export function ChatPanel({
  context,
  department,
  agentKey = null,
  popoutHref,
  standalone = false,
  onClose,
}: {
  context: UserContext;
  department?: string | string[] | null;
  agentKey?: AgentKey | null;
  /** Shown as an "open in a new tab" button in modal mode (not standalone). */
  popoutHref?: string;
  /** True for the dedicated /chat tab itself — no close/pop-out affordances. */
  standalone?: boolean;
  /** Closes the launcher modal. Omitted (and ignored) in standalone mode. */
  onClose?: () => void;
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
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Gem size={26} />
          <div>
            <div className={styles.name}>AI Chat</div>
            <div className={styles.sub}>Knowledge-grounded · scope: {scope}</div>
          </div>
        </div>
        <div className={styles.headerActions}>
          {!standalone && popoutHref && (
            <button
              type="button"
              className={styles.headerIconBtn}
              aria-label="Open AI Chat in a new tab"
              title="Open in a new tab"
              onClick={() => window.open(popoutHref, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLinkIcon size={13} />
            </button>
          )}
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
          {!standalone && onClose && (
            <button
              type="button"
              className={styles.headerIconBtn}
              aria-label="Close AI Chat"
              title="Close"
              onClick={onClose}
            >
              <XIcon size={12} />
            </button>
          )}
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
