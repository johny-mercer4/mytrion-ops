import { describe, expect, it } from 'vitest';
import {
  appendDecisionStrategyRevision,
  normalizeDecisionStrategyList,
  slugDecisionStrategyId,
  validateConditionLogic,
} from '../../src/integrations/verificationOrchestrationNormalize.js';

describe('verification orchestration normalize', () => {
  it('slugs strategy ids the same way as mono', () => {
    expect(slugDecisionStrategyId('FMCSA Authority')).toBe('fmcsa-authority');
    expect(slugDecisionStrategyId('  Octane SOP — hard stops  ')).toBe('octane-sop-hard-stops');
    expect(slugDecisionStrategyId('llc')).toBe('llc');
  });

  it('normalizes a live-shaped strategy and sorts by priority', () => {
    const items = normalizeDecisionStrategyList([
      {
        id: 'llc',
        title: 'Credit score',
        enabled: true,
        lifecycle: 'published',
        version: 6,
        priority: 100,
        logic: '(1 AND 2) OR (3 AND 4)',
        conditions: [
          { path: 'isoftpull.credit_score', operator: 'gte', value: 600 },
          { path: 'applicant.Business_Type', operator: 'eq', value: 'LLC' },
        ],
        meta: { severity: 'hard', version_note: 'v6' },
      },
      {
        title: 'First',
        priority: 10,
        conditions: [{ path: 'stage.status', operator: 'eq', value: 'ran' }],
      },
    ]);
    expect(items.map((item) => item.id)).toEqual(['first', 'llc']);
    expect(items[1]?.meta).toEqual({ severity: 'hard', version_note: 'v6' });
    expect(items[1]?.logic).toBe('(1 AND 2) OR (3 AND 4)');
    expect(items[1]?.version).toBe(6);
  });

  it('falls back to the three mono defaults when the list is empty', () => {
    const items = normalizeDecisionStrategyList([]);
    expect(items.map((item) => item.id)).toEqual(['standard-approval', 'manual-review', 'hard-stop']);
  });

  it('accepts mono condition-logic expressions and rejects bad indexes', () => {
    expect(validateConditionLogic('(1 AND (3 OR 4)) OR (2 AND 3)', 4)).toBe('');
    expect(validateConditionLogic('1 AND 2', 2)).toBe('');
    expect(validateConditionLogic('', 0)).toBe('');
    expect(validateConditionLogic('5', 4)).toMatch(/out of range/);
    expect(validateConditionLogic('1 AND', 1)).toMatch(/unexpected token/);
  });

  it('appends a revision snapshot and caps at 250', () => {
    const strategy = normalizeDecisionStrategyList([{ id: 'llc', title: 'Credit score', priority: 100 }])[0];
    if (!strategy) throw new Error('expected strategy');
    const revisions = appendDecisionStrategyRevision([], strategy, 'updated', 'Test Worker', {
      ...strategy,
      title: 'Old',
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.actor).toBe('test worker');
    expect(revisions[0]?.changed_fields).toContain('title');
    expect(revisions[0]?.snapshot.id).toBe('llc');
  });
});
