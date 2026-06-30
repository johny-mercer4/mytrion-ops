import { Gem } from '../../components/Gem';
import { CheckIcon, XIcon } from '../../components/icons';
import type { UiMessage } from './types';
import styles from './MessageBubble.module.css';

/** A single chat turn. Assistant rows surface tool chips, thinking dots, grounding, and errors. */
export function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>{message.text}</div>
      </div>
    );
  }

  const thinking = message.streaming && !message.text && !message.error;
  const hasGrounding = message.passages != null && message.passages > 0;

  // A finished assistant turn with nothing to show: drop the row entirely (no blank gem row).
  if (!message.streaming && !message.text && !message.error && message.tools.length === 0 && !hasGrounding) {
    return null;
  }

  return (
    <div className={styles.assistantRow}>
      <Gem size={28} />
      <div className={styles.body}>
        {message.tools.length > 0 && (
          <div className={styles.chips}>
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
            {message.text}
            {message.streaming && <span className={styles.caret} aria-hidden="true" />}
          </div>
        )}

        {!message.streaming && hasGrounding && (
          <div className={styles.grounding}>
            <CheckIcon size={11} />
            Grounded in {message.passages} passage{message.passages === 1 ? '' : 's'}
          </div>
        )}

        {message.error && <div className={styles.errText}>{message.error}</div>}
      </div>
    </div>
  );
}
