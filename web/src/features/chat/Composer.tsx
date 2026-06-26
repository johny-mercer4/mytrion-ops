import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import styles from './Composer.module.css';

interface ComposerProps {
  disabled: boolean;
  onSend(text: string): void;
}

/** Auto-growing input. Enter sends, Shift+Enter newlines; locked while a turn streams. */
export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  function grow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
    requestAnimationFrame(grow);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <textarea
        ref={taRef}
        className={styles.input}
        value={value}
        rows={1}
        placeholder={disabled ? 'Waiting for the assistant…' : 'Message the Octane assistant…'}
        onChange={(e) => {
          setValue(e.target.value);
          grow();
        }}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className={styles.send} disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  );
}
