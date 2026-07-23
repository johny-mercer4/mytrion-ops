/**
 * SotA Phase 2 unit coverage: hard-DAG wave helpers, tool F1, CRAG grade mapping.
 */
import { describe, expect, it } from 'vitest';
import {
  nextWave,
  planComplete,
  shouldReplan,
} from '../../src/modules/agents/planning/planExecutor.js';
import {
  compareToBaseline,
  suiteKpis,
  toolSelectionScores,
  type CategorySummary,
  type TaskReport,
} from '../../scripts/lib/behaviorReport.js';
import { normalizeGradeForTest } from './helpers/cragGrade.js';

// Re-export grade normalization via a tiny local helper to avoid exporting from queryPlanner
// production API — we assert the public judge contract in query-planner.test.ts instead.
describe('hard DAG wave helpers', () => {
  const plan = {
    goal: 'g',
    nodes: [
      { id: 'a', agent: 'sales', brief: 'a', dependsOn: [] as string[] },
      { id: 'b', agent: 'billing', brief: 'b', dependsOn: ['a'] },
      { id: 'c', agent: 'retention', brief: 'c', dependsOn: [] as string[] },
    ],
  };

  it('runs independent nodes in the first wave', () => {
    const wave = nextWave(plan, { a: 'pending', b: 'pending', c: 'pending' });
    expect(wave.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });

  it('unlocks dependents after done', () => {
    expect(nextWave(plan, { a: 'done', b: 'pending', c: 'done' }).map((n) => n.id)).toEqual(['b']);
    expect(planComplete(plan, { a: 'done', b: 'done', c: 'done' })).toBe(true);
  });

  it('replans when blocked on failed deps', () => {
    expect(shouldReplan(plan, { a: 'failed', b: 'pending', c: 'done' }, 0)).toBe(true);
    expect(shouldReplan(plan, { a: 'failed', b: 'pending', c: 'done' }, 99)).toBe(false);
  });
});

describe('toolSelectionScores F1', () => {
  it('scores perfect overlap as 1', () => {
    expect(toolSelectionScores(['crm.pick_my_client', 'zoho_crm.query'], ['zoho_crm__query', 'crm__pick_my_client'])).toEqual({
      precision: 1,
      recall: 1,
      f1: 1,
    });
  });

  it('penalizes extra and missing tools', () => {
    const s = toolSelectionScores(['a', 'b'], ['a', 'c']);
    expect(s.precision).toBeCloseTo(0.5);
    expect(s.recall).toBeCloseTo(0.5);
    expect(s.f1).toBeCloseTo(0.5);
  });
});

describe('suiteKpis', () => {
  it('aggregates ping-pong and duration percentiles', () => {
    const reports: TaskReport[] = [
      {
        id: '1',
        category: 'routing',
        verdict: 'pass',
        failures: [],
        agentPath: ['sales'],
        pingPongCount: 1,
        durationMs: 100,
        toolCalls: [],
        costUsd: 0,
        toolF1: 1,
        cacheHitRate: 0.5,
      },
      {
        id: '2',
        category: 'routing',
        verdict: 'pass',
        failures: [],
        agentPath: [],
        pingPongCount: 0,
        durationMs: 300,
        toolCalls: [],
        costUsd: 0,
        toolF1: 0.5,
        cacheHitRate: 0.9,
      },
    ];
    const k = suiteKpis(reports);
    expect(k.avgPingPong).toBeCloseTo(0.5);
    expect(k.p50DurationMs).toBe(100);
    expect(k.avgToolF1).toBeCloseTo(0.75);
    expect(k.avgCacheHitRate).toBeCloseTo(0.7);
    expect(k.softBreaches).toEqual([]);
  });
});

describe('compareToBaseline', () => {
  it('flags category and KPI regressions', () => {
    const summary: Record<string, CategorySummary> = {
      routing: {
        pass: 7,
        fail: 3,
        skip: 0,
        passRate: 0.7,
        threshold: 0.9,
        breached: true,
      },
    };
    const kpis = {
      avgPingPong: 4,
      p50DurationMs: 1000,
      p95DurationMs: 200_000,
      avgToolF1: 0.3,
      avgCacheHitRate: null as number | null,
      softBreaches: [] as string[],
    };
    const regs = compareToBaseline(summary, kpis, {
      summary: { routing: { passRate: 0.9 } },
      kpis: { avgPingPong: 2.5, p95DurationMs: 120_000, avgToolF1: 0.5 },
    });
    expect(regs.some((r) => r.includes('routing'))).toBe(true);
    expect(regs.some((r) => r.includes('avgPingPong'))).toBe(true);
    expect(regs.some((r) => r.includes('avgToolF1'))).toBe(true);
  });
});

describe('CRAG grade normalize helper', () => {
  it('maps legacy sufficient flags', () => {
    expect(normalizeGradeForTest('Correct', true)).toBe('Correct');
    expect(normalizeGradeForTest(undefined, true)).toBe('Correct');
    expect(normalizeGradeForTest(undefined, false)).toBe('Ambiguous');
    expect(normalizeGradeForTest(undefined, undefined)).toBe('Incorrect');
  });
});
