import { Gem } from '../../components/Gem';
import { CheckIcon, XIcon } from '../../components/icons';
import { AGENT_LABELS, type AgentKey } from '../../access/mytrions.config';
import { ElicitationPicker } from './ElicitationPicker';
import { Markdown } from './Markdown';
import { SourcesList } from './SourcesList';
import type { UiMessage } from './types';
import styles from './MessageBubble.module.css';

function agentLabel(key: string): string {
  return AGENT_LABELS[key as AgentKey] ?? key;
}

/** A single chat turn. Assistant rows surface tool chips, thinking dots, grounding, and errors. */
export function MessageBubble({
  message,
  onPick,
  onRetry,
}: {
  message: UiMessage;
  onPick?: ((value: string) => void) | undefined;
  onRetry?: ((assistantId: string) => void) | undefined;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>{message.text}</div>
      </div>
    );
  }

  const thinking = message.streaming && !message.text && !message.error;
  const hasGrounding =
    (message.passages != null && message.passages > 0) ||
    (message.citations != null && message.citations.length > 0);
  const answeredBy = !message.streaming && message.agentKey ? message.agentKey : null;

  // A finished assistant turn with nothing to show: drop the row entirely (no blank gem row).
  if (
    !message.streaming &&
    !message.text &&
    !message.error &&
    message.tools.length === 0 &&
    !hasGrounding &&
    !message.elicitation
  ) {
    return null;
  }

  return (
    <div className={styles.assistantRow}>
      <Gem size={28} />
      <div className={styles.body}>
        {(message.tools.length > 0 || answeredBy) && (
          <div className={styles.chips}>
            {answeredBy && (
              <span
                className={`${styles.chip} ${styles.chipAgent}`}
                title={
                  message.agentPath.length > 1
                    ? `Handoff: ${message.agentPath.map(agentLabel).join(' → ')}`
                    : `Answered by the ${agentLabel(answeredBy)} agent`
                }
              >
                {message.agentPath.length > 1
                  ? message.agentPath.map(agentLabel).join(' → ')
                  : agentLabel(answeredBy)}
              </span>
            )}
            {message.tools.map((t) => {
              const ok = t.status === 'ok';
              const running = t.status === 'running';
              const tone = running ? styles.chipRunning : ok ? styles.chipOk : styles.chipDenied;
              return (
                <span key={t.name} className={`${styles.chip} ${tone}`}>
                  {running ? <span className={styles.spinner} /> : ok ? <CheckIcon size={10} /> : <XIcon size={10} />}
                  <span className={styles.chipLabel}>{t.name}</span>
                </span>
              );
            })}
          </div>
        )}

        {thinking && (
          <div className={styles.thinking}>
            <span className={styles.dots}>
              <i className={styles.dot} />
              <i className={styles.dot} />
              <i className={styles.dot} />
            </span>
            <span className={styles.thinkLabel}>{message.status || 'Thinking'}</span>
          </div>
        )}

        {message.text && (
          <div className={styles.text}>
            <Markdown text={message.text} />
            {message.streaming && <span className={styles.caret} aria-hidden="true" />}
          </div>
        )}

        {message.stopped && !message.streaming && (
          <div className={styles.stoppedNote}>Stopped — partial answer kept.</div>
        )}

        {!message.streaming && hasGrounding && (
          <SourcesList passages={message.passages} citations={message.citations} />
        )}

        {message.error && (
          <div className={styles.errText} role="alert">
            <span>{message.error}</span>
            {onRetry && !message.streaming && (
              <button type="button" className={styles.retryBtn} onClick={() => onRetry(message.id)}>
                Retry
              </button>
            )}
          </div>
        )}

        {!message.streaming && message.elicitation && (
          <ElicitationPicker elicitation={message.elicitation} onPick={onPick} />
        )}
      </div>
    </div>
  );
}
