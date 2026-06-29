import type { UiMessage } from './types';
import styles from './MessageBubble.module.css';

/** A single chat turn. Assistant rows also surface the live status, grounding count, and tool calls. */
export function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === 'user';
  const showStatus = !isUser && message.streaming && !message.text && !!message.status;
  const showCursor = !isUser && message.streaming && !!message.text;

  // A finished assistant turn with nothing to show (empty/aborted stream) would render a blank
  // padded balloon — drop the row entirely instead. "Nothing" must also account for the grounding
  // line, which renders on passages>0 alone (a turn can ground on passages yet emit no text).
  const hasGrounding = message.passages != null && message.passages > 0;
  if (!isUser && !message.streaming && !message.text && !message.error && message.tools.length === 0 && !hasGrounding) {
    return null;
  }

  return (
    <div className={`${styles.row} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.bubble}>
        {!isUser && message.tools.length > 0 && (
          <div className={styles.tools}>
            {message.tools.map((t) => (
              <span key={t.name} className={`${styles.tool} ${t.status === 'running' ? styles.toolRunning : ''}`}>
                {t.name}
                {t.status !== 'running' && t.status !== 'ok' ? ` · ${t.status}` : ''}
              </span>
            ))}
          </div>
        )}

        {showStatus && (
          <p className={styles.status}>
            <span className={styles.dots} aria-hidden="true" />
            {message.status}
          </p>
        )}

        {message.text && (
          <p className={styles.text}>
            {message.text}
            {showCursor && <span className={styles.caret} aria-hidden="true" />}
          </p>
        )}

        {!isUser && !message.streaming && message.passages != null && message.passages > 0 && (
          <p className={styles.meta}>Grounded on {message.passages} knowledge passage{message.passages === 1 ? '' : 's'}</p>
        )}

        {message.error && <p className={styles.error}>{message.error}</p>}
      </div>
    </div>
  );
}
