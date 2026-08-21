/**
 * The hand-maintained blocks of a collection case: which agency holds it, where it is in court,
 * what a human has verified about the debtor, and how it ended.
 *
 * READ FIRST, EDIT SECOND. A collector opens this record twenty times to read it and twice to
 * change it, so the default is a dense fact grid and editing is a deliberate switch. Always-live
 * inputs would also mean every stray click is a write to a debt record.
 *
 * ONE SAVE for all four blocks. They are filled in together — you learn the court date and the
 * verified phone number on the same call — and four endpoints would mean four round trips and a
 * half-saved record if the third failed.
 *
 * The MONEY is not here. It lives in the rail's Debt pane, beside the debt the fee is a percentage
 * of — it used to sit at the bottom of this panel, which put "remaining" on screen three times and
 * stranded the agency fee two columns away from the figure it derives from.
 */
import { useState } from 'react';
import { Button, DateField, Input, Select, Switch, useToast } from '@/ds';
import {
  AGENCY_RESPONSE_STATUSES,
  CAINE_WEINER_TIERS,
  COLLECTION_AGENCIES,
  COLLECTION_LOSS_REASONS,
  COOPERATION_STATUSES,
  COURT_STATUSES,
  COURT_TYPES,
  type CollectionCaseRow,
} from '@/api/collection';
import { patchCaseFields, type CaseFieldPatch } from '@/api/collectionDesk';
import { fmtDate, moneyExact } from '../../collectionFormat';

const opts = (values: readonly string[], blank: string) => [
  { value: '', label: blank },
  ...values.map((v) => ({ value: v, label: v })),
];

/** `null` for a cleared select, so the patch clears the column rather than writing an empty string. */
const orNull = (v: string | null | undefined): string | null => (v && v.length > 0 ? v : null);

