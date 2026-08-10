/**
 * A department, opened from its card: editable in place for admins, read-only for everyone else.
 *
 * ONE MODAL, NOT TWO. Employees deliberately separate "look at a colleague" from "edit a record"
 * because looking is the common case there and the form is long. A department is the opposite — there
 * are ~20 of them, the fields are few, and the reason anyone opens one is to read or fix its purpose.
 * So the modal IS the editor, and a non-admin simply gets the same layout without inputs.
 *
 * The icon and colour pickers write a NAME and a TOKEN, never a glyph or a hex value: see
 * `departmentAppearance.tsx` for why that is what makes them safe to render.
 *
 * Lead is an employee lookup (`leadEmployeeId`), not free text — the people list below is the same
 * directory, so adding/removing members and picking a lead share one source of truth.
 */
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import {
  createHrDepartment,
  updateHrDepartment,
  type HrDepartmentDto,
  type HrDepartmentPatchInput,
  type HrDepartmentWriteInput,
  type HrEmployeeDto,
} from '../../api/hr';
import { Markdown } from '../../features/chat/Markdown';
import {
  DEPARTMENT_ICON_LABELS,
  DEPARTMENT_ICON_NAMES,
  DEPARTMENT_TONES,
  DEPARTMENT_TONE_NAMES,
  departmentIcon,
  departmentTone,
} from './departmentAppearance';
import { HrBusy } from './HrBits';
import { HrSelect } from './HrSelect';
import { HrDepartmentMembers } from './HrDepartmentMembers';
import { HrRichText } from './HrRichText';
import { isActiveStatus } from './hrData';
import { radioGroupKeyDown, rovingTabIndex, useModalFocus } from './useModalFocus';

export type DepartmentModalMode =
  | { kind: 'create'; parentName?: string | null }
  | { kind: 'edit'; department: HrDepartmentDto };

/**
 * Value of the "(not linked)" hint in the Lead picker — deliberately NOT ''.
 *
 * Sharing '' with the "—" option meant a controlled select matched the first of the two and the lead's
 * name was never the one on display, so a department whose card reads "Lead · Jane Doe" looked leadless
 * in the editor. The sentinel cannot reach `form` (the option is disabled) and, being equal to no
 * normalized value, it is "unchanged" to the diff below.
 */
const UNLINKED_LEAD = '__unlinked';

const EMPTY: HrDepartmentWriteInput = {
  name: '',
  code: '',
  leadEmployeeId: '',
  parentName: '',
  description: '',
  icon: null,
  iconColor: null,
};

function toForm(d: HrDepartmentDto): HrDepartmentWriteInput {
  return {
    name: d.name,
    code: d.code ?? '',
    leadEmployeeId: d.leadEmployeeId ?? '',
    parentName: d.parentName ?? '',
    description: d.description ?? '',
    icon: d.icon,
    iconColor: d.iconColor,
  };
}

/**
 * normalize()'s output: every editable key PRESENT (null for empty), which is what lets the diff below
 * compare two forms pairwise instead of guessing what a missing key meant.
 */
type NormalizedForm = {
  name: string;
  code: string | null;
  leadEmployeeId: string | null;
  parentName: string | null;
  description: string | null;
  icon: string | null;
  iconColor: string | null;
};

function normalize(form: HrDepartmentWriteInput): NormalizedForm {
  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  };
  return {
    name: form.name.trim(),
    code: trimOrNull(form.code),
    leadEmployeeId: trimOrNull(form.leadEmployeeId),
    parentName: trimOrNull(form.parentName),
    description: trimOrNull(form.description),
    icon: trimOrNull(form.icon),
    iconColor: trimOrNull(form.iconColor),
    // `mailAlias` is deliberately not sent. The column still exists and the Zoho migration still
    // populates it; the UI simply stopped surfacing it, and an omitted key leaves it untouched.
  };
}

/**
 * An edit saves a DIFF of the normalized form, never the whole of it.
 *
 * `leadEmployeeId` is authoritative on the backend: present-and-null resolves to an empty lead and wipes
 * leadName / leadEmail / leadZohoId with it. Every department the Zoho sync owns is in exactly that shape
 * — a leadName with no linked employee — so sending the full form destroyed the lead of a migrated
 * department on a save that only changed its colour. An untouched picker now sends nothing; an explicit
 * pick of "—" over a linked lead is a real change and still clears it.
 */
