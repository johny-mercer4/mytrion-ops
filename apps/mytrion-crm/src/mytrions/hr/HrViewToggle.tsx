/**
 * Cards or list, per tab, remembered.
 *
 * Cards remain the default: a department or a person is an entity with an identity — a glyph, a colour,
 * a face — and the card is what carries that. A list is the right answer for the other job, comparing
 * many rows on the same few fields, and which job you are doing is not something the app can guess.
 *
 * The choice is stored per tab because they are genuinely different questions: someone can want the
 * people directory dense and still want departments as cards.
 */
import { useCallback, useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';

export type HrViewMode = 'cards' | 'list';

const keyFor = (scope: string): string => `octane.hr.view.${scope}.v1`;

/**
 * Read/write through try/catch: storage throws in private mode, and a view preference must never be
 * the reason a tab fails to render.
 */
export function useHrViewMode(scope: string): [HrViewMode, (next: HrViewMode) => void] {
  const [mode, setMode] = useState<HrViewMode>(() => {
    try {
      return localStorage.getItem(keyFor(scope)) === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });

  const choose = useCallback(
    (next: HrViewMode): void => {
      setMode(next);
      try {
        localStorage.setItem(keyFor(scope), next);
      } catch {
        // A preference that cannot be saved still works for this session.
      }
    },
    [scope],
  );

  return [mode, choose];
}

/**
 * Two radio buttons, not a single toggle: a lone icon button has to encode BOTH the current state and
 * the action in one glyph, and users reliably read it as the wrong one of the two.
 */
export function HrViewToggle({
  mode,
  onChange,
  label = 'View',
}: {
  mode: HrViewMode;
  onChange: (next: HrViewMode) => void;
  label?: string;
}) {
  return (
    <div className="hr-viewtoggle" role="radiogroup" aria-label={label}>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'cards'}
        aria-label="Card view"
        title="Card view"
        className="hr-viewtoggle-btn"
        onClick={() => onChange('cards')}
      >
        <LayoutGrid size={14} />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'list'}
        aria-label="List view"
        title="List view"
        className="hr-viewtoggle-btn"
        onClick={() => onChange('list')}
      >
        <List size={14} />
      </button>
    </div>
  );
}
