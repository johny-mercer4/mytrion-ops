/**
 * Citifuel client create/edit form — the widget's sectioned modal (Client / Request /
 * Contact / Notes) over POST//PATCH /cs/citifuel. Picklists merge the widget's canonical
 * options with live CRM metadata; Company is an Accounts typeahead, Agent/Owner are user
 * selects. Lookup values are written as {id} objects (Zoho REST contract).
 */
import { useEffect, useState } from 'react';

import {
  createCitifuel,
  getCitifuelMeta,
  lookupAccounts,
  lookupUsers,
  updateCitifuel,
  type CitiWriteValue,
} from '@/api/cs';
import { Button } from '@/components/ui/button';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import type { CitiRow } from './live';

const CANONICAL = {
  Request: ['Outbound', 'Incoming'],
  Status_of_App: ['In process', 'Cards sent', 'Closed'],
  Actions_taken: ['Request Citi to check', 'Agent Call'],
  // lockOptions in the widget — keep these exact lists, live meta must not overwrite.
  Final_Decision: ['Octane', 'Citifuel', 'None'],
  Billing_Notes: ['Payment Issues', 'Debtor', 'Collection', 'Good Standing'],
} as const;

const inputCls =
  'w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/55';

interface UserOpt {
  id: string;
  name: string | null;
}

export function CitiEdit({
  client,
  onClose,
  onSaved,
}: {
  /** null = create */
  client: CitiRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const raw = client?.raw ?? {};
  const lookupId = (v: unknown): string => (v && typeof v === 'object' ? String((v as { id?: unknown }).id ?? '') : '');
  const [values, setValues] = useState<Record<string, string>>(() => ({
    Name: String(raw.Name ?? ''),
    App_ID: raw.App_ID == null ? '' : String(raw.App_ID),
    Request: String(raw.Request ?? ''),
    Status_of_App: String(raw.Status_of_App ?? ''),
    Actions_taken: String(raw.Actions_taken ?? ''),
    Final_Decision: String(raw.Final_Decision ?? ''),
    Billing_Notes: String(raw.Billing_Notes ?? ''),
    Date_of_Request: String(raw.Date_of_Request ?? '').slice(0, 10),
    Feedback_date: String(raw.Feedback_date ?? '').slice(0, 10),
    Email: String(raw.Email ?? ''),
    Phone_Number: String(raw.Phone_Number ?? ''),
    Notes_1: String(raw.Notes_1 ?? ''),
    Company_Name: lookupId(raw.Company_Name),
    Agent_Name: lookupId(raw.Agent_Name),
    Owner: lookupId(raw.Owner),
  }));
  const [statusOptions, setStatusOptions] = useState<string[]>([...CANONICAL.Status_of_App]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [accountQuery, setAccountQuery] = useState('');
  const [accounts, setAccounts] = useState<Array<{ id: string; Account_Name?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCitifuelMeta()
      .then((m) => m.statusOptions.length && setStatusOptions(m.statusOptions))
      .catch(() => undefined);
    lookupUsers()
      .then((u) => setUsers(u.users))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (accountQuery.trim().length < 2) return;
    const t = setTimeout(() => {
      lookupAccounts(accountQuery.trim())
        .then((r) => setAccounts(r.accounts))
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
        if (client) data[field] = null; // clearing on edit; skip empties on create
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
      else if (client) data[lk] = null;
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

  const pick = (field: keyof typeof CANONICAL, options: readonly string[]) => (
    <select className={inputCls} value={values[field] ?? ''} onChange={(e) => set(field, e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={client ? `Edit — ${client.name}` : 'New CITI Fuel Client'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : client ? 'Save Changes' : 'Create Client'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="rounded-md border border-bad/30 bg-bad/10 p-2.5 text-sm text-bad">{error}</div>
        ) : null}

        <Section label="Client">
          <Field label="Client Name *">
            <input className={inputCls} value={values.Name} onChange={(e) => set('Name', e.target.value)} />
          </Field>
          <Field label="App ID">
            <input className={inputCls} type="number" value={values.App_ID} onChange={(e) => set('App_ID', e.target.value)} />
          </Field>
          <Field label="Company (Accounts)" wide>
            <input
              className={inputCls}
              placeholder="Type to search accounts…"
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
            />
            {accounts.length > 0 ? (
              <select className={`${inputCls} mt-1.5`} value={values.Company_Name} onChange={(e) => set('Company_Name', e.target.value)}>
                <option value="">— none —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.Account_Name ?? a.id}
                  </option>
                ))}
              </select>
            ) : null}
          </Field>
        </Section>

        <Section label="Request">
          <Field label="Request">{pick('Request', CANONICAL.Request)}</Field>
          <Field label="Status of App">{pick('Status_of_App', statusOptions)}</Field>
          <Field label="Actions Taken">{pick('Actions_taken', CANONICAL.Actions_taken)}</Field>
          <Field label="Final Decision">{pick('Final_Decision', CANONICAL.Final_Decision)}</Field>
          <Field label="Billing Notes">{pick('Billing_Notes', CANONICAL.Billing_Notes)}</Field>
          <Field label="Date of Request">
            <input className={inputCls} type="date" value={values.Date_of_Request} onChange={(e) => set('Date_of_Request', e.target.value)} />
          </Field>
          <Field label="Feedback Date">
            <input className={inputCls} type="date" value={values.Feedback_date} onChange={(e) => set('Feedback_date', e.target.value)} />
          </Field>
        </Section>

        <Section label="Contact">
          <Field label="Email">
            <input className={inputCls} value={values.Email} onChange={(e) => set('Email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={values.Phone_Number} onChange={(e) => set('Phone_Number', e.target.value)} />
          </Field>
          <Field label="Agent">
            <UserSelect users={users} value={values.Agent_Name ?? ''} onChange={(v) => set('Agent_Name', v)} />
          </Field>
          <Field label="Owner">
            <UserSelect users={users} value={values.Owner ?? ''} onChange={(v) => set('Owner', v)} />
          </Field>
        </Section>

        <Section label="Notes">
          <Field label="Notes" wide>
            <textarea className={`${inputCls} min-h-20`} value={values.Notes_1} onChange={(e) => set('Notes_1', e.target.value)} />
          </Field>
        </Section>
      </div>
    </DetailDialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="font-heading mb-2 text-xs font-bold tracking-wide text-primary uppercase">{label}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? 'sm:col-span-2' : undefined}>
      <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function UserSelect({
  users,
  value,
  onChange,
}: {
  users: UserOpt[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name ?? u.id}
        </option>
      ))}
    </select>
  );
}
