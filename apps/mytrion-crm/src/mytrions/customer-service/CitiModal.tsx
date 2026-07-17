/**
 * Citifuel client modal — 1:1 port of the widget's single view+edit modal
 * (cs-modal-backdrop / cs-modal-box cs-modal-wide / cs-citi-section-title / cs-form-grid /
 * cs-lookup-wrap). One always-editable sectioned form (Client / Request / Contact / Notes /
 * Audit) for both create and edit, over POST/PATCH/DELETE /cs/citifuel. Picklists use locked
 * canonical option lists (live CRM metadata must not overwrite them); Company is an Accounts
 * typeahead, Agent/Owner are user lookups. Lookup values write as {id} objects (Zoho REST contract).
 */
import { useEffect, useRef, useState } from 'react';

import {
  createCitifuel,
  deleteCitifuel,
  lookupAccounts,
  lookupUsers,
  updateCitifuel,
  type CitiWriteValue,
} from '@/api/cs';
import type { CitiRow } from './live';
import { useScrollLock } from './useScrollLock';

const CANONICAL = {
  Request: ['Outbound', 'Incoming'],
  // lockOptions in the widget — keep these exact lists; live meta must not overwrite.
  Status_of_App: ['In process', 'Cards sent', 'Closed', 'Active', 'Using company card', 'Refilled'],
  Actions_taken: ['Request Citi to check', 'Agent Call'],
  Final_Decision: ['Octane', 'Citifuel', 'None'],
  Billing_Notes: ['Payment Issues', 'Debtor', 'Collection', 'Good Standing'],
} as const;

/** Zoho's synthetic '-None-' was selectable in an earlier widget build and got
 *  stored as literal text on some records. Load it as empty — saving clears it. */
const pick = (v: unknown): string => {
  const s = String(v ?? '');
  return s === '-None-' ? '' : s;
};

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const TRASH_PATH =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

interface UserOpt {
  id: string;
  name: string | null;
}
interface AccountOpt {
  id: string;
  name: string;
}

const lookupId = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as { id?: unknown }).id ?? '') : '';
const lookupName = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as { name?: unknown }).name ?? '') : '';

