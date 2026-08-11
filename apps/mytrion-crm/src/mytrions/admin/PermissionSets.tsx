import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, EmptyState, ErrorState } from '@/ds';
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
 * THE LAYOUT IS THE MODULE'S, NOT THIS SCREEN'S. Every Admin page is
 * `.panel .panelWide` → `.head` (eyebrow / h2 / sub) → content. The first version of this screen
 * skipped the wrapper entirely, so it rendered with no heading, no page padding, and a card grid
 * squeezed to whatever width the bare content happened to take.
 *
 * `.sub` is body copy. `.noticeNote` is a bordered, accent-tinted CALLOUT — using it for captions
 * turns a page into a stack of banners, which is exactly what happened here.
 *
 * ONE snapshot GET holds the screen; every mutation PATCHes its own row and folds the returned set
 * back into state, so nothing re-fetches on a keystroke and no control can be left showing a value
 * the server rejected.
 */
export function PermissionSets() {
  const [snapshot, setSnapshot] = useState<PermissionSetSnapshot | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

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
        ? { ...prev, sets: prev.sets.map((row) => (row.id === next.id ? { ...row, ...next } : row)) }
        : prev,
    );
  }, []);

  const open = useMemo(
    () => snapshot?.sets.find((set) => set.id === openId) ?? null,
    [snapshot, openId],
  );

  async function create(): Promise<void> {
    const name = newName.trim();
    if (!name) {
      // Answer the click rather than swallowing it.
      setNameError('Give the set a name first — this is what admins pick it by when assigning.');
      nameRef.current?.focus();
      return;
    }
    setNameError('');
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

  const header = (
    <div className={s.head}>
      <div>
        <div className={s.eyebrow}>Access &amp; RBAC</div>
        <h2 className={s.h2}>Permission Sets</h2>
        <p className={s.sub}>
          A named grant, authored once and assigned to many people. Sets are additive — they union
          with the profile, role and per-user layers and can only widen access, never narrow it.
        </p>
      </div>
    </div>
  );

  if (error) {
    /**
     * WHAT HAPPENED and WHAT TO DO. The realistic failure is code reaching an environment ahead of
     * its migration, and the server names that case, so the description is the operator's next move
     * rather than an apology. Retry stays available because the fix happens outside the browser.
     */
    const notMigrated = error.code === 'PERMISSION_SETS_NOT_MIGRATED';
    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        {header}
        <ErrorState
          title={
            notMigrated
              ? 'Permission sets are not set up on this environment'
              : 'Could not load permission sets'
          }
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
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        {header}
        {/* One loading affordance for this region — the skeleton owns the first paint, nothing else. */}
        <div className={s.profileGrid} aria-busy="true">
          <span className={s.srOnly} role="status">
            Loading permission sets…
          </span>
          <div className={s.skelCard} />
          <div className={s.skelCard} />
        </div>
      </div>
    );
  }

  if (open) {
    const assignees = snapshot.assignments.filter((a) => a.permissionSetId === open.id);
    const assignedIds = new Set(assignees.map((a) => a.zohoUserId));

    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        <div className={s.head}>
          <div>
            <button type="button" className={s.linkBtn} onClick={() => setOpenId(null)}>
              ← All permission sets
            </button>
            <h2 className={s.h2} style={{ marginTop: 'var(--space-2)' }}>
              {open.name}
            </h2>
            <p className={s.sub}>
              {open.active ? 'Active' : 'Inactive — grants nothing while switched off'} ·{' '}
              {countLabel(open.allowedMytrions.length, 'Mytrion')} ·{' '}
              {countLabel(assignees.length, 'assignee')}
            </p>
          </div>
          <div className={s.profileActions}>
            <button type="button" className={s.ghostBtn} onClick={() => void toggleActive(open)}>
              {open.active ? 'Deactivate' : 'Activate'}
            </button>
            <button type="button" className={s.dangerBtn} onClick={() => void remove(open)}>
              Delete
            </button>
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>Grants</span>
          </div>
          <div className={s.profileCardBody}>
            <PermissionSetEditor set={open} onChanged={merge} />
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>
              Assigned to <span className={s.count}>{assignees.length}</span>
            </span>
          </div>
          <div className={s.profileCardBody}>
            {assignees.length === 0 ? (
              <p className={s.sub} style={{ margin: 0 }}>
                Nobody yet — a set has no effect until it is assigned to someone.
              </p>
            ) : (
              <div className={s.profileChipGrid}>
                {assignees.map((a) => (
                  <button
                    key={a.zohoUserId}
                    type="button"
                    className={`${s.filterChip} ${s.filterChipOn}`}
                    title={`Remove ${a.userName ?? a.zohoUserId}`}
                    onClick={() => void unassign(open.id, a.zohoUserId)}
                  >
                    <span aria-hidden="true" style={{ display: 'inline-block', width: '1.05em' }}>
                      ✕
                    </span>
                    {a.userName ?? a.zohoUserId}
                  </button>
                ))}
              </div>
            )}

            <div className={s.field}>
              <span className={s.fieldLabel}>Add someone</span>
              {/* The roster carries every ACTIVE Zoho worker, so an admin can assign someone who has
                  never had an access row of any kind. */}
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      {header}

      {/*
        A real form, not a bare input beside a button that silently disables itself.
        The first version disabled Create until the field had text and said nothing about why, so an
        empty field plus a dim button reads as "this screen is broken" — which is exactly how it was
        reported. The button now always submits; an empty name focuses the field and says what it
        wants, so the failure is answerable instead of silent.
      */}
      <form
        className={s.createRow}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {/* The controls align on the INPUT's baseline; the message sits below the whole row. Putting
            it inside the field made the field taller and pushed Create out of line with the box it
            submits — the validation itself broke the layout it was complaining about. */}
        <div className={s.createRowControls}>
          <label className={s.psField} htmlFor="ps-name">
            <span className={s.fieldLabel}>New permission set</span>
            <input
              id="ps-name"
              ref={nameRef}
              className={s.input}
              placeholder="e.g. Billing — Read Only"
              value={newName}
              aria-describedby={nameError ? 'ps-name-error' : undefined}
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => {
                setNewName(e.target.value);
                if (nameError) setNameError('');
              }}
            />
          </label>
          <button type="submit" className={s.primaryBtn} disabled={busy}>
            {busy ? 'Creating…' : 'Create set'}
          </button>
        </div>
        {nameError && (
          <span id="ps-name-error" className={s.inlineError} role="alert">
            {nameError}
          </span>
        )}
      </form>

      {snapshot.sets.length === 0 ? (
        /* The design system's empty state: says what happened AND what to try next, with the one
           move that fixes it. `.none` was a bare centred paragraph stretched to the full page. */
        <EmptyState
          icon="shield"
          title="No permission sets yet"
          description="Name one above — “Billing — Read Only”, “Manager — Sales desk only” — then choose the Mytrions and tabs it grants and assign it to people."
          primaryAction={
            <Button variant="primary" onClick={() => nameRef.current?.focus()}>
              Name your first set
            </Button>
          }
        />
      ) : (
        <div className={s.profileGrid}>
          {snapshot.sets.map((set) => {
            const scoped = Object.keys(set.tabGrants).length;
            return (
              <div key={set.id} className={s.card}>
                <div className={s.cardHead}>
                  <span className={s.cardTitle}>{set.name}</span>
                  {!set.active && <span className={`${s.pill} ${s.pillNeutral}`}>Inactive</span>}
                </div>
                <div className={s.profileCardBody}>
                  <p className={s.sub} style={{ margin: 0 }}>
                    {set.allowedMytrions.length === 0
                      ? 'No Mytrions yet'
                      : countLabel(set.allowedMytrions.length, 'Mytrion')}
                    {scoped > 0 ? `, ${scoped} tab-scoped` : ''} ·{' '}
                    {countLabel(set.assigneeCount, 'assignee')}
                  </p>
                  <div className={s.profileActions}>
                    <button type="button" className={s.miniBtn} onClick={() => setOpenId(set.id)}>
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "1 Mytrion" / "3 Mytrions" — never the "1 Mytrion(s)" that shipped in the first version. */
function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
