/**
 * The header search field.
 *
 * On the launcher it filters the workspace grid. Inside a workspace there is nothing wired to it
 * yet, but the shell contract puts it on every screen — so it renders, and ⌘K focuses it.
 *
 * A printed ⌘K hint that ignores ⌘K is worse than no hint: it teaches the user the chrome is
 * decorative. Focusing the field costs a dozen lines and makes the affordance honest.
 *
 * It is deliberately NOT wired to the rail's tab filter. The header says "Search the Horizon
 * ecosystem", the rail says "Search tabs" — making one drive the other would install the wrong
 * mental model before the real search exists.
 */
import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import styles from './GlobalSearch.module.css';

export function GlobalSearch({
  placeholder,
  value,
  onChange,
  resultLabel,
}: {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  /** Announced to screen readers when the result count changes. Omit when nothing is filtered. */
  resultLabel?: string | undefined;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <label className={styles.field} data-focus-shell>
      <Search size={17} aria-hidden className={styles.glyph} />
      <input
        ref={ref}
        type="search"
        className={styles.input}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) onChange('');
            else e.currentTarget.blur();
          }
        }}
      />
      <span className={styles.kbd} aria-hidden>
        ⌘K
      </span>
      {resultLabel ? (
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {resultLabel}
        </span>
      ) : null}
    </label>
  );
}