export function CitiModal({
  client,
  onClose,
  onSaved,
  onDeleted,
  notify,
}: {
  /** null = create */
  client: CitiRow | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  notify: (kind: 'success' | 'error', message: string) => void;
}) {
  const isCreating = client === null;
  const raw = client?.raw ?? {};
  useScrollLock();
  const boxRef = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<Record<string, string>>(() => ({
    Name: String(raw.Name ?? ''),
    App_ID: raw.App_ID == null ? '' : String(raw.App_ID),
    Request: pick(raw.Request),
    Status_of_App: pick(raw.Status_of_App),
    Actions_taken: pick(raw.Actions_taken),
    Final_Decision: pick(raw.Final_Decision),
    Billing_Notes: pick(raw.Billing_Notes),
    Date_of_Request: String(raw.Date_of_Request ?? '').slice(0, 10),
    Feedback_date: String(raw.Feedback_date ?? '').slice(0, 10),
    Email: String(raw.Email ?? ''),
    Phone_Number: String(raw.Phone_Number ?? ''),
    Notes_1: String(raw.Notes_1 ?? ''),
    Company_Name: lookupId(raw.Company_Name),
    Agent_Name: lookupId(raw.Agent_Name),
    Owner: lookupId(raw.Owner),
  }));
  // Display labels for the lookups (so an existing selection shows its name, not the id).
  const [labels, setLabels] = useState<Record<string, string>>({
    Company_Name: lookupName(raw.Company_Name),
    Agent_Name: lookupName(raw.Agent_Name),
    Owner: lookupName(raw.Owner),
  });

  /* Locked list (mirrors the widget) — live meta must not overwrite it. A
     legacy value on the open record stays selectable; '-None-' junk does not. */
  const statusOptions = (() => {
    const opts: string[] = [...CANONICAL.Status_of_App];
    const cur = pick(raw.Status_of_App);
    if (cur && !opts.includes(cur)) opts.push(cur);
    return opts;
  })();
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [accountQuery, setAccountQuery] = useState('');
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    boxRef.current?.focus();
    lookupUsers()
      .then((u) => setUsers(u.users))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !deleting) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, deleting, onClose]);

  useEffect(() => {
    if (accountQuery.trim().length < 2) {
      setAccounts([]);
      return;
    }
    const t = setTimeout(() => {
      lookupAccounts(accountQuery.trim())
        .then((r) => setAccounts(r.accounts.map((a) => ({ id: a.id, name: a.Account_Name ?? a.id }))))
        .catch(() => setAccounts([]));
    }, 350);
    return () => clearTimeout(t);
  }, [accountQuery]);

  function set(field: string, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    if (!values.Name?.trim()) {
      setError('Client Name is required');
      return;
    }
    const data: Record<string, CitiWriteValue> = {};
    const scalar = (field: string, kind: 'text' | 'number' = 'text') => {
      const v = values[field] ?? '';
      if (v === '') {
        if (!isCreating) data[field] = null; // clearing on edit; skip empties on create
        return;
      }
      data[field] = kind === 'number' ? Number(v) : v;
    };
    scalar('Name');
    scalar('App_ID', 'number');
    scalar('Request');
    scalar('Status_of_App');
    scalar('Actions_taken');
    scalar('Final_Decision');
    scalar('Billing_Notes');
    scalar('Date_of_Request');
    scalar('Feedback_date');
    scalar('Email');
    scalar('Phone_Number');
    scalar('Notes_1');
    for (const lk of ['Company_Name', 'Agent_Name', 'Owner'] as const) {
      const id = values[lk] ?? '';
      if (id) data[lk] = { id };
      else if (!isCreating) data[lk] = null;
    }
    setSaving(true);
    setError('');
    try {
      if (client) await updateCitifuel(client.id, data);
      else await createCitifuel(data);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  async function remove() {
    if (!client) return;
    if (!window.confirm(`Delete "${client.name}" from Citifuel Clients? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteCitifuel(client.id);
      notify('success', `Deleted ${client.name}`);
      onDeleted();
    } catch (e) {
      notify('error', `Delete failed: ${e instanceof Error ? e.message : e}`);
      setDeleting(false);
    }
  }

  const dirtyCount = client
    ? Object.keys(values).filter((k) => {
        const orig =
          k === 'Company_Name' || k === 'Agent_Name' || k === 'Owner'
            ? lookupId((raw as Record<string, unknown>)[k])
            : k === 'Date_of_Request' || k === 'Feedback_date'
              ? String((raw as Record<string, unknown>)[k] ?? '').slice(0, 10)
              : (raw as Record<string, unknown>)[k] == null
                ? ''
                : String((raw as Record<string, unknown>)[k]);
        return (values[k] ?? '') !== orig;
      }).length
    : 0;

  const picklist = (field: keyof typeof CANONICAL, options: readonly string[]) => (
    <select className="cs-form-input" value={values[field] ?? ''} onChange={(e) => set(field, e.target.value)}>
      <option value="">— Select —</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  const userLookup = (field: 'Agent_Name' | 'Owner') => (
    <select className="cs-form-input" value={values[field] ?? ''} onChange={(e) => set(field, e.target.value)}>
      <option value="">—</option>
      {/* keep an out-of-page current value selectable */}
      {values[field] && !users.some((u) => u.id === values[field]) ? (
        <option value={values[field]}>{labels[field] || values[field]}</option>
      ) : null}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name ?? u.id}
        </option>
      ))}
    </select>
  );

  return (
    <div className="cs-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !saving && !deleting && onClose()}>
      <div className="cs-modal-box cs-modal-wide" ref={boxRef} tabIndex={-1}>
        <div className="cs-modal-header">
          <h3 className="cs-modal-title">{isCreating ? 'New Citifuel Client' : client?.name || 'Client'}</h3>
          <button className="cs-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cs-modal-body">
          {error ? <div className="cs-form-error">{error}</div> : null}

          <div className="cs-citi-section-title">Client Info</div>
          <div className="cs-form-grid">
            <div className="cs-form-field">
              <label className="cs-form-label">
                Client Name<span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input className="cs-form-input" value={values.Name} onChange={(e) => set('Name', e.target.value)} />
            </div>
            <div className="cs-form-field">
              <label className="cs-form-label">App ID</label>
              <input className="cs-form-input" type="number" value={values.App_ID} onChange={(e) => set('App_ID', e.target.value)} />
            </div>
            <div className="cs-form-field cs-form-field-wide">
              <label className="cs-form-label">Company (Accounts)</label>
              <div className="cs-lookup-wrap">
                <input
                  className="cs-form-input"
                  autoComplete="off"
                  placeholder="Search company…"
                  value={companyOpen ? accountQuery : labels.Company_Name || accountQuery}
                  onFocus={() => setCompanyOpen(true)}
                  onBlur={() => setTimeout(() => setCompanyOpen(false), 150)}
                  onChange={(e) => {
                    setAccountQuery(e.target.value);
                    setCompanyOpen(true);
                  }}
                />
                {values.Company_Name ? (
                  <button
                    type="button"
                    className="cs-lookup-clear"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      set('Company_Name', '');
                      setLabels((l) => ({ ...l, Company_Name: '' }));
                      setAccountQuery('');
                    }}
                  >
                    ×
                  </button>
                ) : null}
                {companyOpen && accounts.length > 0 ? (
                  <div className="cs-lookup-dropdown">
                    {accounts.map((a) => (
                      <div
                        key={a.id}
                        className="cs-lookup-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          set('Company_Name', a.id);
                          setLabels((l) => ({ ...l, Company_Name: a.name }));
                          setAccountQuery('');
                          setCompanyOpen(false);
                        }}
                      >
                        {a.name}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Request Details
          </div>
          <div className="cs-form-grid">
            <FormField label="Request">{picklist('Request', CANONICAL.Request)}</FormField>
            <FormField label="Status of App">{picklist('Status_of_App', statusOptions)}</FormField>
            <FormField label="Actions Taken">{picklist('Actions_taken', CANONICAL.Actions_taken)}</FormField>
            <FormField label="Final Decision">{picklist('Final_Decision', CANONICAL.Final_Decision)}</FormField>
            <FormField label="Billing Notes">{picklist('Billing_Notes', CANONICAL.Billing_Notes)}</FormField>
            <FormField label="Date of Request">
              <input className="cs-form-input" type="date" value={values.Date_of_Request} onChange={(e) => set('Date_of_Request', e.target.value)} />
            </FormField>
            <FormField label="Feedback Date">
              <input className="cs-form-input" type="date" value={values.Feedback_date} onChange={(e) => set('Feedback_date', e.target.value)} />
            </FormField>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Contact
          </div>
          <div className="cs-form-grid">
            <FormField label="Email">
              <input className="cs-form-input" type="email" value={values.Email} onChange={(e) => set('Email', e.target.value)} />
            </FormField>
            <FormField label="Phone">
              <input className="cs-form-input" type="tel" value={values.Phone_Number} onChange={(e) => set('Phone_Number', e.target.value)} />
            </FormField>
            <FormField label="Agent">{userLookup('Agent_Name')}</FormField>
            <FormField label="Owner">{userLookup('Owner')}</FormField>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Notes
          </div>
          <div className="cs-form-grid">
            <div className="cs-form-field cs-form-field-wide">
              <label className="cs-form-label">Notes</label>
              <textarea className="cs-form-input" rows={4} value={values.Notes_1} onChange={(e) => set('Notes_1', e.target.value)} />
            </div>
          </div>

          {!isCreating ? (
            <>
              <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
                Audit
              </div>
              <div className="cs-form-grid">
                <FormField label="Created By">
                  <div className="cs-form-readonly">{lookupName(raw.Created_By) || '—'}</div>
                </FormField>
                <FormField label="Modified By">
                  <div className="cs-form-readonly">{lookupName(raw.Modified_By) || '—'}</div>
                </FormField>
              </div>
            </>
          ) : null}
        </div>

        <div className="cs-modal-footer">
          {!isCreating && dirtyCount > 0 ? (
            <span className="cs-dirty-indicator">
              {dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}
            </span>
          ) : null}
          {!isCreating ? (
            <button className="cs-btn cs-citi-delete-modal-btn" onClick={remove} disabled={saving || deleting}>
              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TRASH_PATH} />
              </svg>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : null}
          <button className="cs-btn cs-btn-ghost" onClick={onClose} disabled={saving || deleting}>
            Cancel
          </button>
          <button
            className="cs-btn cs-btn-primary"
            onClick={save}
            disabled={saving || deleting || (!isCreating && dirtyCount === 0)}
          >
            {saving ? (
              <svg className="spin-icon" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
              </svg>
            ) : null}
            {saving ? 'Saving…' : isCreating ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cs-form-field">
      <label className="cs-form-label">{label}</label>
      {children}
    </div>
  );
}
