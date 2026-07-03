import type { UserContext } from '../../context/userContext';
import type { AgentKey } from '../../access/mytrions.config';
import { Gem } from '../../components/Gem';
import { PlusIcon } from '../../components/icons';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { useChat } from './useChat';
import styles from './ChatPanel.module.css';

/**
 * The docked AI Chat (right rail of every Mytrion): header (gem + scope + New), the streaming
 * transcript, and the composer. Shared by all Mytrions; `department` is the active scope forwarded
 * to the backend (null = broad/admin), and `agentKey` selects the department agent for direct-to-child
 * (null = orchestrator mode). The conversation history lives in useChat; the dock surfaces only "New".
 */
export function ChatPanel({
  context,
  department,
  agentKey = null,
}: {
  context: UserContext;
  department?: string | string[] | null;
  agentKey?: AgentKey | null;
}) {
  const chat = useChat(context, department ?? null, agentKey);
  const scope =
    department == null ? 'admin' : Array.isArray(department) ? department.join(', ') : department;

  return (
    <div className={styles.dock}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Gem size={26} />
          <div>
            <div className={styles.name}>AI Chat</div>
            <div className={styles.sub}>Knowledge-grounded · scope: {scope}</div>
          </div>
        </div>
        <button type="button" className={styles.new} onClick={chat.newConversation} disabled={chat.streaming}>
          <PlusIcon size={12} />
          New
        </button>
      </div>

      <MessageList messages={chat.messages} onPick={chat.send} />

      {chat.error && <p className={styles.error}>{chat.error}</p>}

      <div className={styles.composerWrap}>
        <Composer disabled={chat.streaming} onSend={chat.send} />
      </div>
    </div>
  );
}
