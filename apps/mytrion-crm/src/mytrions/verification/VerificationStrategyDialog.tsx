import { useRef, useState } from 'react';
import { Dialog } from '../../ds/Dialog';
import {
  saveDecisionStrategy,
  type DecisionStrategyRow,
  type StrategyLifecycle,
  type StrategyWrite,
} from '../../api/verificationStrategies';

function joinList(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFrom(row: DecisionStrategyRow | null): StrategyWrite {
  if (!row) {
    return {
      id: '',
      title: '',
      enabled: true,
      lifecycle: 'draft',
      priority: 100,
      summary: '',
      outcome: '',
      data_sources: [],
      stage_scope: [],
      decision_actions: [],
      combined_fields: [],
      rule_bindings: [],
      conditions: [],
      logic: '',
    };
  }
  return {
    id: row.id,
    title: row.title,
    enabled: row.enabled,
    lifecycle: (['draft', 'published', 'archived'].includes(row.lifecycle)
      ? row.lifecycle
      : 'draft') as StrategyLifecycle,
    priority: row.priority,
    summary: row.summary,
    outcome: row.outcome,
    data_sources: row.data_sources,
    stage_scope: row.stage_scope,
    decision_actions: row.decision_actions,
    combined_fields: row.combined_fields.map((f) => ({
      label: f.label,
      source: f.source,
      path: f.path,
      required: f.required,
    })),
    rule_bindings: row.rule_bindings,
    conditions: row.conditions.map((c) => ({
      path: c.path,
      operator: c.operator,
      value: c.value,
    })),
    logic: row.logic,
  };
}

export function VerificationStrategyDialog({
  row,
  onClose,
  onSaved,
}: {
  row: DecisionStrategyRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<StrategyWrite>(() => draftFrom(row));
  const [sources, setSources] = useState(() => joinList(row?.data_sources));
  const [stages, setStages] = useState(() => joinList(row?.stage_scope));
  const [actions, setActions] = useState(() => joinList(row?.decision_actions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = row != null;

  const save = async (): Promise<void> => {
    if (!draft.title.trim()) {
      setError('Title is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = draft.id?.trim();
      await saveDecisionStrategy(
        {
          ...draft,
          ...(id ? { id } : {}),
          data_sources: splitList(sources),
          stage_scope: splitList(stages),
          decision_actions: splitList(actions),
          combined_fields: draft.combined_fields.filter((f) => f.path.trim()),
          rule_bindings: draft.rule_bindings.filter((b) => b.category.trim()),
          conditions: draft.conditions.filter((c) => c.path.trim()),
        },
        existing ? row.id : undefined,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save strategy');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => onClose()}
      title={existing ? 'Edit strategy' : 'New strategy'}
      subtitle="Updates system_state.decision_strategies_json — the same record Orchestration writes."
      size="lg"
      mobile="fullscreen"
      initialFocusRef={firstRef}
      footer={
        <div className="vf-case-actions">
          <button type="button" className="ms-btn" onClick={() => onClose()} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="ms-btn is-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save strategy' : 'Create strategy'}
          </button>
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
        <label className="vf-form-row">
          <span>Title</span>
          <input ref={firstRef} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
        </label>
        <div className="vf-form-grid">
          <label className="vf-form-row">
            <span>Id {existing ? '(locked)' : '(optional slug)'}</span>
            <input
              value={draft.id ?? ''}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              disabled={existing}
              placeholder="standard-approval"
            />
          </label>
          <label className="vf-form-row">
            <span>Priority</span>
            <input
              type="number"
              min={0}
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
            />
          </label>
        </div>
        <div className="vf-form-grid">
          <label className="vf-form-row">
            <span>Lifecycle</span>
            <select
              value={draft.lifecycle}
              onChange={(e) => setDraft({ ...draft, lifecycle: e.target.value as StrategyLifecycle })}
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="vf-form-row is-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>
        </div>
        <label className="vf-form-row">
          <span>Summary</span>
          <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </label>
        <label className="vf-form-row">
          <span>Outcome</span>
          <textarea value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} />
        </label>
        <label className="vf-form-row">
          <span>Data sources</span>
          <input value={sources} onChange={(e) => setSources(e.target.value)} placeholder="zoho, fmcsa, plaid" />
          <p className="vf-form-hint">Comma-separated. Same strings the pipeline already knows.</p>
        </label>
        <label className="vf-form-row">
          <span>Stage scope</span>
          <input value={stages} onChange={(e) => setStages(e.target.value)} placeholder="fmcsa, plaid_bs, creditsafe" />
        </label>
        <label className="vf-form-row">
          <span>Decision actions</span>
          <input value={actions} onChange={(e) => setActions(e.target.value)} placeholder="approve, review, reject" />
        </label>
        <div className="vf-form-repeat">
          <span>Rule bindings</span>
          {draft.rule_bindings.map((binding, i) => (
            <div key={`rb-${i}`} className="vf-form-repeat-row">
              <input
                aria-label={`Binding ${i + 1} category`}
                value={binding.category}
                placeholder="APPROVE"
                onChange={(e) => {
                  const next = draft.rule_bindings.slice();
                  next[i] = { ...binding, category: e.target.value };
                  setDraft({ ...draft, rule_bindings: next });
                }}
              />
              <input
                aria-label={`Binding ${i + 1} stage`}
                value={binding.stage}
                placeholder="decision"
                onChange={(e) => {
                  const next = draft.rule_bindings.slice();
                  next[i] = { ...binding, stage: e.target.value };
                  setDraft({ ...draft, rule_bindings: next });
                }}
              />
              <input
                aria-label={`Binding ${i + 1} purpose`}
                value={binding.purpose}
                placeholder="positive pass checks"
                onChange={(e) => {
                  const next = draft.rule_bindings.slice();
                  next[i] = { ...binding, purpose: e.target.value };
                  setDraft({ ...draft, rule_bindings: next });
                }}
              />
              <button
                type="button"
                className="vf-btn"
                onClick={() =>
                  setDraft({ ...draft, rule_bindings: draft.rule_bindings.filter((_, j) => j !== i) })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="vf-btn"
            onClick={() =>
              setDraft({
                ...draft,
                rule_bindings: [...draft.rule_bindings, { category: 'REVIEW', stage: 'decision', purpose: '' }],
              })
            }
          >
            Add binding
          </button>
        </div>
        <div className="vf-form-repeat">
          <span>Combined fields</span>
          {draft.combined_fields.map((field, i) => (
            <div key={`cf-${i}`} className="vf-form-repeat-row">
              <input
                aria-label={`Field ${i + 1} label`}
                value={field.label}
                placeholder="Label"
                onChange={(e) => {
                  const next = draft.combined_fields.slice();
                  next[i] = { ...field, label: e.target.value };
                  setDraft({ ...draft, combined_fields: next });
                }}
              />
              <input
                aria-label={`Field ${i + 1} source`}
                value={field.source}
                placeholder="zoho"
                onChange={(e) => {
                  const next = draft.combined_fields.slice();
                  next[i] = { ...field, source: e.target.value };
                  setDraft({ ...draft, combined_fields: next });
                }}
              />
              <input
                aria-label={`Field ${i + 1} path`}
                value={field.path}
                placeholder="applicant.Name"
                onChange={(e) => {
                  const next = draft.combined_fields.slice();
                  next[i] = { ...field, path: e.target.value };
                  setDraft({ ...draft, combined_fields: next });
                }}
              />
              <button
                type="button"
                className="vf-btn"
                onClick={() =>
                  setDraft({ ...draft, combined_fields: draft.combined_fields.filter((_, j) => j !== i) })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="vf-btn"
            onClick={() =>
              setDraft({
                ...draft,
                combined_fields: [...draft.combined_fields, { label: '', source: '', path: '', required: false }],
              })
            }
          >
            Add field
          </button>
        </div>
        <div className="vf-form-repeat">
          <span>Conditions</span>
          {draft.conditions.map((condition, i) => (
            <div key={`c-${i}`} className="vf-form-repeat-row">
              <input
                aria-label={`Condition ${i + 1} path`}
                value={condition.path}
                placeholder="stage.status"
                onChange={(e) => {
                  const next = draft.conditions.slice();
                  next[i] = { ...condition, path: e.target.value };
                  setDraft({ ...draft, conditions: next });
                }}
              />
              <input
                aria-label={`Condition ${i + 1} operator`}
                value={condition.operator}
                placeholder="in"
                onChange={(e) => {
                  const next = draft.conditions.slice();
                  next[i] = { ...condition, operator: e.target.value };
                  setDraft({ ...draft, conditions: next });
                }}
              />
              <input
                aria-label={`Condition ${i + 1} value`}
                value={typeof condition.value === 'string' ? condition.value : JSON.stringify(condition.value ?? '')}
                placeholder="ran, approved"
                onChange={(e) => {
                  const next = draft.conditions.slice();
                  const raw = e.target.value;
                  next[i] = { ...condition, value: raw.includes(',') ? raw.split(',').map((s) => s.trim()) : raw };
                  setDraft({ ...draft, conditions: next });
                }}
              />
              <button
                type="button"
                className="vf-btn"
                onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="vf-btn"
            onClick={() =>
              setDraft({
                ...draft,
                conditions: [...draft.conditions, { path: '', operator: 'eq', value: '' }],
              })
            }
          >
            Add condition
          </button>
        </div>
        <label className="vf-form-row">
          <span>Condition logic</span>
          <input
            value={draft.logic}
            onChange={(e) => setDraft({ ...draft, logic: e.target.value })}
            placeholder="(1 AND 2) OR 3"
          />
        </label>
      </form>
    </Dialog>
  );
}
