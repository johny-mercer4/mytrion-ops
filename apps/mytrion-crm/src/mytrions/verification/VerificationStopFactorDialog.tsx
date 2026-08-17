import { useEffect, useRef, useState } from 'react';
import { Equal, Hash, Route } from 'lucide-react';
import { Button } from '../../ds/Button/Button';
import { Dialog } from '../../ds/Dialog';
import {
  saveStopFactor,
  type StopFactorAction,
  type StopFactorCheckType,
  type StopFactorOperator,
  type StopFactorRow,
  type StopFactorStage,
  type StopFactorWrite,
} from '../../api/verificationStrategies';

const STAGES: { id: StopFactorStage; label: string }[] = [
  { id: 'pre', label: 'Pre-check' },
  { id: 'decision', label: 'Decision' },
  { id: 'post', label: 'Post-check' },
];
const CHECKS: { id: StopFactorCheckType; label: string }[] = [
  { id: 'field_check', label: 'Field value' },
  { id: 'blacklist', label: 'Blacklist' },
  { id: 'sql_query', label: 'SQL query' },
];
const OPS: { id: StopFactorOperator; label: string }[] = [
  { id: 'gte', label: 'at least' },
  { id: 'lte', label: 'at most' },
  { id: 'gt', label: 'greater than' },
  { id: 'lt', label: 'less than' },
  { id: 'eq', label: 'equals' },
  { id: 'neq', label: 'does not equal' },
  { id: 'not_in', label: 'is not one of' },
  { id: 'contains', label: 'contains' },
];
const ACTIONS: { id: StopFactorAction; label: string }[] = [
  { id: 'APPROVE', label: 'Approve' },
  { id: 'REJECT', label: 'Reject' },
  { id: 'REVIEW', label: 'Review' },
];

function isIntake(meta: Record<string, unknown> | undefined): boolean {
  return meta?.apply_at_zoho_intake === true;
}

function draftFrom(row: StopFactorRow | null, stage: StopFactorStage | ''): StopFactorWrite {
  if (row) {
    return {
      name: row.name,
      stage: (STAGES.some((s) => s.id === row.stage) ? row.stage : 'pre') as StopFactorStage,
      check_type: (CHECKS.some((c) => c.id === row.check_type) ? row.check_type : 'field_check') as StopFactorCheckType,
      field_path: row.field_path,
      operator: (OPS.some((op) => op.id === row.operator) ? row.operator : 'gte') as StopFactorOperator,
      threshold: row.threshold,
      action_on_fail: (ACTIONS.some((a) => a.id === row.action_on_fail)
        ? row.action_on_fail
        : 'REJECT') as StopFactorAction,
      action_on_missing: row.action_on_missing === 'REJECT' || row.action_on_missing === 'REVIEW'
        ? row.action_on_missing
        : 'PASS',
      provider_filter: row.provider_filter,
      enabled: row.enabled,
      priority: row.priority,
      apply_at_zoho_intake: isIntake(row.meta),
      meta: row.meta,
    };
  }
  return {
    name: '',
    stage: stage === 'decision' || stage === 'post' ? stage : 'pre',
    check_type: 'field_check',
    field_path: '',
    operator: 'gte',
    threshold: '',
    action_on_fail: 'REJECT',
    action_on_missing: 'PASS',
    provider_filter: '',
    enabled: true,
    priority: 0,
    apply_at_zoho_intake: false,
  };
}

