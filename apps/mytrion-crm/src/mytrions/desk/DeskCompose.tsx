import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button, Dialog, Input, Select, Tabs, Textarea, type SelectOption } from '@/ds';
import {
  createEscalation,
  createTicket,
  getCommsCatalog,
  uploadThreadAttachment,
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
 * (ticket, by department) and the escalation ladder (by reason) fire server-side. An optional file or
 * image is uploaded to the new conversation after it is created, so it lands in Dropbox. On success the
 * parent opens the new item live in the console.
 *
 * A ticket routes by DEPARTMENT (which filters the ticket-type list) and is filed against a Zoho deal;
 * an escalation routes by REASON alone. Ticket creation is Sales-gated + deal-bound server-side; the
 * form surfaces a clear error if the caller may not file one.
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
  // ticket
  const [ticketDepartment, setTicketDepartment] = useState<string | null>(null);
  const [typeCode, setTypeCode] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  // escalation
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  // shared
  const [file, setFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitLatch = useRef(false);

  // Load the catalog + deals, and reset the form, each time the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSubject('');
    setDescription('');
    setTicketDepartment(null);
    setTypeCode(null);
    setDealId(null);
    setPriority(null);
    setCardNumber('');
    setReasonCode(null);
    setFile(null);
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

  const departmentOpts = useMemo<SelectOption[]>(
    () =>
      (catalog?.departments ?? [])
        .filter((d) => d.acceptsTickets)
        .map((d) => ({ value: d.department, label: d.label || d.department })),
    [catalog],
  );
  // Ticket types belong to a department (C-* Customer Service, Q-* Billing, V-* Verification, …), so
  // the type list is the picked department's types — the department picker drives it.
  const ticketTypeOpts = useMemo<SelectOption[]>(
    () =>
      ticketDepartment
        ? (catalog?.ticketTypes ?? [])
            .filter((t) => t.targetDepartment === ticketDepartment)
            .map((t) => ({ value: t.code, label: `${t.code} · ${t.label}` }))
        : [],
    [catalog, ticketDepartment],
  );
  const reasonOpts = useMemo<SelectOption[]>(
    () => (catalog?.escalationReasons ?? []).map((r) => ({ value: r.code, label: r.label })),
    [catalog],
  );

  const canSubmit =
    kind === 'ticket'
      ? Boolean(ticketDepartment && typeCode && dealId && subject.trim() && description.trim())
      : Boolean(reasonCode && subject.trim() && description.trim());

  const submit = useCallback(async () => {
    if (!canSubmit || submitting || submitLatch.current) return;
    submitLatch.current = true;
    setSubmitting(true);
    setError('');
    const idempotencyKey = crypto.randomUUID();
    try {
      let threadId: string;
      let result: DeskComposeResult;
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
        threadId = ticket.threadId;
        result = { kind: 'ticket', ticketId: ticket.id };
      } else if (kind === 'escalation' && reasonCode) {
        const escalation = await createEscalation({
          reasonCode,
          subject: subject.trim(),
          description: description.trim(),
          sourceMytrion: 'desk',
          idempotencyKey,
        });
        threadId = escalation.threadId;
        result = { kind: 'escalation', ticketId: escalation.escalation.ticketId };
      } else {
        return;
      }
      // The item exists now; attach the file to its conversation (→ Dropbox). Best-effort — a failed
      // upload must not lose the ticket/escalation the user just filed; they can re-attach in the thread.
      if (file) await uploadThreadAttachment(threadId, file, {}).catch(() => undefined);
      onCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      submitLatch.current = false;
    }
  }, [canSubmit, submitting, kind, typeCode, dealId, subject, description, priority, cardNumber, reasonCode, file, onCreated]);

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
              <span className={styles.fieldLabel}>Department</span>
              <Select
                label="Department"
                labelHidden
                options={departmentOpts}
                value={ticketDepartment}
                onChange={(v) => {
                  setTicketDepartment(v);
                  setTypeCode(null);
                }}
                placeholder="Choose a department"
                loading={!catalog && !catalogError}
                emptyLabel="No departments configured"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Ticket type</span>
              <Select
                label="Ticket type"
                labelHidden
                options={ticketTypeOpts}
                value={typeCode}
                onChange={setTypeCode}
                placeholder={ticketDepartment ? 'Choose a type' : 'Choose a department first'}
                disabled={!ticketDepartment}
                emptyLabel="No ticket types for this department"
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
                rows={4}
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
                emptyLabel="No escalation reasons configured"
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
                rows={4}
                placeholder="What's the issue, and any context…"
              />
            </label>
          </>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Attachment (optional)</span>
          {file ? (
            <div className={styles.attachChip}>
              <Paperclip size={14} aria-hidden="true" />
              <span className={styles.attachChipName}>{file.name}</span>
              <button
                type="button"
                className={styles.attachChipRemove}
                onClick={() => setFile(null)}
                aria-label="Remove attachment"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <label className={styles.attachPick}>
              <input
                type="file"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  e.currentTarget.value = '';
                }}
              />
              <Paperclip size={14} aria-hidden="true" />
              Choose a file or image
            </label>
          )}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
