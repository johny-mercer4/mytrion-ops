import type { UserContext } from '../../context/userContext';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { useChat } from './useChat';
import styles from './ChatPanel.module.css';

/**
 * The AI Chat surface: session sidebar + streaming transcript + composer. Shared by every Mytrion;
 * `department` is the active Mytrion's scope (null = broad/admin), forwarded to the backend.
 */
export function ChatPanel({
  context,
  department,
}: {
  context: UserContext;
  department?: string | string[] | null;
}) {
  const chat = useChat(context, department ?? null);
  const scope =
    department == null ? 'all (admin)' : Array.isArray(department) ? department.join(', ') : department;

  return (
    <div className={styles.panel}>
      <ConversationList
        conversations={chat.conversations}
        activeId={chat.conversationId}
        streaming={chat.streaming}
        onNew={chat.newConversation}
        onOpen={chat.openConversation}
        onRemove={chat.removeConversation}
      />

      <div className={styles.main}>
        <div className={styles.scopeBar}>
          <span className={styles.who}>{context.userName || 'You'}</span>
          <span className={styles.scope}>scope: {scope}</span>
        </div>

        <MessageList messages={chat.messages} />

        {chat.error && <p className={styles.error}>{chat.error}</p>}

        <Composer disabled={chat.streaming} onSend={chat.send} />
      </div>
    </div>
  );
}