function changedFields(before: NormalizedForm, after: NormalizedForm): HrDepartmentPatchInput {
  const patch: HrDepartmentPatchInput = {};
  if (after.name !== before.name) patch.name = after.name;
  if (after.code !== before.code) patch.code = after.code;
  if (after.leadEmployeeId !== before.leadEmployeeId) patch.leadEmployeeId = after.leadEmployeeId;
  if (after.parentName !== before.parentName) patch.parentName = after.parentName;
  if (after.description !== before.description) patch.description = after.description;
  if (after.icon !== before.icon) patch.icon = after.icon;
  if (after.iconColor !== before.iconColor) patch.iconColor = after.iconColor;
  return patch;
}

const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

export function HrDepartmentModal({
  mode,
  admin,
  departments,
  employees,
  headcount,
  onClose,
  onSaved,
  onDirectoryChanged,
  onDelete,
  deleting = false,
  deleteError = '',
}: {
  mode: DepartmentModalMode;
  admin: boolean;
  /** Every department, for the parent picker (and to keep a department off its own parent list). */
  departments: readonly HrDepartmentDto[];
  /** Directory — lead picker + members list. Already cached by the tab. */
  employees: readonly HrEmployeeDto[];
  headcount: { total: number; active: number } | undefined;
  onClose: () => void;
  onSaved: () => void;
  /** Members add/remove mutated employees — refresh the directory without closing the modal. */
  onDirectoryChanged: () => void;
  onDelete?: (d: HrDepartmentDto) => void;
  /** Delete runs on the tab (it owns the list), so its progress and failure have to come back in. */
  deleting?: boolean;
  deleteError?: string;
}) {
  const [form, setForm] = useState<HrDepartmentWriteInput>(
    mode.kind === 'edit'
      ? toForm(mode.department)
      : { ...EMPTY, parentName: mode.parentName ?? '' },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /**
   * The admin picked "—" in this session — an INTENT, which is why it cannot be derived from the form.
   *
   * A Zoho-migrated row (leadName, no leadEmployeeId) and a just-cleared one look identical from `form`
   * alone: both have an empty `leadEmployeeId`. Without this flag the picker snapped back to the disabled
   * "(not linked)" option the moment "—" was chosen, and the null→null diff sent nothing, so a departed
   * lead's name was uncorrectable from the UI.
   */
  const [leadCleared, setLeadCleared] = useState(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  /**
   * Parents this department may actually have: everything except itself and its own DESCENDANTS.
   *
   * Excluding only itself let the picker offer a sub-department as the parent, which is a cycle — the
   * backend now refuses it, but offering a choice that always errors is a worse experience than not
   * offering it. Walking down from this department is also cheap: there are ~20 rows.
   */
  const parentOptions = useMemo(() => {
    const blocked = new Set<string>();
    if (mode.kind === 'edit') {
      blocked.add(mode.department.id);
      // Breadth-first over children; the `blocked` set doubles as the visited guard, so a cycle already
      // present in the data cannot loop here.
      const queue = [mode.department.id];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const d of departments) {
          if (d.parentId === id && !blocked.has(d.id)) {
            blocked.add(d.id);
            queue.push(d.id);
          }
        }
      }
    }
    return departments
      .filter((d) => !blocked.has(d.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, mode]);

  const leadOptions = useMemo(
    () =>
      employees
        .filter((e) => isActiveStatus(e.status))
        .slice()
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [employees],
  );

  const leadLabel = useMemo(() => {
    const id = (form.leadEmployeeId ?? '').trim();
    if (id) {
      const hit = employees.find((e) => e.id === id);
      if (hit) return displayName(hit);
    }
    if (mode.kind === 'edit') return mode.department.leadName || '—';
    return '—';
  }, [form.leadEmployeeId, employees, mode]);

  /**
   * The department has a lead NAME but no linked employee — the shape every Zoho-migrated row is in.
   *
   * Keyed on the stored row, not only on the empty form field: a department whose lead IS linked and
   * whom the admin has just set to "—" must read "—", not the name they just removed. `leadCleared` is
   * the same rule for the migrated case, where the stored row cannot tell the two apart.
   */
  const unresolvedLead =
    mode.kind === 'edit' &&
    !leadCleared &&
    !mode.department.leadEmployeeId &&
    !(form.leadEmployeeId ?? '').trim() &&
    Boolean(mode.department.leadName);

  // Seeded so an existing department keeps the same auto-colour the card and canvas already show.
  const tone = departmentTone(form.iconColor, mode.kind === 'edit' ? mode.department.id : null);
  const Icon = departmentIcon(form.icon);
  const dialogRef = useModalFocus<HTMLDivElement>();
  const iconIndex = DEPARTMENT_ICON_NAMES.indexOf(form.icon ?? '');
  const toneIndex = DEPARTMENT_TONE_NAMES.indexOf(form.iconColor ?? '');

  const onSave = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    if (!admin || saving) return;
    const body = normalize(form);
    if (!body.name) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (mode.kind === 'create') await createHrDepartment(body);
      else {
        const patch = changedFields(normalize(toForm(mode.department)), body);
        // A migrated lead is null→null to the diff, so an explicit "—" over one has to be added back by
        // hand. `leadEmployeeId` present-and-null is what makes the repo resolve an empty lead and wipe
        // leadName / leadEmail / leadZohoId with it — no separate leadName key needed, and the untouched
        // picker still sends nothing.
        if (leadCleared && !body.leadEmployeeId) patch.leadEmployeeId = null;
        await updateHrDepartment(mode.department.id, patch);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof HrDepartmentWriteInput>(
    key: K,
    v: HrDepartmentWriteInput[K],
  ): void => {
    setForm((f) => ({ ...f, [key]: v }));
  };

  const title = mode.kind === 'create' ? 'New department' : form.name || mode.department.name;

  const membersBlock =
    mode.kind === 'edit' ? (
      <HrDepartmentMembers
        departmentId={mode.department.id}
        departmentName={form.name || mode.department.name}
        employees={employees}
        admin={admin}
        onChanged={onDirectoryChanged}
      />
    ) : null;

  return (
    <div
      className="hr-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="hr-modal hr-deptm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hr-deptm-title"
        style={{ ['--dc' as string]: tone } as CSSProperties}
        ref={dialogRef}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="hr-deptm-head">
          <span className="hr-deptc-glyph" aria-hidden="true">
            <Icon size={22} />
          </span>
          <div className="hr-deptm-ident">
            <h2 id="hr-deptm-title">{title}</h2>
            {/* Same three states as the card: an unloaded directory (`undefined`) is not an empty
                department. A department being created has no headcount at all, so it gets no line —
                not a line claiming nobody is in it. */}
            {mode.kind === 'edit' ? (
              <p>
                {headcount === undefined ? (
                  <span title="Headcount still loading">—</span>
                ) : headcount.total === 0 ? (
                  'No one assigned yet'
                ) : (
                  <>
                    {headcount.active} active
                    {headcount.total !== headcount.active ? ` · ${headcount.total} total` : ''}
                  </>
                )}
                {mode.department.parentName ? ` · under ${mode.department.parentName}` : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="hr-icon-btn"
            aria-label="Close"
            disabled={saving}
            /* Skipped for INITIAL focus only (see useModalFocus) — still in the Tab cycle. */
            data-focus-skip=""
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {!admin ? (
          <div className="hr-deptm-read">
            <dl className="hr-empd-grid">
              <div className="hr-empd-field">
                <dt>Code</dt>
                <dd className="hr-mono">{form.code || '—'}</dd>
              </div>
              <div className="hr-empd-field">
                <dt>Lead</dt>
                <dd>
                  {leadLabel}
                  {mode.kind === 'edit' && mode.department.leadEmail ? (
                    <div className="hr-mono hr-empd-sub">{mode.department.leadEmail}</div>
                  ) : null}
                </dd>
              </div>
              <div className="hr-empd-field">
                <dt>Parent</dt>
                <dd>{form.parentName || '—'}</dd>
              </div>
            </dl>
            <section className="hr-deptm-about">
              <h3>About this department</h3>
              {form.description ? (
                <Markdown text={form.description} />
              ) : (
                <p className="hr-rt-empty">No description yet.</p>
              )}
            </section>
            {membersBlock}
          </div>
        ) : (
          <form className={`hr-form${saving ? ' is-saving' : ''}`} onSubmit={(ev) => void onSave(ev)}>
            <fieldset className="hr-fieldset" disabled={saving}>
              <div className="hr-form-grid">
                <label>
                  Name *
                  <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
                </label>
                <label>
                  Code
                  <input value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} />
                </label>
                <label>
                  Lead
                  <HrSelect
                    label="Lead"
                    value={unresolvedLead ? UNLINKED_LEAD : (form.leadEmployeeId ?? '')}
                    onChange={(next) => {
                      set('leadEmployeeId', next || null);
                      setLeadCleared(!next);
                    }}
                    options={[
                      { value: '', label: '—' },
                      // A `disabled` entry still DISPLAYS as the current value, which is the whole
                      // point: the field has to name the lead it is about to keep or replace, even
                      // though that person has no employee row to select.
                      ...(unresolvedLead
                        ? [
                            {
                              value: UNLINKED_LEAD,
                              label: `${mode.kind === 'edit' ? mode.department.leadName : ''} (not linked)`,
                              disabled: true,
                            },
                          ]
                        : []),
                      ...leadOptions.map((e) => ({
                        value: e.id,
                        label: `${displayName(e)}${e.designation ? ` · ${e.designation}` : ''}`,
                      })),
                    ]}
                  />
                </label>
                <label>
                  Parent department
                  <HrSelect
                    label="Parent department"
                    value={form.parentName ?? ''}
                    onChange={(next) => set('parentName', next)}
                    options={[
                      { value: '', label: '— (top level)' },
                      // The value is the NAME, not the id: `parentName` is what the form submits and
                      // what `patch.parentName` diffs against. Keying it on `d.id` would write an id
                      // into a name column and silently re-parent nothing.
                      ...parentOptions.map((d) => ({ value: d.name, label: d.name })),
                    ]}
                  />
                </label>
              </div>

              <div className="hr-field-block">
                <span className="hr-field-label">Icon</span>
                <div className="hr-iconpick" role="radiogroup" aria-label="Department icon">
                  {DEPARTMENT_ICON_NAMES.map((name, i) => {
                    const Glyph = departmentIcon(name);
                    const on = form.icon === name;
                    // A human label, not the raw lucide component name — "Building2" tells a
                    // screen-reader user nothing about the choice they are making.
                    const label = DEPARTMENT_ICON_LABELS[name] ?? name;
                    return (
                      <button
                        key={name}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={label}
                        title={label}
                        className="hr-iconpick-cell"
                        tabIndex={rovingTabIndex(on, i === 0, iconIndex >= 0)}
                        onKeyDown={radioGroupKeyDown(DEPARTMENT_ICON_NAMES.length, i, (next) =>
                          set('icon', DEPARTMENT_ICON_NAMES[next] ?? null),
                        )}
                        onClick={() => set('icon', on ? null : name)}
                      >
                        <Glyph size={17} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="hr-field-block">
                <span className="hr-field-label">Colour</span>
                {/* A token per swatch, so a department's colour always comes from the Horizon palette
                    and stays legible in both the light and dark themes. */}
                <div className="hr-tonepick" role="radiogroup" aria-label="Department colour">
                  {DEPARTMENT_TONE_NAMES.map((token, i) => {
                    const on = form.iconColor === token;
                    return (
                      <button
                        key={token}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={DEPARTMENT_TONES[token]!.label}
                        title={DEPARTMENT_TONES[token]!.label}
                        className="hr-tonepick-cell"
                        style={
                          { ['--sw' as string]: DEPARTMENT_TONES[token]!.cssVar } as CSSProperties
                        }
                        tabIndex={rovingTabIndex(on, i === 0, toneIndex >= 0)}
                        onKeyDown={radioGroupKeyDown(DEPARTMENT_TONE_NAMES.length, i, (next) =>
                          set('iconColor', DEPARTMENT_TONE_NAMES[next] ?? null),
                        )}
                        onClick={() => set('iconColor', on ? null : token)}
                      >
                        {on ? <Check size={13} /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="hr-field-block">
                <label className="hr-field-label" htmlFor="hr-dept-desc">
                  Description
                </label>
                <p className="hr-field-hint">
                  What this department is responsible for. Shown on the card and on the org canvas.
                </p>
                <HrRichText
                  id="hr-dept-desc"
                  value={form.description ?? ''}
                  onChange={(v) => set('description', v)}
                  disabled={saving}
                  placeholder="e.g. **Owns** carrier onboarding, from first contact to first fuelling."
                />
              </div>
            </fieldset>

            {membersBlock}

            {/* A failed delete keeps this modal open, so its error has to render HERE — on the tab
                behind the backdrop it is invisible and the click reads as having done nothing. */}
            {error || deleteError ? (
              <p className="hr-banner-error" role="alert">
                {error || deleteError}
              </p>
            ) : null}

            <div className="hr-modal-actions">
              {saving ? <HrBusy label={mode.kind === 'create' ? 'Creating…' : 'Saving…'} /> : null}
              {deleting ? <HrBusy label="Deleting…" /> : null}
              {mode.kind === 'edit' && onDelete ? (
                <button
                  type="button"
                  className="hr-btn hr-btn-danger"
                  disabled={saving || deleting}
                  onClick={() => onDelete(mode.department)}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              ) : null}
              <button type="button" className="hr-btn" onClick={onClose} disabled={saving || deleting}>
                Cancel
              </button>
              <button type="submit" className="hr-btn hr-btn-primary" disabled={saving || deleting}>
                {mode.kind === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
