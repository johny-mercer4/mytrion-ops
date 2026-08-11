import { useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import type { MytrionAccessMode } from '../../api/mytrionAccess';
import {
  removePermissionSetMytrion,
  setPermissionSetMytrion,
  type PermissionSet,
} from '../../api/permissionSets';
import { MytrionAccessModeField } from './MytrionAccessModeField';
import { TabScopePicker } from './TabScopePicker';
import { adminToast } from './toast';
import s from './admin.module.css';

/**
 * The grants half of a permission set: which Mytrions, at what mode, scoped to which tabs.
 *
 * EVERY ROW SAVES ITSELF. Each Mytrion PATCHes its own endpoint with its own busy state, the way
 * Escalation Routing does — the server rewrites one jsonb key rather than the whole row, so two
 * admins editing two different Mytrions of the same set cannot clobber each other. There is no
 * "Save" button, and deliberately no draft state: a half-applied form that looks saved is worse than
 * a row that is visibly still saving.
 */
export function PermissionSetEditor({
  set,
  onChanged,
}: {
  set: PermissionSet;
  onChanged: (next: PermissionSet) => void;
}) {
  const [busyId, setBusyId] = useState<MytrionId | null>(null);

  const granted = new Set(set.allowedMytrions);

  async function run(id: MytrionId, work: () => Promise<PermissionSet>): Promise<void> {
    setBusyId(id);
    try {
      onChanged(await work());
    } catch (err) {
      adminToast.error('Could not save that grant', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const toggleMytrion = (id: MytrionId): Promise<void> =>
    run(id, () =>
      granted.has(id)
        ? removePermissionSetMytrion(set.id, id)
        : // A new grant defaults to full and UNSCOPED — the same defaults the resolver applies for an
          // omitted mode and an absent tab list, so the row reads the way it will behave.
          setPermissionSetMytrion(set.id, id, { mode: 'full', tabs: null }),
    );

  const setMode = (id: MytrionId, mode: MytrionAccessMode): Promise<void> =>
    run(id, () => setPermissionSetMytrion(set.id, id, { mode, tabs: set.tabGrants[id] ?? null }));

  const setScope = (id: MytrionId, tabs: string[] | null): Promise<void> =>
    run(id, () =>
      setPermissionSetMytrion(set.id, id, { mode: set.mytrionAccessModes[id] ?? 'full', tabs }),
    );

  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>Mytrions this set grants</span>
      <p className={s.noticeNote}>
        Additive — this set can only ADD access on top of whatever the profile, role and per-user
        layers already give someone. It can never take access away.
      </p>

      <div className={s.profileChipGrid}>
        {MYTRION_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            disabled={busyId !== null}
            aria-pressed={granted.has(id)}
            className={`${s.filterChip} ${granted.has(id) ? s.filterChipOn : ''}`}
            onClick={() => void toggleMytrion(id)}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: '1.05em' }}>
              {granted.has(id) ? '✓' : ''}
            </span>
            {MYTRIONS[id]?.tag ?? id}
          </button>
        ))}
      </div>

      {MYTRION_ORDER.filter((id) => granted.has(id)).map((id) => (
        <div key={id} className={s.permissionSetRow}>
          <MytrionAccessModeField
            mytrionId={id}
            value={set.mytrionAccessModes[id] ?? 'full'}
            onChange={(mode) => void setMode(id, mode)}
          />
          <TabScopePicker
            mytrionId={id}
            scope={set.tabGrants[id] ?? null}
            onChange={(tabs) => void setScope(id, tabs)}
            busy={busyId === id}
          />
        </div>
      ))}

      {granted.size === 0 && (
        <p className={s.noticeNote}>
          No Mytrions yet — pick one above. A set with no grants is harmless but does nothing.
        </p>
      )}
    </div>
  );
}
