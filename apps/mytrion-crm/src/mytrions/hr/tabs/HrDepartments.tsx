import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import {
  createHrDepartment,
  deleteHrDepartment,
  listHrDepartments,
  updateHrDepartment,
  type HrDepartmentDto,
  type HrDepartmentWriteInput,
} from '../../../api/hr';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrEmpty, HrPageHead } from '../HrBits';

type FormMode = { kind: 'create' } | { kind: 'edit'; department: HrDepartmentDto };

const EMPTY_FORM: HrDepartmentWriteInput = {
  name: '',
  code: '',
  mailAlias: '',
  leadName: '',
  parentName: '',
};

function toForm(d: HrDepartmentDto): HrDepartmentWriteInput {
  return {
    name: d.name,
    code: d.code ?? '',
    mailAlias: d.mailAlias ?? '',
    leadName: d.leadName ?? '',
    parentName: d.parentName ?? '',
  };
}

function normalizeWrite(form: HrDepartmentWriteInput): HrDepartmentWriteInput {
  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  };
  return {
    name: form.name.trim(),
    code: trimOrNull(form.code),
    mailAlias: trimOrNull(form.mailAlias),
    leadName: trimOrNull(form.leadName),
    parentName: trimOrNull(form.parentName),
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

/** HR → Departments. Own `hr_departments` table (migrated from Zoho People). */
export function HrDepartments() {
  const user = useUserContext();
  const admin = isAdmin(user);

  const [items, setItems] = useState<HrDepartmentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [form, setForm] = useState<HrDepartmentWriteInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    void listHrDepartments({
      ...(debouncedQ ? { q: debouncedQ } : {}),
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
  }, [debouncedQ, reloadTick]);

  const reload = useCallback((): void => {
    setReloadTick((n) => n + 1);
  }, []);

  const openCreate = (): void => {
    setForm(EMPTY_FORM);
    setFormError('');
    setFormMode({ kind: 'create' });
  };

  const openEdit = (department: HrDepartmentDto): void => {
    setForm(toForm(department));
    setFormError('');
    setFormMode({ kind: 'edit', department });
  };

  const onDelete = async (department: HrDepartmentDto): Promise<void> => {
    if (!admin) return;
    if (!window.confirm(`Delete department “${department.name}”?`)) return;
    setError('');
    try {
      await deleteHrDepartment(department.id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSave = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    if (!admin || !formMode || saving) return;
    const body = normalizeWrite(form);
    if (!body.name) {
      setFormError('Name is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (formMode.kind === 'create') await createHrDepartment(body);
      else await updateHrDepartment(formMode.department.id, body);
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
        tab="departments"
        actions={
          <>
            <button type="button" className="hr-btn" disabled={loading} onClick={reload}>
              <RefreshCw size={14} className={loading ? 'hr-spin' : undefined} />
              Refresh
            </button>
            {admin ? (
              <button type="button" className="hr-btn hr-btn-primary" onClick={openCreate}>
                <Plus size={14} />
                Add department
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
            placeholder="Search name, code, lead, parent…"
            aria-label="Search departments"
          />
        </label>
        <div className="hr-summary">
          <strong>{total}</strong> {total === 1 ? 'department' : 'departments'}
        </div>
      </div>

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="hr-emp-grid" aria-busy="true" aria-label="Loading departments">
          <div className="hr-sk" />
          <div className="hr-sk" />
        </div>
      ) : items.length === 0 ? (
        <HrEmpty
          icon={<Building2 size={26} />}
          title={debouncedQ ? 'No matches' : 'No departments yet'}
          body={
            admin
              ? 'Add a department manually, or migrate rows into hr_departments.'
              : 'No department records in the directory yet.'
          }
        />
      ) : (
        <div className="hr-table-wrap">
          <div className="hr-table-scroll">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Code</th>
                  <th>Lead</th>
                  <th>Parent</th>
                  <th>Mail alias</th>
                  <th>Source</th>
                  {admin ? <th className="hr-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td className="hr-strong">{d.name}</td>
                    <td className="hr-mono">{d.code ?? '—'}</td>
                    <td>
                      <div>{d.leadName ?? '—'}</div>
                      {d.leadEmail ? <div className="hr-emp-id">{d.leadEmail}</div> : null}
                    </td>
                    <td>{d.parentName ?? '—'}</td>
                    <td className="hr-mono">{d.mailAlias ?? '—'}</td>
                    <td className="hr-mono">{d.source === 'zoho_people' ? 'Migrated' : 'Manual'}</td>
                    {admin ? (
                      <td className="hr-right">
                        <div className="hr-row-actions">
                          <button
                            type="button"
                            className="hr-icon-btn"
                            aria-label={`Edit ${d.name}`}
                            onClick={() => openEdit(d)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="hr-icon-btn hr-icon-danger"
                            aria-label={`Delete ${d.name}`}
                            onClick={() => void onDelete(d)}
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
            aria-labelledby="hr-dept-form-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <header className="hr-modal-head">
              <h2 id="hr-dept-form-title">
                {formMode.kind === 'create' ? 'Add department' : `Edit ${formMode.department.name}`}
              </h2>
              <button type="button" className="hr-icon-btn" aria-label="Close" onClick={() => setFormMode(null)}>
                <X size={16} />
              </button>
            </header>
            <form className="hr-form" onSubmit={(ev) => void onSave(ev)}>
              <div className="hr-form-grid">
                <label>
                  Name *
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <label>
                  Code
                  <input
                    value={form.code ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </label>
                <label>
                  Lead
                  <input
                    value={form.leadName ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, leadName: e.target.value }))}
                  />
                </label>
                <label>
                  Parent department
                  <select
                    value={form.parentName ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, parentName: e.target.value }))}
                  >
                    <option value="">—</option>
                    {items
                      .filter((d) =>
                        formMode.kind === 'edit' ? d.id !== formMode.department.id : true,
                      )
                      .map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Mail alias
                  <input
                    type="email"
                    value={form.mailAlias ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, mailAlias: e.target.value }))}
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
