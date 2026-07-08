/**
 * The generative-UI picker an agent surfaces (e.g. crm.pick_my_client). Single-select sends the
 * pick immediately; multiSelect toggles options (aria-pressed) and sends the joined values on
 * Confirm — the pick IS the next turn, matching the existing contract. Focus lands on the first
 * option when the picker appears.
 */
import { useEffect, useRef, useState } from 'react';
import type { Elicitation } from '../../api/stream';
import styles from './MessageBubble.module.css';

export function ElicitationPicker({
  elicitation,
  onPick,
}: {
  elicitation: Elicitation;
  onPick?: ((value: string) => void) | undefined;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const firstRef = useRef<HTMLButtonElement>(null);
  const multi = elicitation.multiSelect === true;

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const toggle = (value: string) =>
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  return (
    <div className={styles.picker} role="group" aria-label={elicitation.prompt || 'Choose an option'}>
      {elicitation.prompt && <div className={styles.pickerPrompt}>{elicitation.prompt}</div>}
      <div className={styles.pickerOptions}>
        {elicitation.options.map((opt, i) => {
          const pressed = multi && selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className={`${styles.pickerBtn} ${pressed ? styles.pickerBtnOn : ''}`}
              {...(multi ? { 'aria-pressed': pressed } : {})}
              onClick={() => (multi ? toggle(opt.value) : onPick?.(opt.value))}
            >
              <span>{opt.label}</span>
              {opt.hint && <span className={styles.pickerHint}>{opt.hint}</span>}
            </button>
          );
        })}
      </div>
      {multi && (
        <button
          type="button"
          className={styles.pickerConfirm}
          disabled={selected.length === 0}
          onClick={() => onPick?.(selected.join(', '))}
        >
          Confirm{selected.length > 0 ? ` (${selected.length})` : ''}
        </button>
      )}
    </div>
  );
}
