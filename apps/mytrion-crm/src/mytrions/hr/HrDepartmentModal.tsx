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
 */
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import {
  createHrDepartment,
  updateHrDepartment,
  type HrDepartmentDto,
  type HrDepartmentWriteInput,
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
import { HrRichText } from './HrRichText';
import { radioGroupKeyDown, rovingTabIndex, useModalFocus } from './useModalFocus';

export type DepartmentModalMode =
  | { kind: 'create'; parentName?: string | null }
  | { kind: 'edit'; department: HrDepartmentDto };

const EMPTY: HrDepartmentWriteInput = {
  name: '',
  code: '',
  leadName: '',
  parentName: '',
  description: '',
  icon: null,
  iconColor: null,
};

function toForm(d: HrDepartmentDto): HrDepartmentWriteInput {
  return {
    name: d.name,
    code: d.code ?? '',
    leadName: d.leadName ?? '',
    parentName: d.parentName ?? '',
    description: d.description ?? '',
    icon: d.icon,
    iconColor: d.iconColor,
  };
}

function normalize(form: HrDepartmentWriteInput): HrDepartmentWriteInput {
  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  };
  return {
    name: form.name.trim(),
    code: trimOrNull(form.code),
    leadName: trimOrNull(form.leadName),
    parentName: trimOrNull(form.parentName),
    description: trimOrNull(form.description),
    icon: trimOrNull(form.icon),
    iconColor: trimOrNull(form.iconColor),
    // `mailAlias` is deliberately not sent. The column still exists and the Zoho migration still
    // populates it; the UI simply stopped surfacing it, and an omitted key leaves it untouched.
  };
}

export function HrDepartmentModal({
  mode,
  admin,
  departments,
  headcount,
  onClose,
  onSaved,
  onDelete,
}: {
  mode: DepartmentModalMode;
  admin: boolean;
  /** Every department, for the parent picker (and to keep a department off its own parent list). */
  departments: readonly HrDepartmentDto[];
  headcount: { total: number; active: number } | undefined;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: (d: HrDepartmentDto) => void;
}) {
  const [form, setForm] = useState<HrDepartmentWriteInput>(
    mode.kind === 'edit'
      ? toForm(mode.department)
      : { ...EMPTY, parentName: mode.parentName ?? '' },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  const tone = departmentTone(form.iconColor);
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
      else await updateHrDepartment(mode.department.id, body);
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
            <p>
              {headcount ? (
                <>
                  {headcount.active} active
                  {headcount.total !== headcount.active ? ` · ${headcount.total} total` : ''}
                </>
              ) : (
                'No one assigned yet'
              )}
              {mode.kind === 'edit' && mode.department.parentName
                ? ` · under ${mode.department.parentName}`
                : ''}
            </p>
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
                  {form.leadName || '—'}
                  {/* The old table showed this in its Lead column; the cards had dropped it entirely. */}
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
                  <input
                    value={form.leadName ?? ''}
                    onChange={(e) => set('leadName', e.target.value)}
                  />
                </label>
                <label>
                  Parent department
                  <select
                    value={form.parentName ?? ''}
                    onChange={(e) => set('parentName', e.target.value)}
                  >
                    <option value="">— (top level)</option>
                    {parentOptions.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
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

            {error ? (
              <p className="hr-banner-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="hr-modal-actions">
              {saving ? <HrBusy label={mode.kind === 'create' ? 'Creating…' : 'Saving…'} /> : null}
              {mode.kind === 'edit' && onDelete ? (
                <button
                  type="button"
                  className="hr-btn hr-btn-danger"
                  disabled={saving}
                  onClick={() => onDelete(mode.department)}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              ) : null}
              <button type="button" className="hr-btn" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>
                {mode.kind === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
