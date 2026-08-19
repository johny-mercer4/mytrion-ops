import { useCallback, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { Button, Dialog, Input } from '@/ds';
import c from './comms.module.css';

/**
 * A saved view is a named filter combination (status tab + search term) an agent reuses — "my open
 * fraud cases", "everything for ACME". Client-side by design: it is a per-person convenience, not shared
 * state, so it lives in localStorage and needs no backend. Persistence is best-effort — React state is
 * the source of truth, so a locked-down or missing localStorage just means the list does not survive a
 * reload rather than the control breaking.
 */
export interface SavedView {
  id: string;
  name: string;
  filter: string;
  term: string;
}

const KEY_PREFIX = 'desk.savedViews.v1.';

function read(viewsKey: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + viewsKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SavedView =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as SavedView).id === 'string' &&
        typeof (v as SavedView).name === 'string',
    );
  } catch {
    return [];
  }
}

function write(viewsKey: string, views: SavedView[]): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + viewsKey, JSON.stringify(views));
  } catch {
    // Best-effort: a private-mode / disabled store just means views do not persist across reloads.
  }
}

/** A stable-enough id without Date.now/Math.random dependencies mattering — collisions only cost a key. */
function makeId(existing: SavedView[]): string {
  let n = existing.length + 1;
  while (existing.some((v) => v.id === `v${n}`)) n += 1;
  return `v${n}`;
}

export function SavedViews({
  viewsKey,
  current,
  onApply,
}: {
  viewsKey: string;
  current: { filter: string; term: string };
  onApply: (view: { filter: string; term: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>(() => read(viewsKey));
  const [name, setName] = useState('');

  const persist = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      write(viewsKey, next);
    },
    [viewsKey],
  );

  const save = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Overwrite a same-named view rather than duplicating it.
    const without = views.filter((v) => v.name.toLowerCase() !== trimmed.toLowerCase());
    persist([
      ...without,
      { id: makeId(views), name: trimmed, filter: current.filter, term: current.term },
    ]);
    setName('');
  }, [name, views, current, persist]);

  const apply = useCallback(
    (v: SavedView) => {
      onApply({ filter: v.filter, term: v.term });
      setOpen(false);
    },
    [onApply],
  );

  return (
    <>
      <button
        type="button"
        className={c.viewsBtn}
        onClick={() => setOpen(true)}
        aria-label="Saved views"
      >
        <Bookmark size={13} aria-hidden="true" />
        Views{views.length > 0 ? ` (${views.length})` : ''}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Saved views" size="sm">
        {views.length > 0 ? (
          <ul className={c.viewsList}>
            {views.map((v) => (
              <li key={v.id} className={c.viewsItem}>
                <button type="button" className={c.viewsApply} onClick={() => apply(v)}>
                  <span className={c.viewsName}>{v.name}</span>
                  <span className={c.viewsMeta}>
                    {v.filter}
                    {v.term ? ` · “${v.term}”` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className={c.viewsDelete}
                  onClick={() => persist(views.filter((x) => x.id !== v.id))}
                  aria-label={`Delete view ${v.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={c.viewsEmpty}>
            No saved views yet. Set a filter and a search term, then save it here to reuse.
          </p>
        )}

        <div className={c.viewsSave}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this view (current filter + search)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          <Button size="sm" variant="primary" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </Dialog>
    </>
  );
}