export function CaseFields({ row, onSaved }: { row: CollectionCaseRow; onSaved: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CaseFieldPatch>({});

  const set = <K extends keyof CaseFieldPatch>(key: K, value: CaseFieldPatch[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  /** The draft value if the field has been touched, otherwise what is on the record. */
  function val<K extends keyof CaseFieldPatch & keyof CollectionCaseRow>(key: K): string {
    const drafted = draft[key];
    if (drafted !== undefined) return (drafted as string | null) ?? '';
    return ((row[key] as string | null) ?? '') as string;
  }
  function flag(key: keyof CaseFieldPatch & keyof CollectionCaseRow): boolean {
    const drafted = draft[key];
    if (drafted !== undefined) return Boolean(drafted);
    return Boolean(row[key]);
  }

  const start = (): void => {
    setDraft({});
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await patchCaseFields(row.id, draft);
      toast({ intent: 'success', title: 'Case updated' });
      setEditing(false);
      setDraft({});
      onSaved();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not save the case', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cc-pane cf-pane">
      <header className="cc-pane-head">
        <h2 className="cc-pane-title">Case detail</h2>
        {editing ? (
          <span className="cf-actions">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="check"
              loading={saving}
              disabled={saving || Object.keys(draft).length === 0}
              onClick={() => void save()}
            >
              Save
            </Button>
          </span>
        ) : (
          <Button variant="secondary" size="sm" icon="edit" onClick={start}>
            Edit
          </Button>
        )}
      </header>

      <div className="cf-blocks">
        <Block title="Agency">
          {editing ? (
            <>
              <Select
                label="Current agency"
                value={val('currentAgency')}
                onChange={(v) => set('currentAgency', orNull(v))}
                options={opts(COLLECTION_AGENCIES, 'Unplaced')}
              />
              {val('currentAgency') === 'Caine & Weiner' ? (
                <Select
                  label="Tier"
                  value={val('caineWeinerTier')}
                  onChange={(v) => set('caineWeinerTier', orNull(v))}
                  options={opts(CAINE_WEINER_TIERS, 'Not graded')}
                />
              ) : null}
              <Select
                label="Agency response"
                value={val('agencyResponseStatus')}
                onChange={(v) => set('agencyResponseStatus', orNull(v))}
                options={opts(AGENCY_RESPONSE_STATUSES, 'None yet')}
              />
            </>
          ) : (
            <>
              <Fact k="Current agency" v={row.currentAgency ?? 'Unplaced'} />
              <Fact k="First agency" v={row.firstCollectionAgency ?? '—'} />
              {row.secondCollectionAgency ? (
                <Fact k="Second agency" v={row.secondCollectionAgency} />
              ) : null}
              {row.caineWeinerTier ? <Fact k="Tier" v={row.caineWeinerTier} /> : null}
              <Fact k="Response" v={row.agencyResponseStatus ?? '—'} />
              <Fact k="Placed" v={fmtDate(row.placementDate)} />
            </>
          )}
        </Block>

        <Block title="Legal">
          {editing ? (
            <>
              <Switch
                label="Legal action required"
                checked={flag('legalActionRequired')}
                onChange={(e) => set('legalActionRequired', e.currentTarget.checked)}
              />
              <Select
                label="Court"
                value={val('courtType')}
                onChange={(v) => set('courtType', orNull(v))}
                options={opts(COURT_TYPES, 'Not in court')}
              />
              <Select
                label="Court status"
                value={val('courtStatus')}
                onChange={(v) => set('courtStatus', orNull(v))}
                options={opts(COURT_STATUSES, '—')}
              />
              <label className="ca-field">
                <span className="ca-label">Filing date</span>
                <DateField
                  value={val('legalFilingDate') || null}
                  onChange={(v) => set('legalFilingDate', v)}
                />
              </label>
              <Switch
                label="Documents attached"
                checked={flag('legalDocumentsAttached')}
                onChange={(e) => set('legalDocumentsAttached', e.currentTarget.checked)}
              />
            </>
          ) : (
            <>
              <Fact k="Legal action" v={row.legalActionRequired ? 'Required' : 'Not required'} />
              <Fact k="Court" v={row.courtType ?? '—'} />
              <Fact k="Court status" v={row.courtStatus ?? '—'} />
              <Fact k="Filed" v={fmtDate(row.legalFilingDate)} />
              <Fact k="Documents" v={row.legalDocumentsAttached ? 'Attached' : 'None'} />
            </>
          )}
        </Block>

        <Block
          title="Verified contact"
          hint="What a person confirmed on a call. The debtor block above is overwritten from the Deal every half hour."
        >
          {editing ? (
            <>
              <Switch
                label="Skip trace required"
                checked={flag('skipTraceRequired')}
                onChange={(e) => set('skipTraceRequired', e.currentTarget.checked)}
              />
              <label className="ca-field">
                <span className="ca-label">Verified phone</span>
                <Input
                  fullWidth
                  value={val('verifiedPhone')}
                  onChange={(e) => set('verifiedPhone', orNull(e.currentTarget.value))}
                />
              </label>
              <label className="ca-field">
                <span className="ca-label">Verified email</span>
                <Input
                  fullWidth
                  type="email"
                  value={val('verifiedEmail')}
                  onChange={(e) => set('verifiedEmail', orNull(e.currentTarget.value))}
                />
              </label>
              <label className="ca-field">
                <span className="ca-label">Verified address</span>
                <Input
                  fullWidth
                  value={val('verifiedAddress')}
                  onChange={(e) => set('verifiedAddress', orNull(e.currentTarget.value))}
                />
              </label>
            </>
          ) : (
            <>
              <Fact k="Skip trace" v={row.skipTraceRequired ? 'Required' : 'Not required'} />
              <Fact k="Phone" v={row.verifiedPhone ?? '—'} />
              <Fact k="Email" v={row.verifiedEmail ?? '—'} />
              <Fact k="Address" v={row.verifiedAddress ?? '—'} />
            </>
          )}
        </Block>

        <Block title="Disposition">
          {editing ? (
            <>
              <Select
                label="Cooperation"
                value={val('cooperationStatus')}
                onChange={(v) => set('cooperationStatus', orNull(v))}
                options={opts(COOPERATION_STATUSES, 'Not recorded')}
              />
              <Select
                label="Loss reason"
                value={val('lossReason')}
                onChange={(v) => set('lossReason', orNull(v))}
                options={opts(COLLECTION_LOSS_REASONS, 'Not lost')}
              />
              <Switch
                label="Escalation required"
                checked={flag('escalationRequired')}
                onChange={(e) => set('escalationRequired', e.currentTarget.checked)}
              />
              <Switch
                label="Payment received"
                checked={flag('paymentReceived')}
                onChange={(e) => set('paymentReceived', e.currentTarget.checked)}
              />
              <label className="ca-field">
                <span className="ca-label">Cost incurred</span>
                <Input
                  fullWidth
                  value={val('totalCostIncurred')}
                  onChange={(e) => set('totalCostIncurred', e.currentTarget.value)}
                />
              </label>
            </>
          ) : (
            <>
              <Fact k="Cooperation" v={row.cooperationStatus ?? '—'} />
              <Fact k="Loss reason" v={row.lossReason ?? '—'} />
              <Fact k="Escalation" v={row.escalationRequired ? 'Required' : 'No'} />
              <Fact k="Payment received" v={row.paymentReceived ? fmtDate(row.paymentReceivedDate) : 'No'} />
              <Fact k="Cost incurred" v={moneyExact(row.totalCostIncurred)} />
            </>
          )}
        </Block>

      </div>
    </section>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cf-block">
      <h3 className="cf-block-title">{title}</h3>
      {hint ? <p className="cf-block-hint">{hint}</p> : null}
      <div className="cf-block-body">{children}</div>
    </div>
  );
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="cf-fact" data-strong={strong ? 'true' : undefined}>
      <span className="cf-fact-k">{k}</span>
      <span className="cf-fact-v num" data-empty={v === '—' ? 'true' : undefined}>
        {v}
      </span>
    </div>
  );
}
