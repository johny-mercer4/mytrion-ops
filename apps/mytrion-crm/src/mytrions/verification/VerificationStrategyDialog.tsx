import { useEffect, useRef, useState } from 'react';
import { Equal, Hash, Route } from 'lucide-react';
import { Button } from '../../ds/Button/Button';
import { Dialog } from '../../ds/Dialog';
import {
  saveDecisionStrategy,
  type DecisionStrategyRow,
  type StrategyLifecycle,
  type StrategyWrite,
} from '../../api/verificationStrategies';
import { VerificationChipField } from './VerificationChipField';
import {
  CONDITION_OPERATORS,
  DATA_SOURCE_CHIPS,
  DECISION_ACTION_CHIPS,
  STAGE_SCOPE_CHIPS,
  formatConditionValue,
  parseConditionValue,
} from './verificationRulesetFilter';

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
      merge_key: f.merge_key,
      weight: f.weight,
      notes: f.notes,
    })),
    rule_bindings: row.rule_bindings,
    conditions: row.conditions.map((c) => ({
      path: c.path,
      operator: c.operator,
      value: c.value,
    })),
    logic: row.logic,
    meta: row.meta,
  };
}

export function VerificationStrategyDialog({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: DecisionStrategyRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<StrategyWrite>(() => draftFrom(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedFor = useRef<string | null>(null);
  const existing = row != null;

  useEffect(() => {
    if (!open) {
      openedFor.current = null;
      return;
    }
    const key = row?.id ?? 'new';
    if (openedFor.current === key) return;
    openedFor.current = key;
    setDraft(draftFrom(row));
    setError(null);
  }, [open, row]);

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
      open={open}
      onClose={() => onClose()}
      title={existing ? draft.title.trim() || 'Edit strategy' : 'New strategy'}
      subtitle="Applies on the next run."
      size="lg"
      mobile="fullscreen"
      initialFocusRef={firstRef}
      footer={
        <div className="vf-case-actions">
          <Button variant="secondary" onClick={() => onClose()} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {existing ? 'Save strategy' : 'Create strategy'}
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
          <h3>Basics</h3>
          <label className="vf-form-row">
            <span>Title</span>
            <input ref={firstRef} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
          </label>
          <div className="vf-form-grid">
            <label className="vf-form-row">
              <span>{existing ? 'Id' : 'Id (optional)'}</span>
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
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="vf-form-row is-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              <span>Active</span>
            </label>
          </div>
        </section>

        <section className="vf-form-section">
          <h3>When it applies</h3>
          <label className="vf-form-row">
            <span>Summary</span>
            <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </label>
          <label className="vf-form-row">
            <span>Outcome</span>
            <textarea value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} />
          </label>
          <VerificationChipField
            label="Stages"
            values={draft.stage_scope}
            suggestions={STAGE_SCOPE_CHIPS}
            onChange={(stage_scope) => setDraft({ ...draft, stage_scope })}
            placeholder="Add a stage"
          />
          <VerificationChipField
            label="Data sources"
            values={draft.data_sources}
            suggestions={DATA_SOURCE_CHIPS}
            onChange={(data_sources) => setDraft({ ...draft, data_sources })}
            placeholder="Add a source"
          />
          <VerificationChipField
            label="Decision"
            values={draft.decision_actions}
            suggestions={DECISION_ACTION_CHIPS}
            onChange={(decision_actions) => setDraft({ ...draft, decision_actions })}
            placeholder="Add an action"
          />
        </section>

        <section className="vf-form-section">
          <h3>Bindings</h3>
          {draft.rule_bindings.map((binding, i) => (
            <div key={`rb-${i}`} className="vf-form-repeat-row">
              <label className="vf-form-row">
                <span>Category</span>
                <select
                  aria-label={`Binding ${i + 1} category`}
                  value={binding.category}
                  onChange={(e) => {
                    const next = draft.rule_bindings.slice();
                    next[i] = { ...binding, category: e.target.value };
                    setDraft({ ...draft, rule_bindings: next });
                  }}
                >
                  <option value="APPROVE">Approve</option>
                  <option value="REVIEW">Review</option>
                  <option value="REJECT">Reject</option>
                </select>
              </label>
              <label className="vf-form-row">
                <span>Stage</span>
                <input
                  aria-label={`Binding ${i + 1} stage`}
                  value={binding.stage}
                  onChange={(e) => {
                    const next = draft.rule_bindings.slice();
                    next[i] = { ...binding, stage: e.target.value };
                    setDraft({ ...draft, rule_bindings: next });
                  }}
                />
              </label>
              <label className="vf-form-row">
                <span>Purpose</span>
                <input
                  aria-label={`Binding ${i + 1} purpose`}
                  value={binding.purpose}
                  onChange={(e) => {
                    const next = draft.rule_bindings.slice();
                    next[i] = { ...binding, purpose: e.target.value };
                    setDraft({ ...draft, rule_bindings: next });
                  }}
                />
              </label>
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
        </section>

        <section className="vf-form-section">
          <h3>Fields to combine</h3>
          {draft.combined_fields.map((field, i) => (
            <div key={`cf-${i}`} className="vf-form-repeat-row">
              <label className="vf-form-row">
                <span>Label</span>
                <input
                  aria-label={`Field ${i + 1} label`}
                  value={field.label}
                  onChange={(e) => {
                    const next = draft.combined_fields.slice();
                    next[i] = { ...field, label: e.target.value };
                    setDraft({ ...draft, combined_fields: next });
                  }}
                />
              </label>
              <label className="vf-form-row">
                <span>Source</span>
                <input
                  aria-label={`Field ${i + 1} source`}
                  value={field.source}
                  onChange={(e) => {
                    const next = draft.combined_fields.slice();
                    next[i] = { ...field, source: e.target.value };
                    setDraft({ ...draft, combined_fields: next });
                  }}
                />
              </label>
              <label className="vf-form-row">
                <span>Path</span>
                <input
                  aria-label={`Field ${i + 1} path`}
                  value={field.path}
                  onChange={(e) => {
                    const next = draft.combined_fields.slice();
                    next[i] = { ...field, path: e.target.value };
                    setDraft({ ...draft, combined_fields: next });
                  }}
                />
              </label>
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
        </section>

        <section className="vf-form-section">
          <h3>Conditions</h3>
          {draft.conditions.map((condition, i) => {
            const needsValue = !['exists', 'not_exists', 'truthy'].includes(condition.operator);
            return (
              <div key={`c-${i}`} className="vf-cond">
                <span className="vf-cond-n">{i + 1}</span>
                <label className="vf-form-row">
                  <span>
                    <Route size={12} aria-hidden="true" /> Path
                  </span>
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
                </label>
                <label className="vf-form-row">
                  <span>
                    <Equal size={12} aria-hidden="true" /> Operator
                  </span>
                  <select
                    aria-label={`Condition ${i + 1} operator`}
                    value={condition.operator}
                    onChange={(e) => {
                      const next = draft.conditions.slice();
                      next[i] = { ...condition, operator: e.target.value };
                      setDraft({ ...draft, conditions: next });
                    }}
                  >
                    {(CONDITION_OPERATORS.some((op) => op.id === condition.operator)
                      ? CONDITION_OPERATORS
                      : [{ id: condition.operator, label: condition.operator }, ...CONDITION_OPERATORS]
                    ).map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </label>
                {needsValue ? (
                  <label className="vf-form-row">
                    <span>
                      <Hash size={12} aria-hidden="true" /> Value
                    </span>
                    <input
                      aria-label={`Condition ${i + 1} value`}
                      value={formatConditionValue(condition.value)}
                      placeholder={condition.operator === 'in' || condition.operator === 'not_in' ? 'ran, approved' : ''}
                      onChange={(e) => {
                        const next = draft.conditions.slice();
                        next[i] = { ...condition, value: parseConditionValue(e.target.value, condition.operator) };
                        setDraft({ ...draft, conditions: next });
                      }}
                    />
                  </label>
                ) : (
                  <span className="vf-cond-skip">No value</span>
                )}
                <button
                  type="button"
                  className="vf-btn"
                  onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </div>
            );
          })}
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
          <label className="vf-form-row">
            <span>Logic</span>
            <input
              value={draft.logic}
              onChange={(e) => setDraft({ ...draft, logic: e.target.value })}
              placeholder="(1 AND 2) OR 3"
            />
            <p className="vf-form-hint">
              Use the numbers above with AND, OR, and NOT. Leave blank to require every condition.
            </p>
          </label>
        </section>
      </form>
    </Dialog>
  );
}
