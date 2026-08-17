/**
 * Bulk Love's clearance push (QA feedback, Dina Carter 2026-08-07: agents could only push one
 * record at a time and were copy-pasting to batch 10-20). Rows missing First/Last Name, City or
 * Zip Code can't be selected in the first place (ApplicationsTable disables their checkbox with
 * an explanation) — this bar only ever sees eligible rows, though the backend re-checks anyway.
 */
import { useState } from 'react';
import { bulkSetLovesVerification, type LovesVerificationValue } from '@/api/cs';
import { ConfirmDialog } from '@/ds';
import type { Application } from './data';

export interface LovesBulkSummary {
  succeeded: number;
  failed: number;
  errors: string[];
}

export function LovesBulkBar({
  selected,
  onDone,
  onClear,
}: {
  selected: Application[];
  onDone: (summary: LovesBulkSummary) => void;
  onClear: () => void;
}) {
  const [confirmValue, setConfirmValue] = useState<LovesVerificationValue | null>(null);
  const [pushing, setPushing] = useState(false);

  async function push(value: LovesVerificationValue) {
    setPushing(true);
    try {
      const { results } = await bulkSetLovesVerification(
        selected.map((a) => a.id),
        value,
      );
      const succeeded = results.filter((r) => r.ok).length;
      const errors = results
        .filter((r) => !r.ok)
        .map((r) => {
          const app = selected.find((a) => a.id === r.id);
          return `${app?.company || r.id}: ${r.error ?? 'failed'}`;
        });
      onDone({ succeeded, failed: results.length - succeeded, errors });
    } finally {
      setPushing(false);
      setConfirmValue(null);
    }
  }

  return (
    <div className="cs-loves-bulk-bar" role="region" aria-label="Bulk Love's clearance">
      <span className="cs-loves-bulk-count">
        {selected.length} selected
      </span>
      <span className="cs-loves-bulk-label">Push to Love's:</span>
      <button
        type="button"
        className="cs-btn cs-btn-primary"
        disabled={pushing}
        onClick={() => setConfirmValue('Approved')}
      >
        Approved
      </button>
      <button
        type="button"
        className="cs-btn cs-btn-ghost"
        disabled={pushing}
        onClick={() => setConfirmValue('Not Approved')}
      >
        Not Approved
      </button>
      <button type="button" className="cs-btn cs-btn-ghost" disabled={pushing} onClick={onClear}>
        Clear selection
      </button>

      {confirmValue ? (
        <ConfirmDialog
          open
          tone={confirmValue === 'Not Approved' ? 'danger' : 'default'}
          title={`Mark ${selected.length} ${selected.length === 1 ? 'record' : 'records'} as ${confirmValue}?`}
          body={`This sets Love's Verification = "${confirmValue}" in Zoho on ${
            selected.length === 1 ? 'this record' : `all ${selected.length} selected records`
          }.`}
          confirmLabel={confirmValue}
          cancelLabel="Cancel"
          confirming={pushing}
          onConfirm={() => void push(confirmValue)}
          onClose={() => setConfirmValue(null)}
        />
      ) : null}
    </div>
  );
}
