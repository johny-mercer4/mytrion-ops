/**
 * The admin toggle row, wired to the WAI-ARIA radiogroup pattern.
 *
 * The buttons already carried role="radio", which tells a screen reader user to expect arrow-key
 * navigation — so the group has to actually provide it: one tab stop (roving tabindex), arrows to
 * move and select, Home/End to jump. Tab alone skipping between every option is the bug this fixes.
 */
import { useRef, type ReactNode } from 'react';
import s from './admin.module.css';

export interface RadioOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

export function RadioToggleGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<RadioOption<T>>;
  onChange: (value: T) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const index = options.findIndex((o) => o.value === value);
    if (index < 0) return;
    // Wrap, per the radiogroup pattern — the set is small and cyclic.
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    focusValue(next.value);
  }

  function focusValue(v: T) {
    const i = options.findIndex((o) => o.value === v);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[i]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        if (options[0]) {
          onChange(options[0].value);
          focusValue(options[0].value);
        }
        break;
      case 'End': {
        e.preventDefault();
        const last = options[options.length - 1];
        if (last) {
          onChange(last.value);
          focusValue(last.value);
        }
        break;
      }
      default:
        break;
    }
  }

  return (
    <div ref={groupRef} className={s.toggleRow} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tabindex: the group is one tab stop, arrows move within it.
            tabIndex={checked ? 0 : -1}
            className={`${s.toggle} ${checked ? s.toggleOn : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
