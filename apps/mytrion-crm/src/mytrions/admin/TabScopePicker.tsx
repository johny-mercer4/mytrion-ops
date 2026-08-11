import { useMemo, useState } from 'react';
import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';
import { tabsFor, unknownTabKeys, type TabDescriptor } from '../../access/tabRegistry';
import s from './admin.module.css';

/**
 * Which tabs of one Mytrion a permission set grants.
 *
 * ONE component, two thresholds — not three layouts. Finance has two tabs and Admin has eighteen, and
 * a picker that needs a different design per workspace is a picker that goes stale the moment someone
 * adds a tab. Groups come from the registry, which mirrors each shell's own NavSection labels, so an
 * admin sees the structure the user sees. Manager's General / Departments split falls straight out of
 * that, which is exactly the control the requirement asked for.
 *
 * `null` scope means UNSCOPED — every tab, including ones added later — and is deliberately distinct
 * from an empty array. The segmented control above the grid is what switches between them, because
 * the difference is invisible if you only ever see checkboxes.
 */

const FILTER_THRESHOLD = 10;
const BULK_THRESHOLD = 4;

export function TabScopePicker({
  mytrionId,
  scope,
  onChange,
  busy,
}: {
  mytrionId: MytrionId;
  /** `null` = unscoped. An array (even empty) = scoped to exactly those keys. */
  scope: string[] | null;
  onChange: (next: string[] | null) => void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState('');
  const tabs = tabsFor(mytrionId);
  const title = MYTRIONS[mytrionId]?.title ?? mytrionId;

  const groups = useMemo(() => {
    const out = new Map<string, TabDescriptor[]>();
    for (const tab of tabs) {
      const key = tab.group ?? '';
      out.set(key, [...(out.get(key) ?? []), tab]);
    }
    return [...out.entries()];
  }, [tabs]);

  /**
   * Grants naming a tab that no longer exists.
   *
   * Never auto-pruned — a rename that silently dropped grants would be unrecoverable and invisible.
   * The server cannot compute this either (the registry is client-side, deliberately), so the editor
   * diffs and offers an explicit Remove.
   */
  const orphans = scope ? unknownTabKeys(mytrionId, scope) : [];

  const selected = new Set(scope ?? []);
  const filtered = query.trim()
    ? tabs.filter((t) => t.label.toLowerCase().includes(query.trim().toLowerCase()))
    : tabs;

  const toggle = (key: string): void => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };

  const grantedCount = tabs.filter((t) => selected.has(t.key)).length;
  const missing = tabs.length - grantedCount;

  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{title} tabs</span>

      <div className={s.profileModeRow}>
        <button
          type="button"
          disabled={busy}
          aria-pressed={scope === null}
          className={`${s.filterChip} ${scope === null ? s.filterChipOn : ''}`}
          onClick={() => onChange(null)}
        >
          All tabs (incl. future)
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={scope !== null}
          className={`${s.filterChip} ${scope !== null ? s.filterChipOn : ''}`}
          // Seed from every tab rather than nothing: "only selected" starting empty reads as a bug,
          // and the admin almost always wants to remove a few rather than add them all back.
          onClick={() => onChange(tabs.map((t) => t.key))}
        >
          Only selected
        </button>
      </div>

      {scope === null ? (
        <p className={s.noticeNote} style={{ marginTop: 6 }}>
          Every tab in {title}, including any added later. This is the default and needs no
          maintenance when the workspace grows.
        </p>
      ) : (
        <>
          {tabs.length > BULK_THRESHOLD && (
            <div className={s.profileModeRow} style={{ marginTop: 8 }}>
              <button
                type="button"
                disabled={busy}
                className={s.filterChip}
                onClick={() => onChange(tabs.map((t) => t.key))}
              >
                Select all
              </button>
              <button
                type="button"
                disabled={busy}
                className={s.filterChip}
                onClick={() => onChange([])}
              >
                Clear
              </button>
              <span className={s.noticeNote} style={{ alignSelf: 'center' }}>
                {grantedCount} of {tabs.length}
              </span>
            </div>
          )}

          {tabs.length > FILTER_THRESHOLD && (
            <label className={s.search} style={{ marginTop: 8 }}>
              <input
                className={s.searchInput}
                placeholder={`Filter ${tabs.length} tabs…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}

          {groups.map(([group, groupTabs]) => {
            const shown = groupTabs.filter((t) => filtered.includes(t));
            if (shown.length === 0) return null;
            return (
              <fieldset
                key={group || 'ungrouped'}
                style={{ border: 0, margin: 0, padding: '6px 0 0' }}
              >
                {group && (
                  <legend className={s.fieldLabel} style={{ padding: 0 }}>
                    {group}
                  </legend>
                )}
                <div className={s.profileChipGrid}>
                  {shown.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      disabled={busy}
                      aria-pressed={selected.has(tab.key)}
                      className={`${s.filterChip} ${selected.has(tab.key) ? s.filterChipOn : ''}`}
                      onClick={() => toggle(tab.key)}
                    >
                      {/* Fixed width, same as the Mytrion chip grid: the gradient is the chip's only
                          on-state and forced-colors mode drops it, and a check that changes the
                          chip's size re-flows the whole grid on every toggle. */}
                      <span aria-hidden="true" style={{ display: 'inline-block', width: '1.05em' }}>
                        {selected.has(tab.key) ? '✓' : ''}
                      </span>
                      {tab.label}
                      {tab.soon ? ' · Soon' : ''}
                    </button>
                  ))}
                </div>
              </fieldset>
            );
          })}

          {missing > 0 && (
            <p className={s.noticeNote} style={{ marginTop: 6 }}>
              {missing} tab{missing === 1 ? '' : 's'} in {title} not granted by this set.{' '}
              <button
                type="button"
                disabled={busy}
                className={s.linkBtn}
                onClick={() => onChange(tabs.map((t) => t.key))}
              >
                Grant all
              </button>
            </p>
          )}

          {orphans.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p className={s.noticeNote}>
                Stored for tabs that no longer exist. Kept rather than dropped — a rename must not
                silently discard a grant.
              </p>
              <div className={s.profileChipGrid}>
                {orphans.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    className={s.filterChip}
                    style={{ opacity: 0.6 }}
                    title={`"${key}" is no longer a tab in ${title}`}
                    onClick={() => onChange((scope ?? []).filter((k) => k !== key))}
                  >
                    {key} — remove
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
