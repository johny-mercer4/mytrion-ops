import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SendArrowIcon, StopIcon } from '../../components/icons';
import styles from './Composer.module.css';

interface ComposerProps {
  streaming: boolean;
  onSend(text: string): void;
  onStop?(): void;
}

/**
 * Auto-growing pill input. Enter sends, Shift+Enter newlines. While a turn streams the textarea
 * stays editable (draft the next question) but submit is locked and the action button morphs
 * into Stop (type="button" — a submit-typed stop would fire the form). Escape also stops.
 */
export function Composer({ streaming, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  function grow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue('');
    requestAnimationFrame(grow);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      onStop?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className={styles.pill} onSubmit={submit}>
      <textarea
        ref={taRef}
        className={styles.input}
        value={value}
        rows={1}
        aria-label="Message the assistant"
        placeholder={streaming ? 'Generating… (Esc to stop)' : 'Ask the knowledge base…'}
        onChange={(e) => {
          setValue(e.target.value);
          grow();
        }}
        onKeyDown={onKeyDown}
      />
      {streaming ? (
        <button
          type="button"
          className={`${styles.send} ${styles.stop}`}
          onClick={() => onStop?.()}
          aria-label="Stop generating"
        >
          <StopIcon size={12} />
        </button>
      ) : (
        <button type="submit" className={styles.send} disabled={!value.trim()} aria-label="Send">
          <SendArrowIcon size={16} />
        </button>
      )}
    </form>
  );
}
