import { describe, expect, it } from 'vitest';
import type { DecisionStrategyRow, StopFactorRow } from '../../api/verificationStrategies';
import {
  clampSummary,
  countEnabled,
  filterStopFactors,
  filterStrategies,
  formatConditionValue,
  lifecycleLabel,
  parseConditionValue,
  stageLabel,
} from './verificationRulesetFilter';

function strategy(over: Partial<DecisionStrategyRow> = {}): DecisionStrategyRow {
  return {
    id: 'llc',
    title: 'Credit score',
    enabled: true,
    lifecycle: 'published',
    version: 1,
    priority: 10,
    summary: 'Score floor',
    outcome: 'Approve',
    data_sources: ['isoftpull'],
    stage_scope: ['isoftpull'],
    decision_actions: ['approve'],
    combined_fields: [],
    rule_bindings: [],
    conditions: [],
    logic: '',
    meta: {},
    ...over,
  };
}

function factor(over: Partial<StopFactorRow> = {}): StopFactorRow {
  return {
    id: 1,
    name: 'Min score',
    stage: 'pre',
    check_type: 'field_check',
    field_path: 'score',
    operator: 'gte',
    threshold: '600',
    action_on_fail: 'REJECT',
    action_on_missing: 'PASS',
    provider_filter: null,
    enabled: true,
    priority: 0,
    meta: {},
    ...over,
  };
}

describe('filterStrategies', () => {
  const rows = [
    strategy(),
    strategy({ id: 'hold', title: 'Hard stop', enabled: false, lifecycle: 'draft', decision_actions: ['reject'] }),
  ];

  it('filters by Active / Disabled and search', () => {
    expect(filterStrategies(rows, { q: '', enabled: 'enabled' })).toHaveLength(1);
    expect(filterStrategies(rows, { q: '', enabled: 'disabled' })[0]?.id).toBe('hold');
    expect(filterStrategies(rows, { q: 'reject', enabled: 'all' })[0]?.id).toBe('hold');
    expect(filterStrategies(rows, { q: 'credit', enabled: 'all' })[0]?.id).toBe('llc');
  });
});

describe('filterStopFactors', () => {
  const rows = [
    factor(),
    factor({ id: 2, name: 'Authority', stage: 'decision', enabled: false, field_path: 'fmcsa.status' }),
  ];

  it('filters by stage, status, and path text', () => {
    expect(filterStopFactors(rows, { q: '', enabled: 'all', stage: 'decision' })).toHaveLength(1);
    expect(filterStopFactors(rows, { q: '', enabled: 'disabled', stage: '' })[0]?.id).toBe(2);
    expect(filterStopFactors(rows, { q: 'fmcsa', enabled: 'all', stage: '' })[0]?.name).toBe('Authority');
  });
});

describe('ruleset labels and condition values', () => {
  it('counts enabled rows and labels stage / lifecycle', () => {
    expect(countEnabled([strategy(), strategy({ enabled: false })])).toBe(1);
    expect(stageLabel('pre')).toBe('Pre-check');
    expect(lifecycleLabel('published')).toBe('Published');
  });

  it('clamps long summaries on a word boundary with an ellipsis', () => {
    expect(clampSummary('reject if USDOT inactive (MC per state rules)', 28)).toBe(
      'reject if USDOT inactive…',
    );
    expect(clampSummary('Short rule')).toBe('Short rule');
  });

  it('round-trips list values for in / not_in and drops value for exists', () => {
    expect(formatConditionValue(['INACTIVE', 'OUT_OF_SERVICE'])).toBe('INACTIVE, OUT_OF_SERVICE');
    expect(parseConditionValue('ran, approved', 'in')).toEqual(['ran', 'approved']);
    expect(parseConditionValue('yes', 'exists')).toBeUndefined();
    expect(parseConditionValue('600', 'gte')).toBe('600');
  });
});
