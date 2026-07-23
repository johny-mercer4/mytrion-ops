import { afterEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { judgeSufficiency, planQueries } from '../../src/modules/knowledge/agentic/queryPlanner.js';
import { setOpenAIClient } from '../../src/modules/llm/openaiClient.js';

function stubCompletion(content: string | null): OpenAI {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function stubFailure(): OpenAI {
  const create = vi.fn().mockRejectedValue(new Error('provider down'));
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const passages = [{ content: 'Late fees accrue from day 30 at 1.5%/month.' }];

afterEach(() => vi.restoreAllMocks());

describe('judgeSufficiency / CRAG grade', () => {
  it('accepts Correct grade as sufficient', async () => {
    setOpenAIClient(stubCompletion('{"grade": "Correct", "sufficient": true, "missingQueries": []}'));
    const v = await judgeSufficiency('q', passages);
    expect(v.sufficient).toBe(true);
    expect(v.grade).toBe('Correct');
  });

  it('maps Ambiguous with missingQueries', async () => {
    setOpenAIClient(
      stubCompletion('{"grade": "Ambiguous", "sufficient": false, "missingQueries": ["late fee grace period"]}'),
    );
    const verdict = await judgeSufficiency('q', passages);
    expect(verdict.sufficient).toBe(false);
    expect(verdict.grade).toBe('Ambiguous');
    expect(verdict.missingQueries).toEqual(['late fee grace period']);
  });

  it('treats garbled judge output as Incorrect with no follow-ups', async () => {
    setOpenAIClient(stubCompletion('not json at all'));
    const verdict = await judgeSufficiency('q', passages);
    expect(verdict).toEqual({ sufficient: false, grade: 'Incorrect', missingQueries: [] });
  });

  it('treats a judge failure as Incorrect with no follow-ups', async () => {
    setOpenAIClient(stubFailure());
    const verdict = await judgeSufficiency('q', passages);
    expect(verdict).toEqual({ sufficient: false, grade: 'Incorrect', missingQueries: [] });
  });
});

describe('planQueries degradation', () => {
  it('falls back to the original question on planner failure', async () => {
    setOpenAIClient(stubFailure());
    expect(await planQueries('what is the late fee?')).toEqual(['what is the late fee?']);
  });

  it('uses planned queries when the model returns them', async () => {
    setOpenAIClient(stubCompletion('{"queries": ["late fee amount", "late fee start date"]}'));
    expect(await planQueries('what is the late fee?')).toEqual([
      'late fee amount',
      'late fee start date',
    ]);
  });
});
