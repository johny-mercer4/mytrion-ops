import { useState } from 'react';
import { Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { formatCachedAt, invalidateSwrCache } from '../../_shared/swrCache';
import {
  saveDecisionStrategy,
  saveStopFactor,
  type DecisionStrategyRow,
  type StopFactorRow,
  type StopFactorStage,
} from '../../../api/verificationStrategies';
import { VerificationStopFactorDialog } from '../VerificationStopFactorDialog';
import { VerificationStrategyDialog } from '../VerificationStrategyDialog';
import { useVerificationStopFactors, useVerificationStrategies } from '../verificationData';

type Section = 'strategies' | 'factors';

const STAGES: { id: StopFactorStage | ''; label: string }[] = [
  { id: '', label: 'All stages' },
  { id: 'pre', label: 'Pre-check' },
  { id: 'decision', label: 'Decision' },
  { id: 'post', label: 'Post-check' },
];

function stageLabel(stage: string): string {
  if (stage === 'pre') return 'Pre';
  if (stage === 'post') return 'Post';
  if (stage === 'decision') return 'Decision';
  return stage || '—';
}

function RulesSkeleton() {
  return (
    <div className="vf-sk-rules" aria-busy="true">
      <span className="sr-only" role="status">
        Loading rules
      </span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="vf-sk vf-sk-rule" aria-hidden="true" />
      ))}
    </div>
  );
}

