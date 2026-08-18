/**
 * Maintenance case — the Overview tab: one sectioned, always-editable form for both create and
 * edit. Split out of MaintenanceModal.tsx (which now also hosts Attachments/Timeline tabs) so no
 * single file blows past the repo's file-size cap.
 *
 * Company is a typeahead over the DWH's `octane.dim_company` — the authoritative company <-> carrier
 * map — so picking a company FILLS the carrier id and the agent never types it. Carrier ID is
 * therefore read-only: derived, not entered. `companyName` is denormalized onto the row because it is
 * what the card renders and what the search matches.
 *
 * There is no delete: `totalAmount` on these rows is real money feeding the prepay ledger. Setting
 * Status to Cancelled is the reversible path, and the route has no DELETE at all.
 */
import { useMemo } from 'react';

import type { CompanyOption } from '@/api/cs';
import { fmtMoneyStr, type MaintenanceRecord } from './live';
import { SearchableSelect, type SelectOption } from './SearchableSelect';

/** Every field the form writes. String-only state keeps the inputs controlled and the diff simple. */
export const FIELDS = [
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
  'bonusCompletionUserId',
  'bonusCompletionName',
] as const;
export type Field = (typeof FIELDS)[number];

export const MONEY_FIELDS = new Set<Field>([
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
export function initialValues(
  r: MaintenanceRecord | null,
  myUserId: string,
  myName: string,
): Record<Field, string> {
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
  out.bonusCompletionUserId = s(r.bonusCompletionUserId);
  out.bonusCompletionName = s(r.bonusCompletionName);
  return out;
}

interface UserOpt {
  id: string;
  name: string | null;
}

export function MaintenanceOverviewForm({
  record,
  isCreating,
  values,
  set,
  users,
  accountQuery,
  setAccountQuery,
  accounts,
  companyOpen,
  setCompanyOpen,
  statusOptions,
  caseTypeOptions,
  paymentMethodOptions,
  paymentStatusOptions,
}: {
  record: MaintenanceRecord | null;
  isCreating: boolean;
  values: Record<Field, string>;
  set: (field: Field, value: string) => void;
  users: UserOpt[];
  accountQuery: string;
  setAccountQuery: (v: string) => void;
  accounts: CompanyOption[];
  companyOpen: boolean;
  setCompanyOpen: (v: boolean) => void;
  statusOptions: string[];
  caseTypeOptions: string[];
  paymentMethodOptions: string[];
  paymentStatusOptions: string[];
}) {
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

  // Memoised so SearchableSelect's option list keeps a stable identity across the form's re-renders
  // (it re-renders on every keystroke in any field).
  const userOptions: SelectOption[] = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.name ?? u.id })),
    [users],
  );

  // Searchable rather than a native <select>: users is the same full roster the Maintenance list
  // filter guards against — too many names to scan, and a native select can't be typed past its
  // first letter.
  const userSelect = (idField: Field, nameField: Field, allLabel: string, placeholder: string) => {
    const current = values[idField];
    // Keep a legacy assignee selectable even if they've left the roster.
    const opts =
      current && !users.some((u) => u.id === current)
        ? [{ value: current, label: values[nameField] || current }, ...userOptions]
        : userOptions;
    return (
      <SearchableSelect
        value={current}
        options={opts}
        placeholder={placeholder}
        allLabel={allLabel}
        onChange={(id) => {
          set(idField, id);
          set(nameField, users.find((u) => u.id === id)?.name ?? '');
        }}
      />
    );
  };

  return (
    <>
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
        <FormField label="Reference Number">
          <input
            className="cs-form-input cs-mt-derived"
            value={values.referenceNumber}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
            placeholder={isCreating ? 'Generated automatically on save' : ''}
            title="Generated automatically — not editable"
          />
        </FormField>
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
          {userSelect('ownerZohoUserId', 'ownerName', 'Unassigned', 'Search owner…')}
        </FormField>
        <FormField label="Second Agent (Joint Case)">
          {userSelect('bonusCompletionUserId', 'bonusCompletionName', 'None — solo case', 'Search agent…')}
          <div className="cs-mt-form-hint">
            Jointly worked case — splits whatever bonus this case earns 50/50 with the Owner.
          </div>
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
    </>
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
