import { useEffect, useState } from 'react';

/**
 * The value, `ms` after it stopped changing.
 *
 * Every list in this app search-as-you-types, and every one of them had grown its own
 * `useEffect(() => { const t = setTimeout(...); return () => clearTimeout(t); }, [term])` — the
 * same six lines in Collection, Verification, Array and the Watch queue. One hook, so a keystroke
 * cannot fire a request in one workspace and not in another.
 *
 * Returns the CURRENT value on first render, not null: a page that opens with a term already in
 * the box (a restored filter) must not spend the first 300ms fetching the unfiltered book.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