export function VerificationRuleset() {
  const [section, setSection] = useState<Section>('strategies');
  const [stage, setStage] = useState<StopFactorStage | ''>('');
  const [editingFactor, setEditingFactor] = useState<StopFactorRow | null | 'new'>(null);
  const [editingStrategy, setEditingStrategy] = useState<DecisionStrategyRow | null | 'new'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const strategies = useVerificationStrategies();
  const factors = useVerificationStopFactors(stage);
  const load = section === 'strategies' ? strategies : factors;
  const firstLoad = load.loading && !load.data;
  const countsUnknown = firstLoad || Boolean(load.error && !load.data);
  const cachedCaption = formatCachedAt(load.cachedAt);
  const strategyItems = strategies.data ?? [];
  const factorItems = factors.data ?? [];

  const reloadBoth = (): void => {
    invalidateSwrCache('verification:strategies');
    invalidateSwrCache('verification:stop-factors');
    void strategies.reload();
    void factors.reload();
  };

  const toggleFactor = async (row: StopFactorRow): Promise<void> => {
    setBusyId(`sf-${row.id}`);
    setActionError(null);
    try {
      await saveStopFactor(
        {
          name: row.name,
          stage: (row.stage === 'post' || row.stage === 'decision' ? row.stage : 'pre') as StopFactorStage,
          check_type:
            row.check_type === 'blacklist' || row.check_type === 'sql_query' ? row.check_type : 'field_check',
          field_path: row.field_path,
          operator:
            row.operator === 'lte' ||
            row.operator === 'gt' ||
            row.operator === 'lt' ||
            row.operator === 'eq' ||
            row.operator === 'neq' ||
            row.operator === 'not_in' ||
            row.operator === 'contains'
              ? row.operator
              : 'gte',
          threshold: row.threshold,
          action_on_fail:
            row.action_on_fail === 'APPROVE' || row.action_on_fail === 'REVIEW' ? row.action_on_fail : 'REJECT',
          action_on_missing:
            row.action_on_missing === 'REJECT' || row.action_on_missing === 'REVIEW'
              ? row.action_on_missing
              : 'PASS',
          provider_filter: row.provider_filter,
          enabled: !row.enabled,
          priority: row.priority,
          apply_at_zoho_intake: row.meta.apply_at_zoho_intake === true,
        },
        row.id,
      );
      invalidateSwrCache('verification:stop-factors');
      await factors.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update stop factor');
    } finally {
      setBusyId(null);
    }
  };

  const toggleStrategy = async (row: DecisionStrategyRow): Promise<void> => {
    setBusyId(`st-${row.id}`);
    setActionError(null);
    try {
      await saveDecisionStrategy(
        {
          id: row.id,
          title: row.title,
          enabled: !row.enabled,
          lifecycle: row.lifecycle === 'published' || row.lifecycle === 'archived' ? row.lifecycle : 'draft',
          priority: row.priority,
          summary: row.summary,
          outcome: row.outcome,
          data_sources: row.data_sources,
          stage_scope: row.stage_scope,
          decision_actions: row.decision_actions,
          combined_fields: row.combined_fields,
          rule_bindings: row.rule_bindings,
          conditions: row.conditions,
          logic: row.logic,
        },
        row.id,
      );
      invalidateSwrCache('verification:strategies');
      await strategies.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update strategy');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="vf-clients">
      <div className="vf-panel">
        <p className="vf-rs-intro">
          Create or edit the live Orchestration records. Saves write the same stop-factor rows and
          decision strategies the credit-platform pipeline already reads.
        </p>
        <div className="vf-toolbar">
          <div className="vf-filter-group" role="group" aria-label="Record type">
            <button
              type="button"
              className="vf-chip"
              aria-pressed={section === 'strategies'}
              onClick={() => setSection('strategies')}
            >
              Strategies
            </button>
            <button
              type="button"
              className="vf-chip"
              aria-pressed={section === 'factors'}
              onClick={() => setSection('factors')}
            >
              Stop factors
            </button>
          </div>
          <div className="vf-refresh">
            {load.revalidating ? (
              <span className="vf-cached">Refreshing…</span>
            ) : cachedCaption ? (
              <span className="vf-cached">Updated {cachedCaption}</span>
            ) : null}
            <button
              type="button"
              className="vf-btn"
              disabled={load.revalidating || firstLoad}
              onClick={() => void load.reload()}
              aria-label="Reload records"
            >
              <RefreshCw size={14} className={load.revalidating ? 'vf-spin' : undefined} />
              Refresh
            </button>
            <button
              type="button"
              className="vf-btn"
              onClick={() =>
                section === 'strategies' ? setEditingStrategy('new') : setEditingFactor('new')
              }
            >
              <Plus size={14} aria-hidden="true" />
              {section === 'strategies' ? 'New strategy' : 'New stop factor'}
            </button>
          </div>
        </div>
        {section === 'factors' ? (
          <div className="vf-filters">
            <div className="vf-filter-group" role="group" aria-label="Stage">
              <span className="vf-filter-label">Stage</span>
              {STAGES.map((s) => (
                <button
                  key={s.id || 'all'}
                  type="button"
                  className="vf-chip"
                  aria-pressed={stage === s.id}
                  onClick={() => setStage(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="vf-summary" aria-live="polite">
          {section === 'strategies' ? (
            <>
              <span className="vf-summary-item">
                <strong>{countsUnknown ? '—' : strategyItems.length}</strong> strategies
              </span>
              <span className="vf-summary-item">
                <strong>{countsUnknown ? '—' : strategyItems.filter((s) => s.enabled).length}</strong> enabled
              </span>
            </>
          ) : (
            <>
              <span className="vf-summary-item">
                <strong>{countsUnknown ? '—' : factorItems.length}</strong> rules
              </span>
              <span className="vf-summary-item">
                <strong>{countsUnknown ? '—' : factorItems.filter((s) => s.enabled).length}</strong> enabled
              </span>
            </>
          )}
        </p>
      </div>

      {actionError ? (
        <p className="vf-banner-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {load.error && (load.data?.length ?? 0) > 0 ? (
        <p className="vf-banner-error" role="alert">
          {load.error}
        </p>
      ) : null}

      {firstLoad ? (
        <RulesSkeleton />
      ) : load.error && !load.data ? (
        <div className="vf-empty" role="alert">
          <SlidersHorizontal size={28} aria-hidden="true" />
          <div className="vf-empty-title">Couldn’t load {section === 'strategies' ? 'strategies' : 'stop factors'}</div>
          <p>{load.error}</p>
          <button type="button" className="vf-btn" onClick={() => void load.reload()}>
            Try again
          </button>
        </div>
      ) : section === 'strategies' && strategyItems.length === 0 ? (
        <div className="vf-empty">
          <SlidersHorizontal size={28} aria-hidden="true" />
          <div className="vf-empty-title">No decision strategies</div>
          <p>Create one to publish policy into decision_strategies_json.</p>
          <button type="button" className="vf-btn" onClick={() => setEditingStrategy('new')}>
            New strategy
          </button>
        </div>
      ) : section === 'factors' && factorItems.length === 0 ? (
        <div className="vf-empty">
          <SlidersHorizontal size={28} aria-hidden="true" />
          <div className="vf-empty-title">No stop-factor rules</div>
          <p>Nothing in this stage. Add a rule or clear the stage filter.</p>
          <button type="button" className="vf-btn" onClick={() => setEditingFactor('new')}>
            New stop factor
          </button>
        </div>
      ) : section === 'strategies' ? (
        <>
          <div className="vf-table-wrap">
            <table className="vf-table">
              <caption className="sr-only">Decision strategies</caption>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Lifecycle</th>
                  <th>Priority</th>
                  <th>Actions</th>
                  <th>Enabled</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {strategyItems.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="vf-link" onClick={() => setEditingStrategy(row)}>
                        {row.title}
                      </button>
                    </td>
                    <td>{row.lifecycle}</td>
                    <td>{row.priority}</td>
                    <td>{row.decision_actions.join(', ') || '—'}</td>
                    <td>{row.enabled ? 'Yes' : 'No'}</td>
                    <td>
                      <div className="vf-rs-row-btns">
                        <button
                          type="button"
                          className="vf-btn"
                          disabled={busyId === `st-${row.id}`}
                          onClick={() => void toggleStrategy(row)}
                        >
                          {row.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" className="vf-btn" onClick={() => setEditingStrategy(row)}>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="vf-case-cards">
            {strategyItems.map((row) => (
              <li key={row.id}>
                <button type="button" className="vf-case-card" onClick={() => setEditingStrategy(row)}>
                  <strong>{row.title}</strong>
                  <span>
                    {row.lifecycle} · priority {row.priority} · {row.enabled ? 'enabled' : 'disabled'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="vf-table-wrap">
            <table className="vf-table">
              <caption className="sr-only">Stop factors</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Stage</th>
                  <th>Path</th>
                  <th>Op</th>
                  <th>Action</th>
                  <th>Enabled</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {factorItems.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="vf-link" onClick={() => setEditingFactor(row)}>
                        {row.name}
                      </button>
                    </td>
                    <td>{stageLabel(row.stage)}</td>
                    <td className="vf-rs-mono">{row.field_path || '—'}</td>
                    <td>{row.check_type === 'field_check' ? row.operator : '—'}</td>
                    <td>{row.action_on_fail}</td>
                    <td>{row.enabled ? 'Yes' : 'No'}</td>
                    <td>
                      <div className="vf-rs-row-btns">
                        <button
                          type="button"
                          className="vf-btn"
                          disabled={busyId === `sf-${row.id}`}
                          onClick={() => void toggleFactor(row)}
                        >
                          {row.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" className="vf-btn" onClick={() => setEditingFactor(row)}>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="vf-case-cards">
            {factorItems.map((row) => (
              <li key={row.id}>
                <button type="button" className="vf-case-card" onClick={() => setEditingFactor(row)}>
                  <strong>{row.name}</strong>
                  <span>
                    {stageLabel(row.stage)} · {row.action_on_fail} · {row.enabled ? 'enabled' : 'disabled'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editingFactor !== null ? (
        <VerificationStopFactorDialog
          row={editingFactor === 'new' ? null : editingFactor}
          defaultStage={stage}
          onClose={() => setEditingFactor(null)}
          onSaved={() => {
            setEditingFactor(null);
            reloadBoth();
          }}
        />
      ) : null}
      {editingStrategy !== null ? (
        <VerificationStrategyDialog
          row={editingStrategy === 'new' ? null : editingStrategy}
          onClose={() => setEditingStrategy(null)}
          onSaved={() => {
            setEditingStrategy(null);
            reloadBoth();
          }}
        />
      ) : null}
    </div>
  );
}
