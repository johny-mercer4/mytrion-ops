import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, RefreshCw, Search, Trash2, Users, X } from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import {
  createHrEmployee,
  deleteHrEmployee,
  listHrDepartments,
  listHrDesignations,
  listHrEmployees,
  updateHrEmployee,
  type HrDepartmentDto,
  type HrEmployeeDto,
  type HrEmployeeWriteInput,
} from '../../../api/hr';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrEmpty, HrPageHead, Pill, toneFor } from '../HrBits';

type StatusFilter = 'all' | 'Active' | 'Terminated';
type FormMode = { kind: 'create' } | { kind: 'edit'; employee: HrEmployeeDto };

const EMPTY_FORM: HrEmployeeWriteInput = {
  firstName: '',
  lastName: '',
  employeeId: '',
  email: '',
  departmentId: '',
  designation: '',
  location: '',
  status: 'Active',
  role: '',
  dateOfJoining: '',
  mobile: '',
  reportingTo: '',
};

function initials(e: HrEmployeeDto): string {
  return `${e.firstName.charAt(0)}${e.lastName.charAt(0)}`.toUpperCase() || '?';
}

function displayName(e: HrEmployeeDto): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

function toForm(e: HrEmployeeDto): HrEmployeeWriteInput {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    employeeId: e.employeeId ?? '',
    email: e.email ?? '',
    departmentId: e.departmentId ?? '',
    designation: e.designation ?? '',
    location: e.location ?? '',
    status: e.status || 'Active',
    role: e.role ?? '',
    dateOfJoining: e.dateOfJoining ?? '',
    mobile: e.mobile ?? '',
    reportingTo: e.reportingTo ?? '',
  };
}

function normalizeWrite(form: HrEmployeeWriteInput): HrEmployeeWriteInput {
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
    location: trimOrNull(form.location),
    status: (form.status ?? 'Active').trim() || 'Active',
    role: trimOrNull(form.role),
    dateOfJoining: trimOrNull(form.dateOfJoining),
    mobile: trimOrNull(form.mobile),
    reportingTo: trimOrNull(form.reportingTo),
  };
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof err === 'object' &&
      err !== null &&
      'message' in err &&
      String((err as { message: unknown }).message).toLowerCase().includes('abort'))
  );
}

/**
 * HR → Employees. Reads Mytrion's own `hr_employees` table (not live Zoho People).
 * Create / edit / delete: Mytrion Admin only.
 */
