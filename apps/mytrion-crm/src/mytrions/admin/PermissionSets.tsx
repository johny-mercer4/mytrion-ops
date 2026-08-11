import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assignPermissionSet,
  createPermissionSet,
  deletePermissionSet,
  getPermissionSets,
  unassignPermissionSet,
  updatePermissionSet,
  type PermissionSet,
  type PermissionSetSnapshot,
} from '../../api/permissionSets';
import { Button, ErrorState } from '@/ds';
import { PermissionSetEditor } from './PermissionSetEditor';
import { adminToast } from './toast';
import s from './admin.module.css';

/**
 * Admin → Permission Sets.
 *
 * Named, reusable, ADDITIVE grants assigned to users — the reusable object the three existing access
 * layers were missing. "These forty agents get the same narrowed Billing" used to mean forty
 * per-user rows that drift apart.
 *
 * ONE snapshot GET holds the whole screen; every mutation PATCHes its own row and folds the returned
 * set back into state, so nothing here re-fetches on a keystroke and no control can be left showing
 * a value the server rejected.
 */
export function PermissionSets() {
  const [snapshot, setSnapshot] = useState<PermissionSetSnapshot | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshot(await getPermissionSets());
      setError(null);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setError({
        message: err instanceof Error ? err.message : 'Could not load permission sets',
        ...(code === undefined ? {} : { code }),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fold one updated set back in rather than re-fetching the screen. */
  const merge = useCallback((next: PermissionSet) => {
    setSnapshot((prev) =>
      prev
        ? { ...prev, sets: prev.sets.map((s2) => (s2.id === next.id ? { ...s2, ...next } : s2)) }
        : prev,
    );
  }, []);

  const open = useMemo(
    () => snapshot?.sets.find((set) => set.id === openId) ?? null,
    [snapshot, openId],
  );

  async function create(): Promise<void> {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const set = await createPermissionSet({ name });
      setNewName('');
      await load();
      setOpenId(set.id);
      adminToast.success('Permission set created', name);
    } catch (err) {
      adminToast.error('Could not create', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(set: PermissionSet): Promise<void> {
    try {
      merge(await updatePermissionSet(set.id, { active: !set.active }));
    } catch (err) {
      adminToast.error('Could not update', err instanceof Error ? err.message : undefined);
    }
  }

  async function remove(set: PermissionSet): Promise<void> {
    // Deleting takes the assignments with it — no FKs, so the server does that explicitly.
    if (!window.confirm(`Delete "${set.name}"? ${set.assigneeCount} assignee(s) lose it.`)) return;
    try {
      await deletePermissionSet(set.id);
      setOpenId(null);
      await load();
      adminToast.success('Permission set deleted', set.name);
    } catch (err) {
      adminToast.error('Could not delete', err instanceof Error ? err.message : undefined);
    }
  }

  async function assign(setId: string, zohoUserId: string, name: string | null): Promise<void> {
    try {
      await assignPermissionSet(setId, { zohoUserId, userName: name });
      await load();
    } catch (err) {
      adminToast.error('Could not assign', err instanceof Error ? err.message : undefined);
    }
  }

  async function unassign(setId: string, zohoUserId: string): Promise<void> {
    try {
      await unassignPermissionSet(setId, zohoUserId);
      await load();
    } catch (err) {
      adminToast.error('Could not unassign', err instanceof Error ? err.message : undefined);
    }
  }

  if (error) {
    /**
     * WHAT HAPPENED and WHAT TO DO, not a bare sentence in a full-bleed strip.
     *
     * The realistic failure is code reaching an environment ahead of its migration, and the server
     * now says so by name — so the description is the operator's actual next move rather than an
     * apology. Retry stays available because the fix happens outside the browser: run the migration,
     * press Retry, no reload.
     */
    const notMigrated = error.code === 'PERMISSION_SETS_NOT_MIGRATED';
    return (
      <ErrorState
        headingLevel={2}
        title={notMigrated ? 'Permission sets are not set up on this environment' : 'Could not load permission sets'}
        description={
          notMigrated
            ? error.message
            : `${error.message} — this screen only reads; nothing has changed.`
        }
        primaryAction={
          <Button variant="primary" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!snapshot) return <p className={s.noticeNote}>Loading permission sets…</p>;

  if (open) {
    const assignees = snapshot.assignments.filter((a) => a.permissionSetId === open.id);
    const assignedIds = new Set(assignees.map((a) => a.zohoUserId));
    return (
      <div>
        <button type="button" className={s.linkBtn} onClick={() => setOpenId(null)}>
          ← All permission sets
        </button>
        <h3 style={{ marginTop: 'var(--space-3)' }}>{open.name}</h3>
        <p className={s.noticeNote}>
          {open.active ? 'Active' : 'Inactive — grants nothing while off'} ·{' '}
          {open.allowedMytrions.length} Mytrion(s) · {assignees.length} assignee(s)
        </p>

        <PermissionSetEditor set={open} onChanged={merge} />

        <div className={s.field}>
          <span className={s.fieldLabel}>Assigned to</span>
          {assignees.length === 0 && (
            <p className={s.noticeNote}>Nobody yet — this set has no effect until it is assigned.</p>
          )}
          <div className={s.profileChipGrid}>
            {assignees.map((a) => (
              <button
                key={a.zohoUserId}
                type="button"
                className={`${s.filterChip} ${s.filterChipOn}`}
                title="Remove"
                onClick={() => void unassign(open.id, a.zohoUserId)}
              >
                <span aria-hidden="true" style={{ display: 'inline-block', width: '1.05em' }}>
                  ✕
                </span>
                {a.userName ?? a.zohoUserId}
              </button>
            ))}
          </div>

          <span className={s.fieldLabel} style={{ marginTop: 'var(--space-3)' }}>
            Add someone
          </span>
          {/* Straight from the roster, which carries every ACTIVE Zoho worker — so an admin can
              assign someone who has never had an access row of any kind. */}
          <div className={s.profileChipGrid}>
            {snapshot.roster
              .filter((r) => !assignedIds.has(r.zohoUserId))
              .slice(0, 60)
              .map((r) => (
                <button
                  key={r.zohoUserId}
                  type="button"
                  className={s.filterChip}
                  onClick={() => void assign(open.id, r.zohoUserId, r.name)}
                >
                  + {r.name ?? r.zohoUserId}
                </button>
              ))}
          </div>
        </div>

        <div className={s.profileModeRow} style={{ marginTop: 'var(--space-4)' }}>
          <button type="button" className={s.filterChip} onClick={() => void toggleActive(open)}>
            {open.active ? 'Deactivate' : 'Activate'}
          </button>
          <button type="button" className={s.filterChip} onClick={() => void remove(open)}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className={s.noticeNote}>
        A permission set is granted once and assigned to many people. Sets are ADDITIVE: they union
        with the profile, role and per-user layers and can only widen access, never narrow it.
      </p>

      <div className={s.profileModeRow}>
        <label className={s.search}>
          <input
            className={s.searchInput}
            placeholder="New permission set name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
        </label>
        <button type="button" className={s.filterChip} disabled={busy || !newName.trim()} onClick={() => void create()}>
          Create
        </button>
      </div>

      <div className={s.profileGrid} style={{ marginTop: 'var(--space-3)' }}>
        {snapshot.sets.map((set) => {
          const scoped = Object.keys(set.tabGrants).length;
          return (
            <div key={set.id} className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardTitle}>{set.name}</span>
              </div>
              <div className={s.profileCardBody}>
                <p className={s.noticeNote}>
                  {set.allowedMytrions.length} Mytrion(s) · {scoped} tab-scoped ·{' '}
                  {set.assigneeCount} assignee(s)
                  {set.active ? '' : ' · inactive'}
                </p>
                <button type="button" className={s.filterChip} onClick={() => setOpenId(set.id)}>
                  Edit
                </button>
              </div>
            </div>
          );
        })}
        {snapshot.sets.length === 0 && (
          <p className={s.noticeNote}>No permission sets yet. Create one above.</p>
        )}
      </div>
    </div>
  );
}
