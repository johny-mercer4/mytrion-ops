import { useMemo, useState } from 'react';
import { GitBranch, OctagonAlert, Plus, RefreshCw, Scale, Search, X } from 'lucide-react';
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
import {
  clampSummary,
  countEnabled,
  filterStopFactors,
  filterStrategies,
  lifecycleLabel,
  stageLabel,
  type EnabledFilter,
} from '../verificationRulesetFilter';

type Section = 'strategies' | 'factors';

const STAGES: { id: StopFactorStage | ''; label: string }[] = [
  { id: '', label: 'All stages' },
  { id: 'pre', label: 'Pre-check' },
  { id: 'decision', label: 'Decision' },
  { id: 'post', label: 'Post-check' },
];

const ENABLED: { id: EnabledFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'enabled', label: 'Active' },
  { id: 'disabled', label: 'Disabled' },
];

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

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span className={`vf-pill ${enabled ? 'is-on' : 'is-off'}`}>{enabled ? 'Active' : 'Disabled'}</span>
  );
}

export function VerificationRuleset() {
  const [section, setSection] = useState<Section>('strategies');
  const [q, setQ] = useState('');
  const [enabled, setEnabled] = useState<EnabledFilter>('all');
  const [stage, setStage] = useState<StopFactorStage | ''>('');
  const [factorOpen, setFactorOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [editingFactor, setEditingFactor] = useState<StopFactorRow | null>(null);
  const [editingStrategy, setEditingStrategy] = useState<DecisionStrategyRow | null>(null);

  const openStrategy = (row: DecisionStrategyRow | null): void => {
    setEditingStrategy(row);
    setStrategyOpen(true);
  };
  const openFactor = (row: StopFactorRow | null): void => {
    setEditingFactor(row);
    setFactorOpen(true);
  };
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const strategies = useVerificationStrategies();
  const factors = useVerificationStopFactors();
  const load = section === 'strategies' ? strategies : factors;
  const firstLoad = load.loading && !load.data;
  const cachedCaption = formatCachedAt(load.cachedAt);
  const strategyItems = useMemo(
    () => filterStrategies(strategies.data ?? [], { q, enabled }),
    [strategies.data, q, enabled],
  );
  const factorItems = useMemo(
    () => filterStopFactors(factors.data ?? [], { q, enabled, stage }),
    [factors.data, q, enabled, stage],
  );
  const sourceRows = section === 'strategies' ? (strategies.data ?? []) : (factors.data ?? []);
  const visibleRows = section === 'strategies' ? strategyItems : factorItems;
  const filtersOn = q.trim() !== '' || enabled !== 'all' || (section === 'factors' && stage !== '');

  const reloadActive = (): void => {
    if (section === 'strategies') {
      invalidateSwrCache('verification:strategies');
      void strategies.reload();
      return;
    }
    invalidateSwrCache('verification:stop-factors');
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
          meta: row.meta,
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
          meta: row.meta,
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
          <label className="vf-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={section === 'strategies' ? 'Search strategies' : 'Search stop factors'}
              aria-label={section === 'strategies' ? 'Search strategies' : 'Search stop factors'}
            />
            {q ? (
              <button type="button" className="vf-search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </label>
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
                section === 'strategies' ? openStrategy(null) : openFactor(null)
              }
            >
              <Plus size={14} aria-hidden="true" />
              {section === 'strategies' ? 'New strategy' : 'New stop factor'}
            </button>
          </div>
        </div>
        <div className="vf-filters">
          <div className="vf-filter-group" role="group" aria-label="Status">
            {ENABLED.map((item) => (
              <button
                key={item.id}
                type="button"
                className="vf-chip"
                aria-pressed={enabled === item.id}
                onClick={() => setEnabled(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {section === 'factors' ? (
            <div className="vf-filter-group" role="group" aria-label="Stage">
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
          ) : null}
        </div>
        <p className="vf-summary" aria-live="polite">
          <span className="vf-summary-item">
            <strong>{firstLoad ? '—' : visibleRows.length}</strong>
            {filtersOn && !firstLoad ? ` of ${sourceRows.length}` : ''}{' '}
            {section === 'strategies' ? 'strategies' : 'rules'}
          </span>
          <span className="vf-summary-item is-clear">
            <strong>{firstLoad ? '—' : countEnabled(visibleRows)}</strong> active
          </span>
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
          <Scale size={28} aria-hidden="true" />
          <div className="vf-empty-title">Couldn’t load {section === 'strategies' ? 'strategies' : 'stop factors'}</div>
          <p>{load.error}</p>
          <button type="button" className="vf-btn" onClick={() => void load.reload()}>
            Try again
          </button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="vf-empty">
          {section === 'strategies' ? <Scale size={28} aria-hidden="true" /> : <OctagonAlert size={28} aria-hidden="true" />}
          <div className="vf-empty-title">
            {filtersOn
              ? 'Nothing matches'
              : section === 'strategies'
                ? 'No strategies yet'
                : 'No stop factors yet'}
          </div>
          <p>
            {filtersOn
              ? 'Clear search or status to see every record.'
              : 'Add one and it applies on the next run.'}
          </p>
          {filtersOn ? (
            <button
              type="button"
              className="vf-btn"
              onClick={() => {
                setQ('');
                setEnabled('all');
                setStage('');
              }}
            >
              Clear filters
            </button>
          ) : (
            <button
              type="button"
              className="vf-btn"
              onClick={() =>
                section === 'strategies' ? openStrategy(null) : openFactor(null)
              }
            >
              {section === 'strategies' ? 'New strategy' : 'New stop factor'}
            </button>
          )}
        </div>
      ) : section === 'strategies' ? (
        <>
          <div className="vf-table-wrap">
            <table className="vf-table">
              <caption className="sr-only">Decision strategies</caption>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Status</th>
                  <th>Lifecycle</th>
                  <th>Priority</th>
                  <th>Actions</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {strategyItems.map((row) => (
                  <tr key={row.id} className={row.enabled ? undefined : 'is-off'}>
                    <td>
                      <button
                        type="button"
                        className="vf-title-btn"
                        title={row.summary || row.title}
                        onClick={() => openStrategy(row)}
                      >
                        <GitBranch size={16} aria-hidden="true" />
                        <span>
                          <strong>{row.title}</strong>
                          {row.summary ? <em>{clampSummary(row.summary)}</em> : null}
                        </span>
                      </button>
                    </td>
                    <td>
                      <StatusPill enabled={row.enabled} />
                    </td>
                    <td>
                      <span className={`vf-pill is-${row.lifecycle === 'published' ? 'info' : row.lifecycle === 'archived' ? 'mute' : 'warn'}`}>
                        {lifecycleLabel(row.lifecycle)}
                      </span>
                    </td>
                    <td>{row.priority}</td>
                    <td>{row.decision_actions.join(', ') || '—'}</td>
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
                        <button type="button" className="vf-btn" onClick={() => openStrategy(row)}>
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
                <button
                  type="button"
                  className={`vf-case-card ${row.enabled ? '' : 'is-off'}`}
                  onClick={() => openStrategy(row)}
                >
                  <span className="vf-card-top">
                    <GitBranch size={16} aria-hidden="true" />
                    <strong>{row.title}</strong>
                    <StatusPill enabled={row.enabled} />
                  </span>
                  {row.summary ? <span className="vf-card-summary">{clampSummary(row.summary)}</span> : null}
                  <span>
                    {lifecycleLabel(row.lifecycle)} · priority {row.priority}
                    {row.decision_actions.length ? ` · ${row.decision_actions.join(', ')}` : ''}
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
                  <th>Rule</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Check</th>
                  <th>On fail</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {factorItems.map((row) => (
                  <tr key={row.id} className={row.enabled ? undefined : 'is-off'}>
                    <td>
                      <button
                        type="button"
                        className="vf-title-btn"
                        title={row.field_path || row.name}
                        onClick={() => openFactor(row)}
                      >
                        <OctagonAlert size={16} aria-hidden="true" />
                        <span>
                          <strong>{row.name}</strong>
                          {row.field_path ? <em>{row.field_path}</em> : null}
                        </span>
                      </button>
                    </td>
                    <td>
                      <StatusPill enabled={row.enabled} />
                    </td>
                    <td>
                      <span className="vf-pill is-info">{stageLabel(row.stage)}</span>
                    </td>
                    <td>{row.check_type === 'field_check' ? row.operator : row.check_type}</td>
                    <td>
                      <span
                        className={`vf-pill ${
                          row.action_on_fail === 'APPROVE'
                            ? 'is-on'
                            : row.action_on_fail === 'REVIEW'
                              ? 'is-warn'
                              : 'is-bad'
                        }`}
                      >
                        {row.action_on_fail}
                      </span>
                    </td>
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
                        <button type="button" className="vf-btn" onClick={() => openFactor(row)}>
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
                <button
                  type="button"
                  className={`vf-case-card ${row.enabled ? '' : 'is-off'}`}
                  onClick={() => openFactor(row)}
                >
                  <span className="vf-card-top">
                    <OctagonAlert size={16} aria-hidden="true" />
                    <strong>{row.name}</strong>
                    <StatusPill enabled={row.enabled} />
                  </span>
                  <span>
                    {stageLabel(row.stage)} · {row.action_on_fail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <VerificationStopFactorDialog
        open={factorOpen}
        row={editingFactor}
        defaultStage={stage}
        onClose={() => setFactorOpen(false)}
        onSaved={() => {
          setFactorOpen(false);
          reloadActive();
        }}
      />
      <VerificationStrategyDialog
        open={strategyOpen}
        row={editingStrategy}
        onClose={() => setStrategyOpen(false)}
        onSaved={() => {
          setStrategyOpen(false);
          reloadActive();
        }}
      />
    </div>
  );
}
