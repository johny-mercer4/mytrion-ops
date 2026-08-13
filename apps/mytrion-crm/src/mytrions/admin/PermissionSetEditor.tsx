import { useEffect, useMemo, useState } from 'react';
import {
  MYTRIONS,
  MYTRION_ORDER,
  mytrionShortLabel,
  type MytrionId,
} from '../../access/mytrions.config';
import { MytrionGlyph } from '../../components/icons';
import type { MytrionAccessMode } from '../../api/mytrionAccess';
import { savePermissionSetGrants, type PermissionSet } from '../../api/permissionSets';
import { MytrionAccessModeField } from './MytrionAccessModeField';
import { TabScopePicker } from './TabScopePicker';
import { adminToast } from './toast';
import s from './admin.module.css';

/**
 * What a permission set grants, as three ordered levels.
 *
 * The levels are the precedence of the decision itself, not a visual device: you cannot say what
 * permission someone has in Billing (2) before granting Billing (1), and you cannot scope Billing's
 * tabs (3) before either. Presenting them as one flat wall of controls — which is what shipped
 * first — hides that dependency and makes the screen unreadable the moment a set grants more than
 * one workspace.
 *
 * DRAFT, NOT AUTOSAVE. The first version PATCHed on every click, so a "Save" button would have been
 * a lie and a half-finished configuration was already live for everyone holding the set. The editor
 * now holds a draft, the save bar appears only when it differs from what is stored, and Save applies
 * the whole thing in ONE request so it can never half-apply.
 */

export interface GrantDraft {
  allowedMytrions: MytrionId[];
  modes: Partial<Record<MytrionId, MytrionAccessMode>>;
  tabGrants: Partial<Record<MytrionId, string[]>>;
}

function draftOf(set: PermissionSet): GrantDraft {
  return {
    allowedMytrions: [...set.allowedMytrions],
    modes: { ...set.mytrionAccessModes },
    tabGrants: { ...set.tabGrants },
  };
}

/** Order-insensitive, so merely re-picking a chip does not read as an unsaved change. */
function sameDraft(a: GrantDraft, b: GrantDraft): boolean {
  const ids = (d: GrantDraft): string => [...d.allowedMytrions].sort().join(',');
  const modes = (d: GrantDraft): string =>
    Object.entries(d.modes)
      .filter(([id]) => d.allowedMytrions.includes(id as MytrionId))
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([id, m]) => `${id}:${m}`)
      .join(',');
  const tabs = (d: GrantDraft): string =>
    Object.entries(d.tabGrants)
      .filter(([id]) => d.allowedMytrions.includes(id as MytrionId))
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([id, keys]) => `${id}:${[...(keys ?? [])].sort().join('|')}`)
      .join(',');
  return ids(a) === ids(b) && modes(a) === modes(b) && tabs(a) === tabs(b);
}

