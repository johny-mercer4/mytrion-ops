/**
 * The admin create / edit form for one employee.
 *
 * Split out of `HrEmployees.tsx`, which was a 520-line tab holding the fetch, the filters, the grid,
 * the detail modal AND this form. Nothing about a form field belongs in the same file as a cache key.
 *
 * SAVE FEEDBACK. A save disables the fields, puts a spinner in the actions row and leaves the values
 * visible. Earlier this was a single `Saving…` word inside the submit button: on a slow connection the
 * form looked live, so a second click (or an Escape) during the write was easy — and the backdrop click
 * still closed the modal mid-request, which meant the user never learned whether the save landed.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import {
  createHrEmployee,
  updateHrEmployee,
  type HrDepartmentDto,
  type HrEmployeeDto,
  type HrEmployeeWriteInput,
} from '../../api/hr';
import { HrBusy } from './HrBits';
import { useModalFocus } from './useModalFocus';

/**
 * `create` carries optional presets so the org canvas's "+" opens a form that is already in the right
 * place: adding under a department preselects it, adding a direct report preselects the manager (and
 * their department, since a report almost always sits in it).
 */
export type EmployeeFormMode =
  | { kind: 'create'; presetDepartmentId?: string; presetManagerId?: string }
  | { kind: 'edit'; employee: HrEmployeeDto };

const EMPTY_FORM: HrEmployeeWriteInput = {
  firstName: '',
  lastName: '',
  employeeId: '',
  email: '',
  departmentId: '',
  designation: '',
  telegramUsername: '',
  location: '',
  status: 'Active',
  role: '',
  dateOfJoining: '',
  mobile: '',
  reportingToEmployeeId: '',
};

const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

function toForm(e: HrEmployeeDto): HrEmployeeWriteInput {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    employeeId: e.employeeId ?? '',
    email: e.email ?? '',
    departmentId: e.departmentId ?? '',
    designation: e.designation ?? '',
    telegramUsername: e.telegramUsername ?? '',
    location: e.location ?? '',
    status: e.status || 'Active',
    role: e.role ?? '',
    dateOfJoining: e.dateOfJoining ?? '',
    mobile: e.mobile ?? '',
    reportingToEmployeeId: e.reportingToEmployeeId ?? '',
  };
}

/**
 * Build the patch body.
 *
 * `reportingToEmployeeId` is included ONLY when the user actually changed the picker. That is not a
 * micro-optimisation — it is a correctness requirement. The id link is resolved from the `reporting_to`
 * name and stays null whenever that name is ambiguous (two people share it) or unmatched, so plenty of
 * real rows have a manager NAME and no id. Those cannot be represented in a picker, so the field seeds
 * to "—" — and sending that back meant editing someone's mobile number silently erased their manager,
 * because the backend treats an explicit null as "no manager" and clears the name with it.
 */
function normalizeWrite(
  form: HrEmployeeWriteInput,
  initialManagerId: string,
): HrEmployeeWriteInput {
  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  };
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    employeeId: trimOrNull(form.employeeId),
    email: trimOrNull(form.email),
    departmentId: trimOrNull(form.departmentId),
    department: null,
    designation: trimOrNull(form.designation),
    telegramUsername: trimOrNull(form.telegramUsername),
    location: trimOrNull(form.location),
    status: (form.status ?? 'Active').trim() || 'Active',
    role: trimOrNull(form.role),
    dateOfJoining: trimOrNull(form.dateOfJoining),
    mobile: trimOrNull(form.mobile),
    // Only the id is sent (the backend resolves `reportingTo` from it), and only if it changed.
    ...((form.reportingToEmployeeId ?? '') !== initialManagerId
      ? { reportingToEmployeeId: trimOrNull(form.reportingToEmployeeId) }
      : {}),
  };
}

