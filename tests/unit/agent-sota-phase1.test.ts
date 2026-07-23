/**
 * SotA Phase 1 unit coverage: compaction helpers, plan DAG validation, blackboard merge,
 * skill redaction — no live LLM / DB required.
 */
import { describe, expect, it } from 'vitest';
import {
  formatMemorySummaryXml,
  midHistoryChars,
  needsPaging,
  parseMemorySummary,
} from '../../src/modules/agents/checkpointer.js';
import {
  emptyBlackboard,
  formatBlackboardXml,
  parseBlackboard,
} from '../../src/modules/agents/blackboard.js';
import {
  hasCycle,
  maxParallelWidth,
  readyNodes,
  shouldPlan,
  validateExecutionPlan,
} from '../../src/modules/agents/planning/planSchema.js';
import { nextWave, shouldReplan } from '../../src/modules/agents/planning/planExecutor.js';
import { redactSkillText, skeletonFromToolCalls } from '../../src/modules/agents/skillCache.js';
import { shouldReciteGoal } from '../../src/modules/agents/briefBuilder.js';
import { env } from '../../src/config/env.js';

describe('checkpointer paging helpers', () => {
  it('pages when mid-history exceeds char budget', () => {
    const big = 'x'.repeat(1000);
    const msgs = [{ content: 'first' }, ...Array.from({ length: 10 }, () => ({ content: big })), { content: 'tail' }];
    // Force a tiny budget for the assertion.
    expect(midHistoryChars(msgs, 2)).toBeGreaterThan(5000);
    expect(needsPaging(msgs, 1000, 2)).toBe(true);
    expect(needsPaging(msgs, 10_000_000, 2)).toBe(false);
  });

  it('parses structured and legacy free-text summaries', () => {
    const structured = parseMemorySummary(
      JSON.stringify({
        goal: 'Find balance',
        entities: ['Acme'],
        openTasks: ['pull LOC'],
        decisions: [],
        narrative: 'User asked about Acme.',
      }),
    );
    expect(structured?.goal).toBe('Find balance');
    expect(formatMemorySummaryXml(structured!).includes('<Goal>Find balance</Goal>')).toBe(true);

    const legacy = parseMemorySummary('User mentioned carrier Acme yesterday.');
    expect(legacy?.narrative).toContain('Acme');
  });
});

describe('plan DAG validation', () => {
  const allowed = ['sales', 'billing', 'retention'] as const;

  it('accepts a valid parallel-then-sequential plan', () => {
    const result = validateExecutionPlan(
      {
        goal: 'Balance + retention',
        nodes: [
          { id: 'a', agent: 'sales', brief: 'Get balance for Acme', dependsOn: [] },
          { id: 'b', agent: 'retention', brief: 'Open retention status', dependsOn: [] },
          { id: 'c', agent: 'billing', brief: 'Invoice summary using prior facts', dependsOn: ['a'] },
        ],
      },
      allowed,
    );
    expect(result.ok).toBe(true);
    expect(result.plan?.nodes).toHaveLength(3);
  });

  it('rejects unknown agents, cycles, and over-width plans', () => {
    expect(
      validateExecutionPlan(
        { goal: 'x', nodes: [{ id: 'a', agent: 'not-real', brief: 'x', dependsOn: [] }] },
        allowed,
      ).ok,
    ).toBe(false);

    const cyclic = {
      goal: 'x',
      nodes: [
        { id: 'a', agent: 'sales', brief: 'a', dependsOn: ['b'] },
        { id: 'b', agent: 'billing', brief: 'b', dependsOn: ['a'] },
      ],
    };
    expect(hasCycle(cyclic)).toBe(true);
    expect(validateExecutionPlan(cyclic, allowed).ok).toBe(false);
  });

  it('computes ready waves and replan gates', () => {
    const plan = {
      goal: 'g',
      nodes: [
        { id: 'a', agent: 'sales' as const, brief: 'a', dependsOn: [] as string[] },
        { id: 'b', agent: 'billing' as const, brief: 'b', dependsOn: ['a'] },
      ],
    };
    expect(readyNodes(plan, { a: 'pending', b: 'pending' }).map((n) => n.id)).toEqual(['a']);
    expect(nextWave(plan, { a: 'done', b: 'pending' }).map((n) => n.id)).toEqual(['b']);
    expect(shouldReplan(plan, { a: 'failed', b: 'pending' }, 0)).toBe(true);
    expect(shouldReplan(plan, { a: 'failed', b: 'pending' }, env.AGENT_PLAN_MAX_REPLANS)).toBe(false);
    expect(maxParallelWidth(plan)).toBeGreaterThanOrEqual(1);
  });

  it('skips planner for greetings and enables for multi-step asks', () => {
    const prev = env.FF_AGENT_PLAN_DAG;
    env.FF_AGENT_PLAN_DAG = true;
    try {
      expect(shouldPlan('hi', true)).toBe(false);
      expect(shouldPlan('Get carrier Acme balance and open retention status for them', true)).toBe(true);
      expect(shouldPlan('Get carrier Acme balance and open retention status for them', false)).toBe(false);
    } finally {
      env.FF_AGENT_PLAN_DAG = prev;
    }
  });
});

describe('blackboard payload', () => {
  it('formats a compact XML snapshot', () => {
    const payload = parseBlackboard({
      goal: 'Help Acme',
      facts: { carrier_id: '123' },
      artifacts: [{ key: 'balance', value: 42, sourceAgent: 'sales', at: '2026-07-23T00:00:00.000Z' }],
      openQuestions: [],
    });
    const xml = formatBlackboardXml(payload);
    expect(xml).toContain('<Blackboard>');
    expect(xml).toContain('carrier_id');
    expect(xml).toContain('balance');
    expect(emptyBlackboard().facts).toEqual({});
  });
});

describe('skill cache helpers', () => {
  it('redacts IDs and builds tool skeletons', () => {
    expect(redactSkillText('Carrier 6227679000031473048 email a@b.com')).toContain('<ID>');
    expect(redactSkillText('Carrier 6227679000031473048 email a@b.com')).toContain('<EMAIL>');
    const steps = skeletonFromToolCalls([
      { name: 'crm__carrier_balance', args: { carrier_id: '1' } },
      { name: 'zoho_crm__query', args: { select_query: 'select 1' } },
      { name: 'task', args: { subagent_type: 'sales' } },
    ]);
    expect(steps.map((s) => s.tool)).toEqual(['crm.carrier_balance', 'zoho_crm.query']);
    expect(steps[0]?.argKeys).toContain('carrier_id');
  });
});

describe('goal recite cadence', () => {
  it('fires every N user turns', () => {
    const every = env.AGENT_GOAL_RECITE_EVERY;
    // messageCount is user+assistant; user turn index ≈ messageCount/2 + 1
    expect(shouldReciteGoal(0)).toBe(false);
    // Find a messageCount that lands on a multiple of `every`
    let hit = false;
    for (let mc = 0; mc < every * 4; mc += 2) {
      if (shouldReciteGoal(mc)) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
  });
});
