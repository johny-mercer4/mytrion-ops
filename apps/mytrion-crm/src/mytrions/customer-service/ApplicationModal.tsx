/**
 * Application record modal — the widget's single view+edit modal (cs-modal-backdrop /
 * cs-modal-box cs-modal-wide / cs-form-grid), ported 1:1 from applications-panel.js.
 * Editable field set + diff-only save are the live-data layer's (saveApplication with
 * allowlist + casing resolution + Edit_History server-side); widget-parity per-field
 * validation gates the save. Fields the live view-model doesn't carry render '—'.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { saveApplication } from '@/api/cs';
import { copyWithToast } from './copyToast';
import type { Application } from './data';
import { useScrollLock } from './useScrollLock';

type FieldType = 'text' | 'number' | 'picklist' | 'boolean' | 'textarea' | 'readonly';

interface ModalField {
  field: string;
  label: string;
  type: FieldType;
  options?: string[];
  get: (a: Application) => string | number | boolean | null;
}

/** Widget-parity picklists (CS_APPS_EXTRA_FIELDS + spreadsheet config). */
const MODAL_FIELDS: ModalField[] = [
  { field: 'Name', label: 'Company Name', type: 'text', get: (a) => a.company },
  { field: 'First_Name', label: 'First Name', type: 'text', get: (a) => a.first },
  { field: 'Last_Name', label: 'Last Name', type: 'text', get: (a) => a.last },
  { field: 'Email', label: 'Email', type: 'text', get: (a) => a.email },
  { field: 'Phone', label: 'Phone', type: 'text', get: (a) => a.phone },
  { field: 'emc', label: 'MC', type: 'text', get: (a) => a.mc },
  { field: 'DOT', label: 'DOT', type: 'text', get: (a) => a.dot },
  { field: 'City', label: 'City', type: 'text', get: (a) => a.city },
  { field: 'State', label: 'State', type: 'text', get: (a) => a.state },
  {
    field: 'Stage',
    label: 'Stage',
    type: 'picklist',
    options: ['Application', 'Adjudication', 'Credit Follow-up', 'Implementation', 'Expansion'],
    get: (a) => a.stage,
  },
  {
    field: 'WEX_Status',
    label: 'WEX Status',
    type: 'picklist',
    options: [
      'Saved-Complete', 'Additional Authentication Required', 'Pending Decision', 'Decisioned',
      'Pending Setup Data', 'Pending Setup-Generic', 'Deposit Counter Offer Sent', 'BOCDD-Needed',
      'Saved-Incomplete', 'App-Incomplete', 'Disqualified', 'Closed/Fraud', 'Closed/Lost', 'Cards Produced',
    ],
    get: (a) => a.wex,
  },
  {
    field: 'Type_of_Business',
    label: 'Business Entity Type',
    type: 'picklist',
    options: [
      'LLC', 'Corporation', 'Sole Proprietorship', 'Non-Profit', 'Partnership',
      'Natural Person', 'Unincorporated Association', 'Investment Company/Adviser',
    ],
    get: (a) => a.biz,
  },
  {
    field: 'Payment_Type_Billing',
    label: 'Payment Type',
    type: 'picklist',
    options: ['Prepay', 'Deposit', 'LOC'],
    get: (a) => a.pay,
  },
  {
    field: 'Billing_Cycle',
    label: 'Billing Cycle',
    type: 'picklist',
    options: ['1 Billing Cycle', '2 Billing Cycle', 'Thursday - Wednesday'],
    get: (a) => a.cycle,
  },
  { field: 'Credit_Score', label: 'CreditSafe Score', type: 'number', get: (a) => a.credit },
  { field: 'Number_of_Trucks', label: 'Number of Trucks', type: 'number', get: (a) => a.trucks },
  { field: 'Cards_Requested', label: 'Cards Requested', type: 'number', get: (a) => a.cards },
  { field: 'Verified', label: 'Verified', type: 'boolean', get: (a) => a.verified },
  { field: 'Customer_Service_Notes', label: 'Customer Service Notes', type: 'textarea', get: (a) => a.notes },
  /* ── Widget-parity display fields — read-only in the widget or not carried by the
        live view-model (uncarried values render '—'; no new API calls invented) ── */
  { field: 'Date_Filled', label: 'Date Filled', type: 'readonly', get: (a) => a.date },
  { field: '_dealAgent', label: 'Agent (Deal)', type: 'readonly', get: (a) => a.agent },
  { field: 'Address', label: 'Address', type: 'readonly', get: () => null },
  { field: 'Zip_Code', label: 'Zip Code', type: 'readonly', get: () => null },
  { field: 'Oldest_Open_Date', label: 'Oldest Open Date', type: 'readonly', get: () => null },
  { field: 'Loves_Verification', label: "Love's Verification", type: 'readonly', get: () => null },
  { field: 'Tracking_Number', label: 'Tracking Number', type: 'readonly', get: () => null },
  { field: 'Verification_Notes', label: 'Verification Notes', type: 'readonly', get: () => null },
  { field: 'Cards_Ordered', label: 'Cards Ordered', type: 'readonly', get: () => null },
  { field: 'Modified_By', label: 'Modified By', type: 'readonly', get: () => null },
];

