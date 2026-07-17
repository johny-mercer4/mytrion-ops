/**
 * DWH client search for the carrier invite form — debounced, newest applications first.
 *
 * Implements the ARIA combobox pattern properly: the markup already claimed listbox/option roles,
 * which promise arrow-key selection to a screen reader user, but nothing listened for the keys.
 * The input keeps focus throughout and points at the highlighted row via aria-activedescendant.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { searchClients, type DwhClient } from '../../api/carrierUsers';
import { SearchIcon } from '../../components/icons';
import s from './admin.module.css';

export function ClientCombobox({ onPick, onManual }: { onPick: (client: DwhClient) => void; onManual: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DwhClient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const comboId = useId();
  const listboxId = `${comboId}-listbox`;
  const optionId = (i: number) => `${comboId}-option-${i}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const open = Boolean(results?.length);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError('');
      setBusy(false);
      return;
    }
    setBusy(true);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      searchClients(q, 15, ac.signal)
        .then((clients) => {
          setResults(clients);
          setError('');
        })
        .catch((e: unknown) => {
          if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ac.signal.aborted) setBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query]);

  // Reset the highlight whenever the result set changes underneath it.
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  // Click-away closes the list. Without this the only ways out were picking something or editing
  // the query — the list would just sit over the form.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setResults(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(c: DwhClient) {
    setResults(null);
    setQuery('');
    onPick(c);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setResults(null);
      return;
    }
    if (!open || !results) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const from = activeIndex < 0 && delta < 0 ? 0 : activeIndex;
      setActiveIndex((from + delta + results.length) % results.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault(); // Enter here means "take this client", not "submit the form"
      const c = results[activeIndex];
      if (c) pick(c);
    }
  }

  return (
    <>
      <div style={{ position: 'relative' }} ref={rootRef}>
        <label className={s.search} style={{ margin: 0 }}>
          <SearchIcon size={14} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search your clients — company name, carrier id, or application id"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            {...(activeIndex >= 0 ? { 'aria-activedescendant': optionId(activeIndex) } : {})}
          />
          {busy && <span className={s.chipMeta}>searching…</span>}
        </label>
        {results && results.length > 0 && (
          <div className={s.clientPick} role="listbox" id={listboxId} aria-label="Matching clients">
            {results.map((c, i) => (
              <button
                key={`${c.carrierId ?? ''}:${c.applicationId ?? ''}:${i}`}
                type="button"
                role="option"
                id={optionId(i)}
                aria-selected={i === activeIndex}
                className={`${s.clientPickRow} ${i === activeIndex ? s.clientPickRowActive : ''}`}
                // The input keeps focus so it stays the combobox; the highlight follows the mouse.
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(c)}
              >
                <span className={s.docTitle}>{c.companyName ?? '(unnamed deal)'}</span>
                <span className={s.checkMeta}>
                  {c.carrierId ? `carrier ${c.carrierId}` : 'no carrier yet'}
                  {c.applicationId ? ` · app ${c.applicationId}` : ''}
                  {c.applicationDate ? ` · applied ${c.applicationDate}` : ''}
                  {c.stage ? ` · ${c.stage}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className={s.errorNote}>{error}</p>}
      <p className={s.fieldHint}>
        {results?.length === 0 ? 'No clients match. ' : 'Newest applications first. '}
        <button type="button" className={s.linkBtn} onClick={onManual}>
          Enter the details manually instead
        </button>
      </p>
    </>
  );
}