export function PermissionSetEditor({
  set,
  onSaved,
}: {
  set: PermissionSet;
  /** Called with the stored set after a successful save — the caller returns to the list. */
  onSaved: (next: PermissionSet) => void;
}) {
  const [draft, setDraft] = useState<GrantDraft>(() => draftOf(set));
  const [busy, setBusy] = useState(false);

  // Re-seed when the caller opens a different set, so a draft never leaks across records.
  useEffect(() => {
    setDraft(draftOf(set));
  }, [set.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stored = useMemo(() => draftOf(set), [set]);
  const dirty = !sameDraft(draft, stored);
  const granted = useMemo(() => new Set(draft.allowedMytrions), [draft.allowedMytrions]);
  const grantedInOrder = MYTRION_ORDER.filter((id) => granted.has(id));

  const toggleMytrion = (id: MytrionId): void =>
    setDraft((d) => {
      const next = new Set(d.allowedMytrions);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...d, allowedMytrions: [...next] };
    });

  const setMode = (id: MytrionId, mode: MytrionAccessMode): void =>
    setDraft((d) => ({ ...d, modes: { ...d.modes, [id]: mode } }));

  const setScope = (id: MytrionId, tabs: string[] | null): void =>
    setDraft((d) => {
      const next = { ...d.tabGrants };
      // `null` is UNSCOPED and must remove the key entirely — an empty array means "no tabs", which
      // is the opposite statement.
      if (tabs === null) delete next[id];
      else next[id] = tabs;
      return { ...d, tabGrants: next };
    });

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const next = await savePermissionSetGrants(set.id, {
        allowedMytrions: draft.allowedMytrions,
        mytrionAccessModes: draft.modes,
        tabGrants: draft.tabGrants,
      });
      adminToast.success('Permission set saved', set.name);
      onSaved(next);
    } catch (err) {
      adminToast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The card is rendered HERE, not by the caller, because `.card` is `overflow: hidden` and a
          sticky save bar inside one is pinned to a box that never scrolls — i.e. not sticky at all.
          The bar has to be the card's sibling. */}
      <div className={s.card}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>Access</span>
        </div>
        <div className={s.profileCardBody}>
      <div className={s.psLevel}>
        <div className={s.psLevelHead}>
          <h3 className={s.psLevelTitle}>
            <span className={s.psLevelIndex}>1</span>
            Which Mytrions this set grants
          </h3>
          <p className={s.sub} style={{ margin: 0 }}>
            Pick the workspaces. Everything below is configured per workspace.
          </p>
        </div>
        <div className={s.profileChipGrid}>
          {MYTRION_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={granted.has(id)}
              data-mytrion={id}
              className={`${s.filterChip} ${granted.has(id) ? s.filterChipOn : ''}`}
              onClick={() => toggleMytrion(id)}
            >
              {/* The same department mark the launcher and header badge use, so a workspace is
                  recognisable here by the glyph rather than only by reading its label. */}
              <span className={s.psChipIcon} aria-hidden="true">
                <MytrionGlyph name={MYTRIONS[id]?.icon ?? id} size={14} />
              </span>
              {mytrionShortLabel(id)}
            </button>
          ))}
        </div>
      </div>

      <div className={`${s.psLevel} ${grantedInOrder.length === 0 ? s.psLevelWaiting : ''}`}>
        <div className={s.psLevelHead}>
          <h3 className={s.psLevelTitle}>
            <span className={s.psLevelIndex}>2</span>
            Full access or read-only, per workspace
          </h3>
          <p className={s.sub} style={{ margin: 0 }}>
            Applies across the whole workspace. Read-only is enforced by the server on every
            write-gated action, not just hidden in the UI.
          </p>
        </div>
        {grantedInOrder.length === 0 ? (
          <p className={s.fieldHint}>Pick a workspace in level 1 first.</p>
        ) : (
          grantedInOrder.map((id) => (
            <MytrionAccessModeField
              key={id}
              mytrionId={id}
              value={draft.modes[id] ?? 'full'}
              onChange={(mode) => setMode(id, mode)}
            />
          ))
        )}
      </div>

      <div className={`${s.psLevel} ${grantedInOrder.length === 0 ? s.psLevelWaiting : ''}`}>
        <div className={s.psLevelHead}>
          <h3 className={s.psLevelTitle}>
            <span className={s.psLevelIndex}>3</span>
            Which tabs inside each workspace
          </h3>
          <p className={s.sub} style={{ margin: 0 }}>
            “All tabs” keeps up with the product — a tab added later is included automatically.
            Choose specific tabs only when the set should stop changing on its own.
          </p>
        </div>
        {grantedInOrder.length === 0 ? (
          <p className={s.fieldHint}>Pick a workspace in level 1 first.</p>
        ) : (
          grantedInOrder.map((id) => (
            <div key={id} className={s.permissionSetRow}>
              <TabScopePicker
                mytrionId={id}
                scope={draft.tabGrants[id] ?? null}
                onChange={(tabs) => setScope(id, tabs)}
              />
            </div>
          ))
        )}
      </div>

        </div>
      </div>

      {dirty && (
        <div className={s.psSaveBar} role="status">
          <p className={s.psSaveBarNote}>
            {describeDraft(draft)} — unsaved.
          </p>
          <button
            type="button"
            className={s.ghostBtn}
            disabled={busy}
            onClick={() => setDraft(draftOf(set))}
          >
            Discard
          </button>
          <button type="button" className={s.primaryBtn} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </>
  );
}

/** "2 workspaces, 1 tab-scoped" — what the admin is about to store, in their own terms. */
function describeDraft(draft: GrantDraft): string {
  const n = draft.allowedMytrions.length;
  const scoped = draft.allowedMytrions.filter((id) => draft.tabGrants[id] !== undefined).length;
  const readOnly = draft.allowedMytrions.filter((id) => draft.modes[id] === 'read').length;
  const parts = [n === 1 ? '1 workspace' : `${n} workspaces`];
  if (readOnly > 0) parts.push(`${readOnly} read-only`);
  if (scoped > 0) parts.push(`${scoped} tab-scoped`);
  return n === 0 ? 'No workspaces' : parts.join(', ');
}