export function VerificationStopFactorDialog({
  open,
  row,
  defaultStage,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: StopFactorRow | null;
  defaultStage: StopFactorStage | '';
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<StopFactorWrite>(() => draftFrom(row, defaultStage));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedFor = useRef<string | null>(null);
  const existing = row != null;

  useEffect(() => {
    if (!open) {
      openedFor.current = null;
      return;
    }
    const key = row ? String(row.id) : `new:${defaultStage}`;
    if (openedFor.current === key) return;
    openedFor.current = key;
    setDraft(draftFrom(row, defaultStage));
    setError(null);
  }, [open, row, defaultStage]);

  const set = <K extends keyof StopFactorWrite>(key: K, value: StopFactorWrite[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (): Promise<void> => {
    if (!draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveStopFactor(
        {
          ...draft,
          field_path: draft.field_path?.trim() || null,
          threshold: draft.threshold?.trim() || null,
          provider_filter: draft.provider_filter?.trim() || null,
        },
        existing ? row.id : undefined,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save stop factor');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title={existing ? draft.name.trim() || 'Edit stop factor' : 'New stop factor'}
      subtitle="Applies on the next run."
      size="md"
      mobile="sheet"
      initialFocusRef={firstRef}
      footer={
        <div className="vf-case-actions">
          <Button variant="secondary" onClick={() => onClose()} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {existing ? 'Save changes' : 'Create rule'}
          </Button>
        </div>
      }
    >
      {error ? (
        <p className="vf-banner-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="vf-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="vf-form-section">
          <h3>Rule</h3>
          <label className="vf-form-row">
            <span>Name</span>
            <input ref={firstRef} value={draft.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <div className="vf-form-grid">
            <label className="vf-form-row">
              <span>Stage</span>
              <select value={draft.stage} onChange={(e) => set('stage', e.target.value as StopFactorStage)}>
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="vf-form-row">
              <span>Priority</span>
              <input
                type="number"
                min={0}
                value={draft.priority}
                onChange={(e) => set('priority', Number(e.target.value) || 0)}
              />
            </label>
          </div>
          <label className="vf-form-row is-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <span>Active</span>
          </label>
        </section>

        <section className="vf-form-section">
          <h3>What to check</h3>
          <label className="vf-form-row">
            <span>Check type</span>
            <select
              value={draft.check_type}
              onChange={(e) => set('check_type', e.target.value as StopFactorCheckType)}
            >
              {CHECKS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="vf-form-row">
            <span>
              <Route size={12} aria-hidden="true" /> Path
            </span>
            <input
              value={draft.field_path ?? ''}
              onChange={(e) => set('field_path', e.target.value)}
              placeholder="result.parsed_report.summary.credit_score"
            />
          </label>
          {draft.check_type === 'field_check' ? (
            <div className="vf-form-grid">
              <label className="vf-form-row">
                <span>
                  <Equal size={12} aria-hidden="true" /> Operator
                </span>
                <select
                  value={draft.operator}
                  onChange={(e) => set('operator', e.target.value as StopFactorOperator)}
                >
                  {OPS.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vf-form-row">
                <span>
                  <Hash size={12} aria-hidden="true" /> Value
                </span>
                <input value={draft.threshold ?? ''} onChange={(e) => set('threshold', e.target.value)} />
              </label>
            </div>
          ) : null}
          {draft.check_type === 'sql_query' ? (
            <label className="vf-form-row">
              <span>Query</span>
              <textarea
                value={draft.threshold ?? ''}
                onChange={(e) => set('threshold', e.target.value)}
                placeholder="SELECT 1 FROM my_table WHERE ssn = '{value}'"
              />
            </label>
          ) : null}
        </section>

        <section className="vf-form-section">
          <h3>When it fails</h3>
          <div className="vf-form-grid">
            <label className="vf-form-row">
              <span>{draft.stage === 'decision' ? 'Desk column' : 'On fail'}</span>
              <select
                value={draft.action_on_fail}
                onChange={(e) => set('action_on_fail', e.target.value as StopFactorAction)}
              >
                {ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="vf-form-row">
              <span>If missing</span>
              <select
                value={draft.action_on_missing}
                onChange={(e) =>
                  set('action_on_missing', e.target.value as StopFactorWrite['action_on_missing'])
                }
              >
                <option value="PASS">Pass</option>
                <option value="REJECT">Reject</option>
                <option value="REVIEW">Review</option>
              </select>
            </label>
          </div>
          {draft.stage === 'pre' ? (
            <label className="vf-form-row is-check">
              <input
                type="checkbox"
                checked={Boolean(draft.apply_at_zoho_intake)}
                onChange={(e) => set('apply_at_zoho_intake', e.target.checked)}
              />
              <span>Apply at Zoho intake (drop before the request is created)</span>
            </label>
          ) : null}
        </section>
      </form>
    </Dialog>
  );
}
