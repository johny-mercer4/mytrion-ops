/**
 * Maintenance case — one sectioned, always-editable form for both create and edit, over
 * POST/PATCH /cs/maintenance (Postgres; no Zoho round-trip).
 *
 * Built on the same chrome as CitiModal (cs-modal-backdrop / cs-modal-box cs-modal-wide /
 * cs-citi-section-title / cs-form-grid / cs-lookup-wrap) so the two editors feel like one product.
 * Company is a typeahead over the DWH's `octane.dim_company` — the authoritative company <-> carrier
 * map — so picking a company FILLS the carrier id and the agent never types it. Carrier ID is
 * therefore read-only: derived, not entered. `companyName` is denormalized onto the row because it is
 * what the card renders and what the search matches.
 *
 * There is no delete: `totalAmount` on these rows is real money feeding the prepay ledger. Setting
 * Status to Cancelled is the reversible path, and the route has no DELETE at all.
 */
import { useEffect, useRef, useState } from 'react';

import {
  createMaintenance,
  lookupMaintenanceCompanies,
  lookupUsers,
  updateMaintenance,
  type CompanyOption,
} from '@/api/cs';
import { useUserContext } from '@/context/UserContextProvider';
import { fmtMoneyStr, type MaintenanceRecord } from './live';
import { useScrollLock } from './useScrollLock';

const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

interface UserOpt {
  id: string;
  name: string | null;
}

/** Every field the form writes. String-only state keeps the inputs controlled and the diff simple. */
const FIELDS = [
  'name',
  'companyZohoId',
  'companyName',
  'carrierId',
  'unitNumber',
  'status',
  'caseType',
  'caseDate',
  'caseCompletion',
  'driverName',
  'phone',
  'shopNumber',
  'parts',
  'workOrderId',
  'referenceNumber',
  'paymentMethod',
  'paymentStatus',
  'invoiced',
  'cardDigits',
  'totalAmount',
  'completionCompensation',
  'halfCompletionCompensation',
  'leadCompensation',
  'ownerZohoUserId',
  'ownerName',
] as const;
type Field = (typeof FIELDS)[number];

const MONEY_FIELDS = new Set<Field>([
  'totalAmount',
  'completionCompensation',
  'halfCompletionCompensation',
  'leadCompensation',
]);

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Kept in step with COMPENSATION_DEFAULTS in the backend's maintenanceRules.ts. Hardcoded rather than
 * read from /cs/maintenance/meta on purpose: the form must not render blank compensation fields while
 * a fetch is in flight, and the server applies these regardless, so a stale copy here can only ever
 * be cosmetic — never wrong data.
 */
const COMPENSATION_DEFAULTS = {
  completionCompensation: '5.00',
  halfCompletionCompensation: '2.50',
  leadCompensation: '10.00',
} as const;

/** Existing values → form state. Dates are already YYYY-MM-DD; money is a NUMERIC string. */
function initialValues(r: MaintenanceRecord | null, myUserId: string, myName: string): Record<Field, string> {
  const out = {} as Record<Field, string>;
  for (const f of FIELDS) out[f] = '';
  if (!r) {
    // A new case belongs to whoever creates it — an unowned case has nobody chasing it.
    out.ownerZohoUserId = myUserId;
    out.ownerName = myUserId ? myName : '';
    out.status = 'In Process';
    // The compensation the server applies anyway, shown up front. These mirror Zoho's "Compensation
    // Prepopulation" workflow rule, which stamped them on save — so agents were used to seeing the
    // numbers appear only afterwards. The server still fills them if cleared; these are editable, and
    // unlike in Zoho an override now survives (see modules/customerService/maintenanceRules.ts).
    out.completionCompensation = COMPENSATION_DEFAULTS.completionCompensation;
    out.halfCompletionCompensation = COMPENSATION_DEFAULTS.halfCompletionCompensation;
    out.leadCompensation = COMPENSATION_DEFAULTS.leadCompensation;
    return out;
  }
  out.name = s(r.name);
  out.companyZohoId = s(r.companyZohoId);
  out.companyName = s(r.companyName);
  out.carrierId = s(r.carrierId);
  out.unitNumber = s(r.unitNumber);
  out.status = s(r.status);
  out.caseType = s(r.caseType);
  out.caseDate = s(r.caseDate).slice(0, 10);
  out.caseCompletion = s(r.caseCompletion).slice(0, 10);
  out.driverName = s(r.driverName);
  out.phone = s(r.phone);
  out.shopNumber = s(r.shopNumber);
  out.parts = s(r.parts);
  out.workOrderId = s(r.workOrderId);
  out.referenceNumber = s(r.referenceNumber);
  out.paymentMethod = s(r.paymentMethod);
  out.paymentStatus = s(r.paymentStatus);
  out.invoiced = r.invoiced ? 'true' : '';
  out.cardDigits = s(r.cardDigits);
  out.totalAmount = s(r.totalAmount);
  out.completionCompensation = s(r.completionCompensation);
  out.halfCompletionCompensation = s(r.halfCompletionCompensation);
  out.leadCompensation = s(r.leadCompensation);
  out.ownerZohoUserId = s(r.ownerZohoUserId);
  out.ownerName = s(r.ownerName);
  return out;
}

