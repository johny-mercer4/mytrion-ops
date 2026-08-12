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
import { MYTRIONS } from '../../access/mytrions.config';
import { MytrionGlyph } from '../../components/icons';
import { PermissionSetEditor } from './PermissionSetEditor';
import { PermissionSetAssignees } from './PermissionSetAssignees';
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
  /** The one person currently being added or removed, so only their row shows a pending state. */
  const [assigneeBusy, setAssigneeBusy] = useState<string | null>(null);

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

  async function assign(
    setId: string,
    entry: { zohoUserId: string; name: string | null; email: string | null },
  ): Promise<void> {
    setAssigneeBusy(entry.zohoUserId);
    try {
      await assignPermissionSet(setId, {
        zohoUserId: entry.zohoUserId,
        userName: entry.name,
        email: entry.email,
      });
      await load();
    } catch (err) {
      adminToast.error('Could not assign', err instanceof Error ? err.message : undefined);
    } finally {
      setAssigneeBusy(null);
    }
  }

  async function unassign(setId: string, zohoUserId: string): Promise<void> {
    setAssigneeBusy(zohoUserId);
    try {
      await unassignPermissionSet(setId, zohoUserId);
      await load();
    } catch (err) {
      adminToast.error('Could not unassign', err instanceof Error ? err.message : undefined);
    } finally {
      setAssigneeBusy(null);
    }
  }

  /** Level 1 beats level 2 beats level 3 — the switch that makes a scope actually narrow. */
  async function toggleOverride(set: PermissionSet): Promise<void> {
    try {
      merge(await updatePermissionSet(set.id, { override: !set.override }));
      adminToast.success(
        set.override ? 'Set is additive again' : 'Set now overrides lower layers',
        set.name,
      );
    } catch (err) {
      adminToast.error('Could not update', err instanceof Error ? err.message : undefined);
    }
  }

  /*
    Rendered while loading as well as when loaded. It needs nothing from the snapshot, and holding
    its space stops the card grid jumping down by the height of the whole form the moment data
    arrives — which is the arrival shift a skeleton exists to prevent.

    A real form, not a bare input beside a button that silently disables itself. The first version
    disabled Create until the field had text and said nothing about why, so an empty field plus a dim
    button reads as "this screen is broken" — which is exactly how it was reported. The button now
    always submits; an empty name focuses the field and says what it wants, so the failure is
    answerable instead of silent.
  */
  const createForm = (
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
  );

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
        {createForm}
        {/* One loading affordance for this region — the skeleton owns the first paint, nothing else.
            Same grid, same card chrome, same line positions as the loaded list, so arrival swaps
            text in rather than replacing one shape with another. */}
        <div className={`${s.profileGrid} ${s.psGrid}`} aria-busy="true">
          <span className={s.srOnly} role="status">
            Loading permission sets…
          </span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={s.card} aria-hidden="true">
              <div className={s.cardHead}>
                <span className={`${s.psSkelRow} ${s.psSkelTitle}`} />
              </div>
              <div className={s.profileCardBody}>
                <span className={`${s.psSkelRow} ${s.psSkelText}`} />
                <span className={`${s.psSkelRow} ${s.psSkelBtn}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (open) {
    const assignees = snapshot.assignments.filter((a) => a.permissionSetId === open.id);

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
              {open.override ? ' · Overrides lower layers' : ''}
            </p>
          </div>
          {/* Deactivate and Delete sat flush against each other — two buttons of very different
              consequence reading as one control. `.psHeadActions` is the same row with real space
              between them. */}
          <div className={s.psHeadActions}>
            <button type="button" className={s.ghostBtn} onClick={() => void toggleActive(open)}>
              {open.active ? 'Deactivate' : 'Activate'}
            </button>
            <button type="button" className={s.dangerBtn} onClick={() => void remove(open)}>
              Delete
            </button>
          </div>
        </div>

        {/* The editor owns its own card — the sticky save bar has to sit outside it. */}
        <PermissionSetEditor
          set={open}
          onSaved={(next) => {
            merge(next);
            // Back to the list: saving is the end of the task, and staying on a form with no unsaved
            // changes left gives no signal that anything happened.
            setOpenId(null);
          }}
        />

        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>Precedence</span>
          </div>
          <div className={s.profileCardBody}>
            <label className={s.accessCheckRow}>
              <input
                type="checkbox"
                checked={open.override}
                onChange={() => void toggleOverride(open)}
              />
              <span>Override — this set replaces lower layers instead of adding to them</span>
            </label>
            <p className={s.fieldHint}>
              Normally every layer adds up, so a profile default granting Billing unscoped defeats
              this set&rsquo;s tab scope. With override on, the order is: <strong>1.</strong> this
              permission set, <strong>2.</strong> the per-user override, <strong>3.</strong> role and
              profile defaults — and only what this set grants survives. A Mytrion denied on the user
              record stays denied either way.
            </p>
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>
              Assigned to <span className={s.count}>{assignees.length}</span>
            </span>
          </div>
          <div className={s.profileCardBody}>
            {/* The roster carries every ACTIVE Zoho worker, so an admin can assign someone who has
                never had an access row of any kind. */}
            <PermissionSetAssignees
              assignees={assignees}
              roster={snapshot.roster}
              busyId={assigneeBusy}
              onAdd={(entry) =>
                void assign(open.id, {
                  zohoUserId: entry.zohoUserId,
                  name: entry.name,
                  email: entry.email,
                })
              }
              onRemove={(a) => void unassign(open.id, a.zohoUserId)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      {header}

      {createForm}

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
        <div className={`${s.profileGrid} ${s.psGrid}`}>
          {snapshot.sets.map((set) => {
            const scoped = Object.keys(set.tabGrants).length;
            return (
              <div key={set.id} className={s.card}>
                <div className={s.cardHead}>
                  <span className={s.cardTitle}>{set.name}</span>
                  {set.override && <span className={`${s.pill} ${s.pillInfo}`}>Override</span>}
                  {!set.active && <span className={`${s.pill} ${s.pillNeutral}`}>Inactive</span>}
                </div>
                <div className={s.profileCardBody}>
                  {/* Which workspaces, at a glance — the department marks are how these are told
                      apart everywhere else in the app, and a count alone made every card identical. */}
                  {set.allowedMytrions.length > 0 && (
                    <div className={s.psGlyphRow}>
                      {set.allowedMytrions.map((id) => (
                        <span
                          key={id}
                          className={s.psGlyphChip}
                          title={MYTRIONS[id]?.title ?? id}
                          data-mytrion={id}
                        >
                          <MytrionGlyph name={MYTRIONS[id]?.icon ?? id} size={14} />
                          {MYTRIONS[id]?.tag ?? id}
                        </span>
                      ))}
                    </div>
                  )}
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
