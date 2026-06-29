import type { ZohoContext } from '../../zoho/embeddedApp';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { useChat } from './useChat';
import styles from './ChatPanel.module.css';

/** The AI Chat widget: session sidebar + streaming transcript + composer, scoped to the Zoho user. */
export function ChatPanel({ context }: { context: ZohoContext }) {
  const chat = useChat(context);
  const dept = context.departmentScope ?? 'all (admin)';

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
          <span className={styles.who}>{context.user.name || 'You'}</span>
          <span className={styles.scope}>scope: {dept}</span>
        </div>

        <MessageList messages={chat.messages} />

        {chat.error && <p className={styles.error}>{chat.error}</p>}

        <Composer disabled={chat.streaming} onSend={chat.send} />
      </div>
    </div>
  );
}