export function MaintenanceModal({
  record,
  statusOptions,
  caseTypeOptions,
  paymentMethodOptions,
  paymentStatusOptions,
  onClose,
  onSaved,
}: {
  /** null = create */
  record: MaintenanceRecord | null;
  statusOptions: string[];
  caseTypeOptions: string[];
  paymentMethodOptions: string[];
  paymentStatusOptions: string[];
  onClose: () => void;
  onSaved: (saved: MaintenanceRecord) => void;
}) {
  const isCreating = record === null;
  useScrollLock();
  const boxRef = useRef<HTMLDivElement>(null);

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

  const original = useRef(initialValues(record, myUserId, me.userName));

  useEffect(() => {
    boxRef.current?.focus();
    lookupUsers()
      .then((u) => setUsers(u.users))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

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

  const picklist = (field: Field, options: string[], placeholder = '— Select —') => {
    const current = values[field];
    // Keep a legacy value on the open record selectable even if it's no longer offered.
    const opts = current && !options.includes(current) ? [...options, current] : options;
    return (
      <select className="cs-form-input" value={current} onChange={(e) => set(field, e.target.value)}>
        <option value="">{placeholder}</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  };

  const money = (field: Field) => (
    <input
      className="cs-form-input"
      type="number"
      step="0.01"
      min="0"
      value={values[field]}
      onChange={(e) => set(field, e.target.value)}
    />
  );

  const text = (field: Field, type = 'text') => (
    <input
      className="cs-form-input"
      type={type}
      value={values[field]}
      onChange={(e) => set(field, e.target.value)}
    />
  );

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

        <div className="cs-modal-body">
          {error ? <div className="cs-form-error">{error}</div> : null}

          <div className="cs-citi-section-title">Case</div>
          <div className="cs-form-grid">
            <div className="cs-form-field cs-form-field-wide">
              <label className="cs-form-label">
                Company<span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div className="cs-lookup-wrap">
                <input
                  className="cs-form-input"
                  autoComplete="off"
                  placeholder="Search companies by name or carrier ID…"
                  value={accountQuery}
                  onFocus={() => setCompanyOpen(true)}
                  // Only closes the dropdown. The value is already committed (see onChange), so the
                  // deferral cannot swallow a save.
                  onBlur={() => setTimeout(() => setCompanyOpen(false), 150)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAccountQuery(v);
                    // A typed-but-unmatched company is a perfectly valid case, so the text IS the
                    // value. Typing also clears the carrier id: it was derived from a company that is
                    // no longer the one in the box, and a stale carrier id is worse than none.
                    set('name', v);
                    set('companyName', v);
                    set('carrierId', '');
                    // The Zoho Accounts link on a migrated record described the OLD company.
                    set('companyZohoId', '');
                    setCompanyOpen(true);
                  }}
                />
                {accountQuery ? (
                  <button
                    type="button"
                    className="cs-lookup-clear"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      set('companyName', '');
                      set('name', '');
                      set('carrierId', '');
                      set('companyZohoId', '');
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
                        // 49 company NAMES map to more than one carrier, so the carrier id is part of
                        // the identity — both for the key and for what the agent reads.
                        key={a.carrierId}
                        className="cs-lookup-item cs-mt-company-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          set('companyName', a.companyName);
                          set('name', a.companyName);
                          set('carrierId', a.carrierId); // ← the whole point of the DWH lookup
                          // DWH companies carry no Zoho Accounts id; a kept one would be the old company's.
                          set('companyZohoId', '');
                          setAccountQuery(a.companyName);
                          setCompanyOpen(false);
                        }}
                      >
                        <span className="cs-mt-company-name">{a.companyName}</span>
                        <span className="cs-mt-company-cid">{a.carrierId}</span>
                        {!a.isActive ? <span className="cs-mt-company-off">inactive</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {/*
              Carrier ID is DERIVED from the company and read-only — it is not an agent's to type.
              Kept visible rather than removed: it is the tab's primary search key and it is on every
              card, so hiding it would leave the modal unable to show what the agent searched by.
            */}
            <FormField label="Carrier ID">
              <input
                className="cs-form-input cs-mt-derived"
                value={values.carrierId}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                placeholder={values.companyName ? 'No carrier on this company' : 'Pick a company first'}
                title="Filled automatically from the selected company"
              />
            </FormField>
            <FormField label="Unit Number">{text('unitNumber')}</FormField>
            <FormField label="Status">{picklist('status', statusOptions)}</FormField>
            <FormField label="Case Type">{picklist('caseType', caseTypeOptions)}</FormField>
            <FormField label="Work Order ID">{text('workOrderId')}</FormField>
            <FormField label="Reference Number">{text('referenceNumber')}</FormField>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Dates
          </div>
          <div className="cs-form-grid">
            <FormField label="Date">{text('caseDate', 'date')}</FormField>
            <FormField label="Completion Date">
              {text('caseCompletion', 'date')}
              <div className="cs-mt-form-hint">Set this only when the case is signed off.</div>
            </FormField>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Service
          </div>
          <div className="cs-form-grid">
            <FormField label="Driver Name">{text('driverName')}</FormField>
            <FormField label="Phone">{text('phone', 'tel')}</FormField>
            <FormField label="Shop Number">{text('shopNumber')}</FormField>
            <div className="cs-form-field cs-form-field-wide">
              <label className="cs-form-label">Parts / Work</label>
              <textarea
                className="cs-form-input"
                rows={2}
                value={values.parts}
                onChange={(e) => set('parts', e.target.value)}
              />
            </div>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Payment
          </div>
          <div className="cs-form-grid">
            <FormField label="Total Amount">{money('totalAmount')}</FormField>
            <FormField label="Payment Method">{picklist('paymentMethod', paymentMethodOptions)}</FormField>
            <FormField label="Payment Status">{picklist('paymentStatus', paymentStatusOptions)}</FormField>
            <FormField label="Card Digits">{text('cardDigits')}</FormField>
            <FormField label="Invoiced">
              <select
                className="cs-form-input"
                value={values.invoiced}
                onChange={(e) => set('invoiced', e.target.value)}
              >
                <option value="">No</option>
                <option value="true">Yes</option>
              </select>
            </FormField>
          </div>

          <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
            Ownership &amp; Compensation
          </div>
          <div className="cs-form-grid">
            <FormField label="Owner">
              <select
                className="cs-form-input"
                value={values.ownerZohoUserId}
                onChange={(e) => {
                  const id = e.target.value;
                  set('ownerZohoUserId', id);
                  // ownerName is denormalized — the card and the search read it, not a join.
                  set('ownerName', users.find((u) => u.id === id)?.name ?? '');
                }}
              >
                <option value="">Unassigned</option>
                {values.ownerZohoUserId && !users.some((u) => u.id === values.ownerZohoUserId) ? (
                  <option value={values.ownerZohoUserId}>
                    {values.ownerName || values.ownerZohoUserId}
                  </option>
                ) : null}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.id}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Completion Compensation">{money('completionCompensation')}</FormField>
            <FormField label="Half-Completion Compensation">
              {money('halfCompletionCompensation')}
            </FormField>
            <FormField label="Lead Compensation">{money('leadCompensation')}</FormField>
          </div>

          {!isCreating && record ? (
            <>
              <div className="cs-citi-section-title" style={{ marginTop: '1rem' }}>
                Record
              </div>
              <div className="cs-form-grid">
                <FormField label="Origin">
                  <div className="cs-form-readonly">
                    {record.source === 'mytrion' ? 'Created in Mytrion' : 'Migrated from Zoho CRM'}
                  </div>
                </FormField>
                <FormField label="Billed">
                  <div className="cs-form-readonly">{fmtMoneyStr(record.totalAmount)}</div>
                </FormField>
                <FormField label="Created by">
                  <div className="cs-form-readonly">{record.createdByName || record.ownerName || '—'}</div>
                </FormField>
                <FormField label="Last edited by">
                  <div className="cs-form-readonly">{record.updatedByName || '—'}</div>
                </FormField>
              </div>
            </>
          ) : null}
        </div>

        <div className="cs-modal-footer">
          {!isCreating && dirtyFields.length > 0 ? (
            <span className="cs-dirty-indicator">
              {dirtyFields.length} unsaved change{dirtyFields.length > 1 ? 's' : ''}
            </span>
          ) : null}
          <button className="cs-btn cs-btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="cs-btn cs-btn-primary"
            onClick={save}
            disabled={saving || (!isCreating && dirtyFields.length === 0)}
          >
            {saving ? (
              <svg className="spin-icon" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
              </svg>
            ) : null}
            {saving ? 'Saving…' : isCreating ? 'Create Case' : 'Save'}
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
