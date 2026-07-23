/**
 * ChaseAddModal — manual entry for a Chase deposit. Chase is the one payment source with no email
 * (Zapier) or API feed, so agents key it in from the bank statement. Posts to
 * /billing/transactions/manual → lands UNMAPPED in payment_transactions (source='chase'), then
 * follows the same map/unmap lifecycle as any ingested payment.
 */
import { useState, type ReactNode } from 'react';

import { addManualChaseTransaction } from '@/api/billing';

const CLOSE_ICON = 'M6 18L18 6M6 6l12 12';

interface ChaseAddModalProps {
  onClose: () => void;
  /** Called after a successful add so the parent can refresh the list. */
  onAdded: (msg: string) => void;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: string;
  children: ReactNode;
}) {
  return (
    <div className="chase-field">
      <span className="chase-label">
        {label}
        {required ? <span className="chase-req">*</span> : null}
        {optional ? <span className="chase-opt">{optional}</span> : null}
      </span>
      {children}
    </div>
  );
}

export function ChaseAddModal({ onClose, onAdded }: ChaseAddModalProps) {
  const [amount, setAmount] = useState('');
  const [postingDate, setPostingDate] = useState(todayYmd());
  const [senderName, setSenderName] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // A duplicate reference is an informational "already recorded" (amber), not a hard error (red).
  const [notice, setNotice] = useState<{ kind: 'error' | 'duplicate'; message: string } | null>(null);

  const amountNum = Number(amount.replace(/[^0-9.\-]/g, ''));
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const valid = amountValid && !!postingDate;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await addManualChaseTransaction({
        amount: amountNum,
        postingDate,
        senderName: senderName.trim() || undefined,
        description: description.trim() || undefined,
        reference: reference.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      if (res.status === 'duplicate') {
        setNotice({ kind: 'duplicate', message: res.message || 'A transaction with this reference already exists — not added.' });
        setSubmitting(false);
        return;
      }
      if (res.status !== 'success') {
        setNotice({ kind: 'error', message: res.message || 'Could not add the transaction.' });
        setSubmitting(false);
        return;
      }
      onAdded(`Chase deposit added: $${amountNum.toFixed(2)}`);
      onClose();
    } catch (e) {
      setNotice({ kind: 'error', message: e instanceof Error ? e.message : 'Could not add the transaction.' });
      setSubmitting(false);
    }
  }

  return (
    <div className="bm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div className="bm-modal-box" style={{ maxWidth: 480 }}>
        <div className="bm-modal-header">
          <div className="bm-modal-title">
            Add Chase Transaction
            <span className="tx-source-badge tx-source-chase" style={{ marginLeft: '0.5rem' }}>
              CHASE
            </span>
          </div>
          <button className="bm-modal-close" onClick={onClose} disabled={submitting}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={CLOSE_ICON} />
            </svg>
          </button>
        </div>

        <div className="bm-modal-body">
          <div className="chase-form">
            <div className="chase-intro">
              Key in a Chase deposit from the bank statement. It lands <b>unmapped</b> in Transactions,
              where you map it to an invoice or prepay like any other payment.
            </div>

            {/* Required, grouped up top */}
            <div className="chase-row-2">
              <Field label="Amount" required>
                <div className="chase-amount">
                  <span className="chase-cur">$</span>
                  <input
                    className="chase-input"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && valid) void submit();
                    }}
                    placeholder="0.00"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                </div>
              </Field>
              <Field label="Posting Date" required>
                <input
                  className="chase-input"
                  type="date"
                  value={postingDate}
                  onChange={(e) => setPostingDate(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Sender / Payer" optional="recommended — used to auto-suggest the carrier">
              <input
                className="chase-input"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Name on the deposit, e.g. SUNRISE LOGISTICS LLC"
              />
            </Field>

            <div className="chase-optional-head">Optional details</div>

            <Field label="Description">
              <input
                className="chase-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Statement description / memo line"
              />
            </Field>

            <div className="chase-row-2">
              <Field label="Reference / Txn ID" optional="prevents duplicates">
                <input
                  className={`chase-input${notice?.kind === 'duplicate' ? ' is-dup' : ''}`}
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    if (notice) setNotice(null); // editing the reference clears the duplicate/error notice
                  }}
                  placeholder="Check # or Chase id"
                />
              </Field>
              <Field label="Memo">
                <input
                  className="chase-input"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Internal note"
                />
              </Field>
            </div>

            {notice ? (
              <div className={`bm-notice bm-notice--${notice.kind}`} role="alert">
                {notice.kind === 'duplicate' ? (
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                )}
                <div>
                  <div className="bm-notice-title">{notice.kind === 'duplicate' ? 'Already recorded' : 'Could not add'}</div>
                  <div className="bm-notice-msg">{notice.message}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bm-modal-footer">
          <button className="bm-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="bm-btn bm-btn-primary"
            onClick={() => void submit()}
            disabled={!valid || submitting}
          >
            {submitting ? 'Adding…' : 'Add Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
