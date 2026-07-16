/**
 * Application edit form (modal body) — the widget's edit-modal field set, saved through
 * POST /cs/applications/:id (allowlist + casing resolution + Edit_History server-side).
 */
import { useState } from 'react';

import { saveApplication } from '@/api/cs';
import { Button } from '@/components/ui/button';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import type { Application } from './data';

type FieldType = 'text' | 'number' | 'picklist' | 'boolean' | 'textarea';

interface EditField {
  field: string;
  label: string;
  type: FieldType;
  options?: string[];
  get: (a: Application) => string | number | boolean | null;
}

/** Widget-parity picklists (CS_APPS_EXTRA_FIELDS + spreadsheet config). */
const EDIT_FIELDS: EditField[] = [
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
];

const inputCls =
  'w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/55';

export function ApplicationEdit({
  app,
  onClose,
  onSaved,
}: {
  app: Application;
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {};
    for (const f of EDIT_FIELDS) {
      const raw = f.get(app);
      v[f.field] = f.type === 'boolean' ? raw === true : raw == null ? '' : String(raw);
    }
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    // Diff against the initial values so only touched fields hit the backend.
    const changes: Record<string, string | number | boolean | null> = {};
    for (const f of EDIT_FIELDS) {
      const initial = f.type === 'boolean' ? f.get(app) === true : String(f.get(app) ?? '');
      const current = values[f.field];
      if (current === initial) continue;
      if (f.type === 'boolean') changes[f.field] = current === true;
      else if (f.type === 'number') changes[f.field] = current === '' ? null : Number(current);
      else changes[f.field] = current === '' ? null : String(current);
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await saveApplication(app.id, changes);
      onSaved(res.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit — ${app.company}`}
      subtitle={app.appId}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <div className="rounded-md border border-bad/30 bg-bad/10 p-2.5 text-sm text-bad">{error}</div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EDIT_FIELDS.map((f) => (
            <label key={f.field} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
              <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {f.label}
              </span>
              {f.type === 'picklist' ? (
                <select
                  className={inputCls}
                  value={String(values[f.field] ?? '')}
                  onChange={(e) => set(f.field, e.target.value)}
                >
                  <option value="">—</option>
                  {(f.options ?? []).concat(
                    f.options?.includes(String(values[f.field])) || !values[f.field]
                      ? []
                      : [String(values[f.field])],
                  ).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.type === 'boolean' ? (
                <button
                  type="button"
                  onClick={() => set(f.field, values[f.field] !== true)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                    values[f.field] === true ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {values[f.field] === true ? 'Yes' : 'No'}
                </button>
              ) : f.type === 'textarea' ? (
                <textarea
                  className={`${inputCls} min-h-20`}
                  value={String(values[f.field] ?? '')}
                  onChange={(e) => set(f.field, e.target.value)}
                />
              ) : (
                <input
                  className={inputCls}
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={String(values[f.field] ?? '')}
                  onChange={(e) => set(f.field, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      </div>
    </DetailDialog>
  );
}
