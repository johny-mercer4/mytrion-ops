import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Input, Select, Tabs, Textarea, type SelectOption } from '@/ds';
import {
  createEscalation,
  createTicket,
  getCommsCatalog,
  type CommsCatalog,
  type TicketPriority,
} from '@/api/comms';
import { listDeals, type CrmRow } from '@/api/dataCenter';
import styles from './desk.module.css';

export type ComposeKind = 'ticket' | 'escalation';

export interface DeskComposeResult {
  kind: ComposeKind;
  /** Ticket id to open in the console — a ticket's own id, or an escalation's backing ticketId. */
  ticketId: string;
}

const PRIORITY_OPTS: SelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

/** Read a string from a raw Zoho COQL field, tolerating the `{ name, id }` lookup shape. */
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'name' in v) {
    const n = (v as { name?: unknown }).name;
    return typeof n === 'string' ? n : '';
  }
  return '';
}

/** A deal option from a raw Zoho row. Null when the row has no numeric CRM id (createTicket needs one). */
function dealOption(row: CrmRow): SelectOption | null {
  const id = str(row.id);
  if (!/^\d+$/.test(id)) return null;
  const main = str(row.Deal_Name) || str(row.Account_Name) || `Deal ${id}`;
  const carrier = str(row.Carrier_ID);
  const app = str(row.Application_ID);
  const tag = carrier ? ` · CR-${carrier}` : app ? ` · App ${app}` : '';
  return { value: id, label: `${main}${tag}` };
}

/**
 * The Desk compose modal — raise a ticket or an escalation against the comms backend, so round-robin
 * (ticket, by department) and the escalation ladder (by reason) fire server-side. On success the
 * parent opens the new item live in the console.
 *
 * Ticket creation is Sales-gated server-side (filing against a Deal is a Sales act) and needs a linked
 * deal; escalation creation is open to any internal worker. The form surfaces a clear error either way.
 */
export function DeskCompose({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: DeskComposeResult) => void;
}) {
  const [kind, setKind] = useState<ComposeKind>('escalation');
  const [catalog, setCatalog] = useState<CommsCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [deals, setDeals] = useState<SelectOption[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [typeCode, setTypeCode] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitLatch = useRef(false);

  // Load the catalog + deals, and reset the form, each time the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSubject('');
    setDescription('');
    setTypeCode(null);
    setDealId(null);
    setPriority(null);
    setCardNumber('');
    setReasonCode(null);
    setDepartment(null);
    setError('');
    setCatalogError('');

    getCommsCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((e) => {
        if (!cancelled) setCatalogError(e instanceof Error ? e.message : String(e));
      });

    setDealsLoading(true);
    listDeals()
      .then((rows) => {
        if (cancelled) return;
        const opts: SelectOption[] = [];
        for (const r of rows) {
          const o = dealOption(r);
          if (o) opts.push(o);
        }
        setDeals(opts);
      })
      .catch(() => {
        if (!cancelled) setDeals([]);
      })
      .finally(() => {
        if (!cancelled) setDealsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const ticketTypeOpts = useMemo<SelectOption[]>(
    () => (catalog?.ticketTypes ?? []).map((t) => ({ value: t.code, label: `${t.code} · ${t.label}` })),
    [catalog],
  );
  const reasonOpts = useMemo<SelectOption[]>(
    () =>
      (catalog?.escalationReasons ?? [])
        .filter((r) => r.routed)
        .map((r) => ({ value: r.code, label: r.label })),
    [catalog],
  );
  const deptOpts = useMemo<SelectOption[]>(
    () =>
      (catalog?.departments ?? [])
        .filter((d) => d.acceptsEscalations)
        .map((d) => ({ value: d.department, label: d.label || d.department })),
    [catalog],
  );

  const canSubmit =
    kind === 'ticket'
      ? Boolean(typeCode && dealId && subject.trim() && description.trim())
      : Boolean(reasonCode && subject.trim() && description.trim());

  const submit = useCallback(async () => {
    if (!canSubmit || submitting || submitLatch.current) return;
    submitLatch.current = true;
    setSubmitting(true);
    setError('');
    const idempotencyKey = crypto.randomUUID();
    try {
      if (kind === 'ticket' && typeCode && dealId) {
        const { ticket } = await createTicket({
          typeCode,
          dealId,
          subject: subject.trim(),
          description: description.trim(),
          ...(priority ? { priority: priority as TicketPriority } : {}),
          ...(cardNumber.trim() ? { cardNumber: cardNumber.trim() } : {}),
          sourceMytrion: 'desk',
          idempotencyKey,
        });
        onCreated({ kind: 'ticket', ticketId: ticket.id });
      } else if (kind === 'escalation' && reasonCode) {
        const { escalation } = await createEscalation({
          reasonCode,
          ...(department ? { targetDepartment: department } : {}),
          subject: subject.trim(),
          description: description.trim(),
          sourceMytrion: 'desk',
          idempotencyKey,
        });
        onCreated({ kind: 'escalation', ticketId: escalation.ticketId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      submitLatch.current = false;
    }
  }, [canSubmit, submitting, kind, typeCode, dealId, subject, description, priority, cardNumber, reasonCode, department, onCreated]);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title="New"
      subtitle="Raise a ticket or an escalation"
      size="md"
      mobile="sheet"
      footer={
        <div className={styles.composeFooter}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={submitting} disabled={!canSubmit}>
            {kind === 'ticket' ? 'Create ticket' : 'Raise escalation'}
          </Button>
        </div>
      }
    >
      <Tabs
        items={[
          { value: 'escalation', label: 'Escalation' },
          { value: 'ticket', label: 'Ticket' },
        ]}
        value={kind}
        onValueChange={(v) => setKind(v as ComposeKind)}
      />

      {catalogError ? (
        <p className={styles.error} role="alert">
          {catalogError}
        </p>
      ) : null}

      <div className={styles.composeForm}>
        {kind === 'ticket' ? (
          <>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Ticket type</span>
              <Select
                label="Ticket type"
                labelHidden
                options={ticketTypeOpts}
                value={typeCode}
                onChange={setTypeCode}
                placeholder="Choose a type"
                loading={!catalog && !catalogError}
                emptyLabel="No ticket types configured"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Deal</span>
              <Select
                label="Deal"
                labelHidden
                options={deals}
                value={dealId}
                onChange={setDealId}
                placeholder="Search a deal…"
                loading={dealsLoading}
                emptyLabel="No deals you can file against"
                message="A client ticket is filed against a Zoho deal (needs Sales access)."
              />
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Subject</span>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of the request" />
            </label>
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Priority</span>
                <Select
                  label="Priority"
                  labelHidden
                  options={PRIORITY_OPTS}
                  value={priority}
                  onChange={setPriority}
                  placeholder="Default"
                  searchable={false}
                  clearable
                />
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Card (optional)</span>
                <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="Card number, if relevant" />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Description</span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="What's needed, which card / driver, and any context…"
              />
            </label>
          </>
        ) : (
          <>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Reason</span>
              <Select
                label="Reason"
                labelHidden
                options={reasonOpts}
                value={reasonCode}
                onChange={setReasonCode}
                placeholder="Choose a reason"
                loading={!catalog && !catalogError}
                emptyLabel="No routed reasons — configure in Mytrion Admin"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Department (optional)</span>
              <Select
                label="Department"
                labelHidden
                options={deptOpts}
                value={department}
                onChange={setDepartment}
                placeholder="Auto by reason"
                clearable
              />
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Subject</span>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of the issue" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Description</span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="What's the issue, and any context…"
              />
            </label>
          </>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
