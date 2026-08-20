/**
 * Maintenance case modal shell — owns state + save, and switches between three tabs: Overview (the
 * always-editable form, extracted to MaintenanceOverviewForm.tsx), Attachments, and Timeline (CS
 * feedback 2026-07-31, both new — see MaintenanceAttachments.tsx / MaintenanceTimeline.tsx). The
 * latter two need an existing case id, so they're hidden on create.
 *
 * Built on the same chrome as CitiModal (cs-modal-backdrop / cs-modal-box cs-modal-wide) so the
 * editors feel like one product.
 */
import { useEffect, useRef, useState } from 'react';

import {
  createMaintenance,
  deleteMaintenance,
  lookupMaintenanceCompanies,
  lookupUsers,
  updateMaintenance,
  type CompanyOption,
} from '@/api/cs';
import { ConfirmDialog } from '@/ds';
import { useUserContext } from '@/context/UserContextProvider';
import { MaintenanceAttachments } from './MaintenanceAttachments';
import {
  FIELDS,
  initialValues,
  MONEY_FIELDS,
  MaintenanceOverviewForm,
  type Field,
} from './MaintenanceOverviewForm';
import { MaintenanceTimeline } from './MaintenanceTimeline';
import type { MaintenanceRecord } from './live';
import { useScrollLock } from './useScrollLock';

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const TRASH_PATH =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

interface UserOpt {
  id: string;
  name: string | null;
}

type Tab = 'overview' | 'attachments' | 'timeline';

export function MaintenanceModal({
  record,
  statusOptions,
  caseTypeOptions,
  paymentMethodOptions,
  paymentStatusOptions,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** null = create */
  record: MaintenanceRecord | null;
  statusOptions: string[];
  caseTypeOptions: string[];
  paymentMethodOptions: string[];
  paymentStatusOptions: string[];
  onClose: () => void;
  onSaved: (saved: MaintenanceRecord) => void;
  onDeleted: () => void;
}) {
  const isCreating = record === null;
  useScrollLock();
  const boxRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('overview');

  // Only a VERIFIED Zoho session carries a real CRM user id; the dev mock's 'dev-user' is not one.
  const me = useUserContext();
  const myUserId = me.trusted ? me.userId : '';

  const [values, setValues] = useState<Record<Field, string>>(() =>
    initialValues(record, myUserId, me.userName),
  );
  const [users, setUsers] = useState<UserOpt[]>([]);
  /**
   * The company box is BOTH the typeahead query and the committed value — one source of truth.
   *
   * It used to be query-only, committing the typed text to `name` on blur. That looked fine and was
   * broken: type a company, click "Create Case" without tabbing away, and the form rejected the save
   * as "Company is required" while the field visibly held text (the blur commit was deferred 150ms
   * to let a dropdown mousedown land, so `save()` still read the empty value). Committing on every
   * keystroke removes the race rather than shortening it.
   */
  const [accountQuery, setAccountQuery] = useState(
    () => record?.companyName || record?.name || '',
  );
  const [accounts, setAccounts] = useState<CompanyOption[]>([]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const original = useRef(initialValues(record, myUserId, me.userName));

  useEffect(() => {
    boxRef.current?.focus();
    lookupUsers()
      .then((u) => setUsers(u.users))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the delete confirm is up it owns Escape (and stops propagation) — guard anyway so
      // a lost race can't close this modal out from under an in-flight delete.
      if (e.key === 'Escape' && !saving && !deleting && !confirmDelete) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, deleting, confirmDelete, onClose]);

  useEffect(() => {
    if (accountQuery.trim().length < 2) {
      setAccounts([]);
      return;
    }
    const t = setTimeout(() => {
      lookupMaintenanceCompanies(accountQuery.trim())
        .then((r) => setAccounts(r.companies))
        .catch(() => setAccounts([]));
    }, 350);
    return () => clearTimeout(t);
  }, [accountQuery]);

  function set(field: Field, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  const dirtyFields = FIELDS.filter((f) => values[f] !== original.current[f]);

  async function save() {
    if (!values.name.trim() && !values.companyName.trim()) {
      setError('Company is required — pick one from the list, or type a name');
      return;
    }
    // Send only what changed on edit; on create, send everything non-empty. An unchanged field left
    // out of a PATCH is the difference between "not touched" and "cleared".
    const fields = isCreating ? FIELDS.filter((f) => values[f] !== '') : dirtyFields;
    const payload: Record<string, string | number | boolean | null> = {};
    for (const f of fields) {
      const v = values[f];
      if (v === '') {
        payload[f] = null;
        continue;
      }
      if (f === 'invoiced') payload[f] = v === 'true';
      else if (MONEY_FIELDS.has(f)) payload[f] = Number(v);
      else payload[f] = v;
    }
    setSaving(true);
    setError('');
    try {
      const saved = record
        ? await updateMaintenance(record.id, payload)
        : await createMaintenance(payload);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  async function remove() {
    if (!record) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await deleteMaintenance(record.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  }

  const title = isCreating
    ? 'New Maintenance Case'
    : values.companyName || values.name || 'Maintenance case';

  return (
    <div
      className="cs-modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="cs-modal-box cs-modal-wide" ref={boxRef} tabIndex={-1}>
        <div className="cs-modal-header">
          <h3 className="cs-modal-title">{title}</h3>
          <button className="cs-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!isCreating && record ? (
          <div className="cs-mt-tab-strip" role="tablist">
            {(
              [
                ['overview', 'Overview'],
                ['attachments', 'Attachments'],
                ['timeline', 'Timeline'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`cs-mt-tab${tab === id ? ' cs-mt-tab-active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="cs-modal-body">
          {tab === 'overview' ? error ? <div className="cs-form-error">{error}</div> : null : null}

          {tab === 'overview' ? (
            <MaintenanceOverviewForm
              record={record}
              isCreating={isCreating}
              values={values}
              set={set}
              users={users}
              accountQuery={accountQuery}
              setAccountQuery={setAccountQuery}
              accounts={accounts}
              companyOpen={companyOpen}
              setCompanyOpen={setCompanyOpen}
              statusOptions={statusOptions}
              caseTypeOptions={caseTypeOptions}
              paymentMethodOptions={paymentMethodOptions}
              paymentStatusOptions={paymentStatusOptions}
            />
          ) : tab === 'attachments' && record ? (
            <MaintenanceAttachments caseId={record.id} />
          ) : record ? (
            <MaintenanceTimeline caseId={record.id} />
          ) : null}
        </div>

        {tab === 'overview' ? (
          <div className="cs-modal-footer">
            {!isCreating && dirtyFields.length > 0 ? (
              <span className="cs-dirty-indicator">
                {dirtyFields.length} unsaved change{dirtyFields.length > 1 ? 's' : ''}
              </span>
            ) : null}
            {!isCreating ? (
              <button
                className="cs-btn cs-mt-delete-modal-btn"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
              >
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
              disabled={saving || deleting || (!isCreating && dirtyFields.length === 0)}
            >
              {saving ? (
                <svg className="spin-icon" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
                </svg>
              ) : null}
              {saving ? 'Saving…' : isCreating ? 'Create Case' : 'Save'}
            </button>
          </div>
        ) : (
          <div className="cs-modal-footer">
            <button className="cs-btn cs-btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>

      {confirmDelete && record ? (
        <ConfirmDialog
          open
          tone="danger"
          title="Delete this case?"
          body={`"${title}" will be permanently removed, including its attachments and timeline. This cannot be undone — use this only for test-created cases.`}
          confirmLabel="Delete"
          confirming={deleting}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