export function HrEmployees() {
  const user = useUserContext();
  const admin = isAdmin(user);

  const [items, setItems] = useState<HrEmployeeDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [departmentId, setDepartmentId] = useState('');
  const [deptOptions, setDeptOptions] = useState<HrDepartmentDto[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [form, setForm] = useState<HrEmployeeWriteInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const ac = new AbortController();
    void Promise.all([
      listHrDepartments({ limit: 500, signal: ac.signal }),
      listHrDesignations(ac.signal),
    ])
      .then(([depts, desigs]) => {
        if (ac.signal.aborted) return;
        setDeptOptions(depts.items);
        setDesignations(desigs);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return;
        setDeptOptions([]);
        setDesignations([]);
      });
    return () => ac.abort();
  }, [reloadTick]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    void listHrEmployees({
      ...(debouncedQ ? { q: debouncedQ } : {}),
      ...(status !== 'all' ? { status } : {}),
      ...(departmentId ? { departmentId } : {}),
      limit: 500,
      signal: ac.signal,
    })
      .then((res) => {
        if (ac.signal.aborted) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : String(err));
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [debouncedQ, status, departmentId, reloadTick]);

  const reload = useCallback((): void => {
    setReloadTick((n) => n + 1);
  }, []);

  const openCreate = (): void => {
    setForm(EMPTY_FORM);
    setFormError('');
    setFormMode({ kind: 'create' });
  };

  const openEdit = (employee: HrEmployeeDto): void => {
    setForm(toForm(employee));
    setFormError('');
    setFormMode({ kind: 'edit', employee });
  };

  const onDelete = async (employee: HrEmployeeDto): Promise<void> => {
    if (!admin) return;
    const ok = window.confirm(`Delete ${displayName(employee)} from the HR directory?`);
    if (!ok) return;
    setError('');
    try {
      await deleteHrEmployee(employee.id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSave = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    if (!admin || !formMode || saving) return;
    const body = normalizeWrite(form);
    if (!body.firstName || !body.lastName) {
      setFormError('First and last name are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (formMode.kind === 'create') await createHrEmployee(body);
      else await updateHrEmployee(formMode.employee.id, body);
      setFormMode(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hr-page">
      <HrPageHead
        tab="employees"
        actions={
          <>
            <button type="button" className="hr-btn" disabled={loading} onClick={reload}>
              <RefreshCw size={14} className={loading ? 'hr-spin' : undefined} />
              Refresh
            </button>
            {admin ? (
              <button type="button" className="hr-btn hr-btn-primary" onClick={openCreate}>
                <Plus size={14} />
                Add employee
              </button>
            ) : null}
          </>
        }
      />

      <div className="hr-toolbar">
        <label className="hr-search">
          <Search size={14} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, employee id…"
            aria-label="Search employees"
          />
        </label>
        <div className="hr-chips" role="group" aria-label="Status filter">
          {(['all', 'Active', 'Terminated'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="hr-chip"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
        <label className="hr-select">
          <span className="hr-sr">Department</span>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="hr-summary">
          <strong>{total}</strong> {total === 1 ? 'employee' : 'employees'}
        </div>
      </div>

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="hr-emp-grid" aria-busy="true" aria-label="Loading employees">
          <div className="hr-sk" />
          <div className="hr-sk" />
          <div className="hr-sk" />
        </div>
      ) : items.length === 0 ? (
        <HrEmpty
          icon={<Users size={26} />}
          title={debouncedQ || status !== 'all' || departmentId ? 'No matches' : 'No employees yet'}
          body={
            admin
              ? 'Add an employee manually, or load rows into hr_employees.'
              : 'No employee records in the directory yet.'
          }
        />
      ) : (
        <div className="hr-table-wrap">
          <div className="hr-table-scroll">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>ID</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Status</th>
                  <th>Source</th>
                  {admin ? <th className="hr-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="hr-strong">
                      <div className="hr-emp-inline">
                        {e.photoUrl ? (
                          <img className="hr-avatar hr-avatar-sm" src={e.photoUrl} alt="" />
                        ) : (
                          <span className="hr-avatar hr-avatar-sm">{initials(e)}</span>
                        )}
                        <div className="hr-emp-inline-text">
                          <div>{displayName(e)}</div>
                          {e.email ? <div className="hr-emp-id">{e.email}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td className="hr-mono">{e.employeeId ?? '—'}</td>
                    <td>{e.department ?? '—'}</td>
                    <td>{e.designation ?? '—'}</td>
                    <td>
                      <Pill label={e.status} tone={toneFor(e.status)} />
                    </td>
                    <td className="hr-mono">{e.source === 'zoho_people' ? 'Migrated' : 'Manual'}</td>
                    {admin ? (
                      <td className="hr-right">
                        <div className="hr-row-actions">
                          <button
                            type="button"
                            className="hr-icon-btn"
                            aria-label={`Edit ${displayName(e)}`}
                            onClick={() => openEdit(e)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="hr-icon-btn hr-icon-danger"
                            aria-label={`Delete ${displayName(e)}`}
                            onClick={() => void onDelete(e)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formMode && admin ? (
        <div className="hr-modal-backdrop" role="presentation" onClick={() => setFormMode(null)}>
          <div
            className="hr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-emp-form-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <header className="hr-modal-head">
              <h2 id="hr-emp-form-title">
                {formMode.kind === 'create' ? 'Add employee' : `Edit ${displayName(formMode.employee)}`}
              </h2>
              <button type="button" className="hr-icon-btn" aria-label="Close" onClick={() => setFormMode(null)}>
                <X size={16} />
              </button>
            </header>
            <form className="hr-form" onSubmit={(ev) => void onSave(ev)}>
              <div className="hr-form-grid">
                <label>
                  First name *
                  <input
                    required
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                </label>
                <label>
                  Last name *
                  <input
                    required
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                </label>
                <label>
                  Employee ID
                  <input
                    value={form.employeeId ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </label>
                <label>
                  Department
                  <select
                    value={form.departmentId ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">—</option>
                    {deptOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Designation
                  <input
                    list="hr-designation-list"
                    value={form.designation ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
                  />
                  <datalist id="hr-designation-list">
                    {designations.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Location
                  <input
                    value={form.location ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </label>
                <label>
                  Status
                  <select
                    value={form.status ?? 'Active'}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="Active">Active</option>
                    <option value="Terminated">Terminated</option>
                  </select>
                </label>
                <label>
                  Role
                  <input
                    value={form.role ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  />
                </label>
                <label>
                  Date of joining
                  <input
                    value={form.dateOfJoining ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, dateOfJoining: e.target.value }))}
                    placeholder="YYYY-MM-DD"
                  />
                </label>
                <label>
                  Mobile
                  <input
                    value={form.mobile ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
                  />
                </label>
                <label>
                  Reporting to
                  <input
                    value={form.reportingTo ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, reportingTo: e.target.value }))}
                  />
                </label>
              </div>
              {formError ? (
                <p className="hr-banner-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="hr-modal-actions">
                <button type="button" className="hr-btn" onClick={() => setFormMode(null)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="hr-btn hr-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : formMode.kind === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