export function HrEmployeeForm({
  mode,
  departments,
  designations,
  colleagues,
  onClose,
  onSaved,
}: {
  mode: EmployeeFormMode;
  departments: readonly HrDepartmentDto[];
  designations: readonly string[];
  /** The directory, for the "Reporting to" picker. Already loaded by the tab — not fetched again. */
  colleagues: readonly HrEmployeeDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<HrEmployeeWriteInput>(() =>
    mode.kind === 'edit'
      ? toForm(mode.employee)
      : {
          ...EMPTY_FORM,
          departmentId: mode.presetDepartmentId ?? '',
          reportingToEmployeeId: mode.presetManagerId ?? '',
        },
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  /** The manager id the form opened with — the baseline the patch diffs against. */
  const initialManagerId = useRef(
    mode.kind === 'edit' ? (mode.employee.reportingToEmployeeId ?? '') : (mode.presetManagerId ?? ''),
  ).current;
  /**
   * A manager NAME with no resolved id. Shown as a disabled option so the record does not appear to have
   * no manager at all — otherwise the only honest reading of the form is wrong.
   */
  const dialogRef = useModalFocus<HTMLDivElement>();
  const unresolvedManager =
    mode.kind === 'edit' && !mode.employee.reportingToEmployeeId
      ? (mode.employee.reportingTo ?? '').trim()
      : '';

  /**
   * Managers to offer: everyone except this person (nobody reports to themselves) and except the
   * terminated, who should not be picked up as a new manager. Sorted by name so the list is scannable —
   * the directory arrives active-first, which is the wrong order for a name lookup.
   */
  const managerOptions = useMemo(() => {
    const selfId = mode.kind === 'edit' ? mode.employee.id : null;
    return colleagues
      .filter((c) => c.id !== selfId && c.status.toLowerCase() !== 'terminated')
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );
  }, [colleagues, mode]);

  // Escape closes — but never mid-save, which would hide the outcome of a write already in flight.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const onSave = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    if (saving) return;
    const body = normalizeWrite(form, initialManagerId);
    if (!body.firstName || !body.lastName) {
      setFormError('First and last name are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (mode.kind === 'create') await createHrEmployee(body);
      else await updateHrEmployee(mode.employee.id, body);
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof HrEmployeeWriteInput>(key: K, v: HrEmployeeWriteInput[K]): void => {
    setForm((f) => ({ ...f, [key]: v }));
  };

  return (
    <div
      className="hr-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="hr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hr-emp-form-title"
        ref={dialogRef}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="hr-modal-head">
          <h2 id="hr-emp-form-title">
            {mode.kind === 'create' ? 'Add employee' : `Edit ${displayName(mode.employee)}`}
          </h2>
          <button
            type="button"
            className="hr-icon-btn"
            aria-label="Close"
            disabled={saving}
            data-focus-skip=""
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <form className={`hr-form${saving ? ' is-saving' : ''}`} onSubmit={(ev) => void onSave(ev)}>
          <fieldset className="hr-fieldset" disabled={saving}>
            <div className="hr-form-grid">
              <label>
                First name *
                <input
                  required
                  value={form.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                />
              </label>
              <label>
                Last name *
                <input
                  required
                  value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                />
              </label>
              <label>
                Employee ID
                <input
                  value={form.employeeId ?? ''}
                  onChange={(e) => set('employeeId', e.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => set('email', e.target.value)}
                />
              </label>
              <label>
                Department
                <select
                  value={form.departmentId ?? ''}
                  onChange={(e) => set('departmentId', e.target.value)}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Designation
                {/*
                  A real <select>, not the <datalist> this used to be. A datalist renders as native
                  browser chrome that CSS cannot touch, which is why this one field looked nothing
                  like the inputs around it. The picklist is DISTINCT designations already in the
                  directory, so a plain select is complete; a new title is added by typing it into
                  the "Other designation" field below.
                */}
                <select
                  value={designations.includes(form.designation ?? '') ? (form.designation ?? '') : ''}
                  onChange={(e) => set('designation', e.target.value)}
                >
                  <option value="">—</option>
                  {designations.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Other designation
                <input
                  placeholder="Only if it is not in the list"
                  value={designations.includes(form.designation ?? '') ? '' : (form.designation ?? '')}
                  onChange={(e) => set('designation', e.target.value)}
                />
              </label>
              <label>
                Telegram
                {/* The '@' is a static prefix, so the stored value stays the bare handle no matter
                    whether the user types '@name', 'name' or a t.me link (the API strips those too). */}
                <span className="hr-prefixed">
                  <span aria-hidden="true">@</span>
                  <input
                    value={(form.telegramUsername ?? '').replace(/^@+/, '')}
                    onChange={(e) => set('telegramUsername', e.target.value.replace(/^@+/, ''))}
                    placeholder="username"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </span>
              </label>
              <label>
                Location
                <input value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} />
              </label>
              <label>
                Status
                <select
                  value={form.status ?? 'Active'}
                  onChange={(e) => set('status', e.target.value)}
                >
                  <option value="Active">Active</option>
                  <option value="Terminated">Terminated</option>
                </select>
              </label>
              <label>
                Role
                <input value={form.role ?? ''} onChange={(e) => set('role', e.target.value)} />
              </label>
              <label>
                Date of joining
                <input
                  value={form.dateOfJoining ?? ''}
                  onChange={(e) => set('dateOfJoining', e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label>
                Mobile
                <input value={form.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} />
              </label>
              <label>
                Reporting to
                {/*
                  A picker writing `reportingToEmployeeId`, not the free-text name it used to be. The
                  org canvas re-parents people by id, so a typed name here would have written a
                  different column and the two views would have disagreed about the same person's
                  manager. The backend derives the display name from the chosen row.
                */}
                <select
                  value={form.reportingToEmployeeId ?? ''}
                  onChange={(e) => set('reportingToEmployeeId', e.target.value || null)}
                >
                  <option value="">—</option>
                  {unresolvedManager ? (
                    <option value="" disabled>
                      {`${unresolvedManager} (not linked)`}
                    </option>
                  ) : null}
                  {managerOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {`${m.firstName} ${m.lastName}`.trim()}
                      {m.designation ? ` · ${m.designation}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          {formError ? (
            <p className="hr-banner-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="hr-modal-actions">
            {saving ? <HrBusy label={mode.kind === 'create' ? 'Creating…' : 'Saving…'} /> : null}
            <button type="button" className="hr-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>
              {mode.kind === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
