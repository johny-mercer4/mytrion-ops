import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hybridMock, planMock, traceMock } = vi.hoisted(() => ({
  hybridMock: vi.fn(),
  planMock: vi.fn(),
  traceMock: vi.fn(),
}));

vi.mock('../../src/modules/knowledge/agentic/hybrid.js', () => ({ hybridRetrieve: hybridMock }));
vi.mock('../../src/modules/knowledge/agentic/queryPlanner.js', () => ({
  planQueries: planMock,
  judgeEvidence: vi.fn(),
}));
vi.mock('../../src/repos/ragRunRepo.js', () => ({
  ragRunRepo: { record: traceMock },
}));

import { runWithAgentContext } from '../../src/modules/agents/context.js';
import { createTurnContext, scopeFingerprintFor } from '../../src/modules/agents/turnContext.js';
import { agenticRetrieve } from '../../src/modules/knowledge/agentic/loop.js';
import { makeContext } from '../fixtures/seed.js';

const query = 'What is the undocumented submarine policy?';
const sales = () => makeContext({ role: 'worker', departments: ['sales'], allDepartmentAccess: false });

beforeEach(() => {
  vi.clearAllMocks();
  hybridMock.mockResolvedValue([]);
  planMock.mockImplementation(async (value: string) => [value]);
  traceMock.mockResolvedValue(undefined);
});

describe('scope-keyed known-no-match reuse', () => {
  it('does not repeat a fresh miss for the exact query and retrieval scope', async () => {
    const ctx = sales();
    const turnContext = createTurnContext({
      ctx,
      message: query,
      knownNoMatch: [{
        query,
        scopeFingerprint: scopeFingerprintFor(ctx),
        at: new Date().toISOString(),
      }],
    });
    const result = await runWithAgentContext({ ctx, turnContext }, () => agenticRetrieve(ctx, query));

    expect(result).toMatchObject({ grade: 'not_documented', notDocumented: true, hops: 0 });
    expect(planMock).not.toHaveBeenCalled();
    expect(hybridMock).not.toHaveBeenCalled();
  });

  it('never reuses a miss from a different department scope', async () => {
    const ctx = sales();
    const billing = makeContext({ role: 'worker', departments: ['billing'], allDepartmentAccess: false });
    const turnContext = createTurnContext({
      ctx,
      message: query,
      knownNoMatch: [{
        query,
        scopeFingerprint: scopeFingerprintFor(billing),
        at: new Date().toISOString(),
      }],
    });
    await runWithAgentContext({ ctx, turnContext }, () => agenticRetrieve(ctx, query));

    expect(planMock).toHaveBeenCalledOnce();
    expect(hybridMock).toHaveBeenCalled();
  });

  it('expires misses so newly synchronized documents can become visible', async () => {
    const ctx = sales();
    const turnContext = createTurnContext({
      ctx,
      message: query,
      knownNoMatch: [{
        query,
        scopeFingerprint: scopeFingerprintFor(ctx),
        at: '2020-01-01T00:00:00.000Z',
      }],
    });
    await runWithAgentContext({ ctx, turnContext }, () => agenticRetrieve(ctx, query));

    expect(hybridMock).toHaveBeenCalled();
  });
});