const SPINNER_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

function initialValue(f: ModalField, app: Application): string | boolean {
  const raw = f.get(app);
  return f.type === 'boolean' ? raw === true : raw == null ? '' : String(raw);
}

function readonlyText(f: ModalField, app: Application): string {
  const raw = f.get(app);
  return raw === null || raw === undefined || raw === '' ? '—' : String(raw);
}

export function ApplicationModal({
  app,
  subTab,
  onClose,
  onSaved,
}: {
  app: Application;
  subTab: 'apps' | 'clients';
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  useScrollLock();
  const boxRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {};
    for (const f of MODAL_FIELDS) {
      if (f.type !== 'readonly') v[f.field] = initialValue(f, app);
    }
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirtyCount = MODAL_FIELDS.filter(
    (f) => f.type !== 'readonly' && values[f.field] !== initialValue(f, app),
  ).length;

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirtyCount > 0 && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }, [saving, dirtyCount, onClose]);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  function set(field: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    // Diff against the initial values so only touched fields hit the backend,
    // with the widget's per-field hard validation gating the payload.
    const changes: Record<string, string | number | boolean | null> = {};
    const errors: Record<string, string> = {};
    for (const f of MODAL_FIELDS) {
      if (f.type === 'readonly') continue;
      const current = values[f.field];
      if (current === undefined || current === initialValue(f, app)) continue;

      if (f.field === 'Email' && current) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(current))) {
          errors[f.field] = 'Invalid email format';
          continue;
        }
      }
      if (f.field === 'Phone' && current) {
        const digits = String(current).replace(/\D/g, '');
        if (digits.length !== 10) {
          errors[f.field] = 'Phone must be exactly 10 digits';
          continue;
        }
        changes[f.field] = digits;
        continue;
      }
      if ((f.field === 'emc' || f.field === 'DOT') && current) {
        if (!/^\d+$/.test(String(current))) {
          errors[f.field] = `${f.label} must be digits only`;
          continue;
        }
      }
      if (f.field === 'Credit_Score' && current !== '') {
        const n = Number(current);
        if (Number.isNaN(n) || n < 1 || n > 100) {
          errors[f.field] = 'CreditSafe Score must be between 1 and 100';
          continue;
        }
      }

      if (f.type === 'boolean') changes[f.field] = current === true;
      else if (f.type === 'number') changes[f.field] = current === '' ? null : Number(current);
      else changes[f.field] = current === '' ? null : String(current);
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    if (Object.keys(changes).length === 0) return;

    setSaving(true);
    setSaveError('');
    try {
      const res = await saveApplication(app.id, changes);
      onSaved(res.warning);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  /** Keep an unknown live value selectable (picklists drift across the org). */
  function optionsFor(f: ModalField): string[] {
    const opts = f.options ?? [];
    const current = String(values[f.field] ?? '');
    return current && !opts.includes(current) ? [...opts, current] : opts;
  }

  const hasErrors = Object.keys(fieldErrors).length > 0;

  return (
    <div
      className="cs-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="cs-modal-box cs-modal-wide" ref={boxRef} tabIndex={-1}>
        <div className="cs-modal-header">
          <h3 className="cs-modal-title">
            {app.company || 'Record'}
            {(() => {
              const idValue = subTab === 'clients' ? app.carrierId : app.appId;
              const idLabel = subTab === 'clients' ? 'Carrier ID' : 'Application ID';
              if (!idValue) return null;
              return (
                <button
                  type="button"
                  className="cs-modal-id-copy"
                  title={`Click to copy ${idLabel}`}
                  onClick={(e) => copyWithToast(idValue, e)}
                >
                  {idValue}
                </button>
              );
            })()}
          </h3>
          <button className="cs-modal-close" onClick={requestClose}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cs-modal-body">
          {/* Save error banner */}
          {saveError ? <div className="cs-form-error">{saveError}</div> : null}

          {/* Field validation banner */}
          {hasErrors ? (
            <div className="cs-form-error">
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Please fix:</div>
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                {Object.entries(fieldErrors).map(([field, msg]) => (
                  <li key={field}>{msg}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Two-column form */}
          <div className="cs-form-grid">
            {MODAL_FIELDS.map((f) => (
              <div
                key={f.field}
                className={`cs-form-field${f.type === 'textarea' ? ' cs-form-field-wide' : ''}`}
              >
                <label className="cs-form-label">{f.label}</label>

                {f.type === 'readonly' ? (
                  <div className="cs-form-readonly">{readonlyText(f, app)}</div>
                ) : f.type === 'textarea' ? (
                  <textarea
                    rows={3}
                    className="cs-form-input"
                    value={String(values[f.field] ?? '')}
                    onChange={(e) => set(f.field, e.target.value)}
                  />
                ) : f.type === 'picklist' ? (
                  <select
                    className="cs-form-input"
                    value={String(values[f.field] ?? '')}
                    onChange={(e) => set(f.field, e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {optionsFor(f).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'boolean' ? (
                  <label className="cs-form-checkbox">
                    <input
                      type="checkbox"
                      checked={values[f.field] === true}
                      onChange={(e) => set(f.field, e.target.checked)}
                    />
                    <span>{values[f.field] === true ? 'Yes' : 'No'}</span>
                  </label>
                ) : f.field === 'Email' ? (
                  <input
                    type="email"
                    className="cs-form-input"
                    value={String(values[f.field] ?? '')}
                    onChange={(e) => set(f.field, e.target.value)}
                  />
                ) : f.field === 'Phone' ? (
                  <input
                    type="tel"
                    className="cs-form-input"
                    maxLength={20}
                    value={String(values[f.field] ?? '')}
                    onChange={(e) => set(f.field, e.target.value)}
                  />
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : 'text'}
                    step={f.type === 'number' ? 'any' : undefined}
                    className="cs-form-input"
                    value={String(values[f.field] ?? '')}
                    onChange={(e) => set(f.field, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="cs-modal-footer">
          {dirtyCount > 0 ? (
            <span className="cs-dirty-indicator">
              {dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}
            </span>
          ) : null}
          <button className="cs-btn cs-btn-ghost" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="cs-btn cs-btn-primary"
            onClick={() => void save()}
            disabled={saving || dirtyCount === 0}
          >
            {saving ? (
              <svg className="spin-icon" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={SPINNER_PATH} />
              </svg>
            ) : null}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
