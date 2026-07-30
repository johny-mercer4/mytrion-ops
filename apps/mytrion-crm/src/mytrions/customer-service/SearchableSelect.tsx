/**
 * A filterable single-select for lists too long to scan in a native `<select>`.
 *
 * Built for the Maintenance owner filter: 16 owners in a flat dropdown means an agent hunts for a
 * name, and a native select has no way to type past the first letter. Filtering is CLIENT-side — the
 * whole option list already arrives with `/meta`, so searching must not cost a request.
 *
 * Reuses the module's existing lookup chrome (`cs-lookup-wrap` / `cs-lookup-dropdown` /
 * `cs-lookup-item`) so it matches the company pickers rather than introducing a second combobox look.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered right-aligned and muted — a count, a carrier id, anything secondary. */
  hint?: string;
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  allLabel,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  placeholder: string;
  /** Label for the "no filter" choice. */
  allLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Prefix matches first — typing "ma" should surface "Mara" above "Tamara".
    const starts: SelectOption[] = [];
    const contains: SelectOption[] = [];
    for (const o of options) {
      const l = o.label.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [options, query]);

  // Reset the highlight whenever the visible set changes, or Enter picks a stale row.
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Close on any outside pointer press. Pointerdown rather than click so it fires before a focus
  // change repaints, which otherwise leaves the panel open under the next control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const commit = (v: string) => {
    onChange(v);
    setQuery('');
    setOpen(false);
  };

  const rows: SelectOption[] = [{ value: '', label: allLabel }, ...filtered];

  return (
    <div className="cs-lookup-wrap cs-ss-wrap" ref={wrapRef}>
      <input
        className="cs-form-input cs-ss-input"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="cs-ss-list"
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setActive((i) => {
              const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
              return Math.max(0, Math.min(rows.length - 1, next));
            });
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && rows[active]) commit(rows[active].value);
          } else if (e.key === 'Escape') {
            // Only closes the panel — Escape must not also dismiss the surrounding modal/panel.
            e.stopPropagation();
            setOpen(false);
            setQuery('');
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="cs-lookup-clear"
          aria-label="Clear"
          onPointerDown={(e) => {
            e.preventDefault();
            commit('');
          }}
        >
          ×
        </button>
      ) : null}
      {open ? (
        <div className="cs-lookup-dropdown cs-ss-list" id="cs-ss-list" role="listbox">
          {rows.length === 1 && query ? (
            <div className="cs-ss-empty">No match for “{query}”</div>
          ) : (
            rows.map((o, i) => (
              <div
                key={o.value || '__all__'}
                role="option"
                aria-selected={o.value === value}
                className={`cs-lookup-item cs-ss-item${i === active ? ' is-active' : ''}${
                  o.value === value ? ' is-selected' : ''
                }`}
                // Pointerdown, not click: a click fires after blur, which would have closed the panel.
                onPointerDown={(e) => {
                  e.preventDefault();
                  commit(o.value);
                }}
                onPointerEnter={() => setActive(i)}
              >
                <span className="cs-ss-item-label">{o.label}</span>
                {o.hint ? <span className="cs-ss-item-hint">{o.hint}</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
